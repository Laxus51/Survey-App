from django.contrib.gis.geos import Point

from .models import Survey


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
