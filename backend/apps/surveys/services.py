from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction

from .models import Survey


class SurveyOwnershipConflict(Exception):
    """Raised when a sync request's client-generated UUID already belongs to a different user."""


def create_survey(
    *,
    user,
    name,
    image,
    latitude,
    longitude,
    accuracy,
    description="",
    attributes=None,
    id=None,
):
    kwargs = dict(
        user=user,
        name=name,
        description=description,
        image=image,
        geometry=Point(longitude, latitude, srid=4326),
        accuracy=accuracy,
        attributes=attributes or {},
        # A record only exists here because it was durably created on the
        # server, whether directly (this endpoint) or later via the offline
        # sync endpoint (Phase 4) — pending/syncing/failed are client-side
        # (IndexedDB) states that precede the server ever having the record.
        sync_status=Survey.SyncStatus.SYNCED,
    )
    if id is not None:
        kwargs["id"] = id
    return Survey.objects.create(**kwargs)


def update_survey(
    survey,
    *,
    name,
    image,
    latitude,
    longitude,
    accuracy,
    description="",
    attributes=None,
    **_ignored,
):
    survey.name = name
    survey.description = description
    survey.image = image
    survey.geometry = Point(longitude, latitude, srid=4326)
    survey.accuracy = accuracy
    survey.attributes = attributes or {}
    survey.save()
    return survey


def soft_delete_survey(survey):
    survey.is_deleted = True
    survey.save(update_fields=["is_deleted", "updated_at"])


def sync_survey(
    *,
    id,
    user,
    name,
    image,
    latitude,
    longitude,
    accuracy,
    description="",
    attributes=None,
):
    """Create-or-update a survey by its client-generated UUID (POST /api/surveys/sync/).

    Returns (survey, created). Optimistically attempts to INSERT with the
    supplied id; the database's own primary-key uniqueness is what actually
    prevents two concurrent requests for the same new UUID from both
    succeeding — only one INSERT can win. The other (and any later retry)
    falls into the IntegrityError branch, where select_for_update() then
    serializes against any other concurrent updater of that same row before
    it applies the same payload.
    """
    geometry = Point(longitude, latitude, srid=4326)
    attributes = attributes or {}

    with transaction.atomic():
        try:
            with transaction.atomic():  # savepoint: isolate the failure below
                survey = Survey.objects.create(
                    id=id,
                    user=user,
                    name=name,
                    description=description,
                    image=image,
                    geometry=geometry,
                    accuracy=accuracy,
                    attributes=attributes,
                    sync_status=Survey.SyncStatus.SYNCED,
                )
            return survey, True
        except IntegrityError:
            survey = Survey.objects.select_for_update().get(pk=id)

            if survey.user_id != user.id:
                raise SurveyOwnershipConflict

            survey.name = name
            survey.description = description
            survey.image = image
            survey.geometry = geometry
            survey.accuracy = accuracy
            survey.attributes = attributes
            survey.sync_status = Survey.SyncStatus.SYNCED
            survey.save()
            return survey, False
