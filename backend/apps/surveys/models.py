import uuid

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.db import models

from .validators import validate_attributes, validate_survey_image


def survey_image_upload_path(instance, filename):
    return f"surveys/{instance.user_id}/{instance.id}/{filename}"


class Survey(models.Model):
    class SyncStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        SYNCING = "syncing", "Syncing"
        SYNCED = "synced", "Synced"
        FAILED = "failed", "Failed"

    # Client-generated: the offline PWA creates this UUID before the record
    # ever reaches the server. default=uuid.uuid4 only covers the case where
    # the backend itself originates a record without a client-supplied id.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=True)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="surveys"
    )

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")

    # One survey = one image, per the system design's single-record model.
    image = models.ImageField(
        upload_to=survey_image_upload_path, validators=[validate_survey_image]
    )

    geometry = gis_models.PointField(srid=4326)
    accuracy = models.FloatField(help_text="GPS accuracy in meters")

    attributes = models.JSONField(default=dict, blank=True, validators=[validate_attributes])

    sync_status = models.CharField(
        max_length=10, choices=SyncStatus.choices, default=SyncStatus.PENDING
    )
    retry_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # Serves the core access pattern: a user's non-deleted surveys.
            models.Index(fields=["user", "is_deleted"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.id})"
