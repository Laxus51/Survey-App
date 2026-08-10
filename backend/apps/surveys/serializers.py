from rest_framework import serializers

from .models import Survey
from .services import create_survey, update_survey
from .validators import validate_attributes, validate_survey_image


class SurveySerializer(serializers.ModelSerializer):
    # Optional: the offline PWA generates this UUID client-side before the
    # record ever reaches the server. Omitted -> the model default applies.
    id = serializers.UUIDField(required=False)

    # Not real model fields — geometry is a single PostGIS Point built from
    # these two inputs. Write-only here; injected back into the read
    # representation in to_representation() below.
    latitude = serializers.FloatField(write_only=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(write_only=True, min_value=-180, max_value=180)

    accuracy = serializers.FloatField(min_value=0)
    attributes = serializers.JSONField(required=False, validators=[validate_attributes])
    image = serializers.ImageField(validators=[validate_survey_image])

    class Meta:
        model = Survey
        fields = [
            "id",
            "user",
            "name",
            "description",
            "image",
            "latitude",
            "longitude",
            "accuracy",
            "attributes",
            "sync_status",
            "retry_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["user", "sync_status", "retry_count", "created_at", "updated_at"]

    def validate_id(self, value):
        if self.instance is None and Survey.objects.filter(pk=value).exists():
            raise serializers.ValidationError("A survey with this id already exists.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.geometry is not None:
            data["latitude"] = instance.geometry.y
            data["longitude"] = instance.geometry.x
        return data

    def create(self, validated_data):
        return create_survey(user=self.context["request"].user, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("id", None)
        return update_survey(instance, **validated_data)


class SurveySyncSerializer(SurveySerializer):
    """Used only by POST /api/surveys/sync/.

    Same field-level validation as SurveySerializer (name, image, lat/lng,
    accuracy, attributes) reused as-is. Differs only in what "id" means: it's
    required (sync is always for a client-generated UUID), and an id that
    already exists is not itself an error — the service layer decides
    whether that's a same-user retry (update) or a different-user conflict
    (rejected), which plain create() does not need to handle.
    """

    id = serializers.UUIDField(required=True)

    def validate_id(self, value):
        return value
