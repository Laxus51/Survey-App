from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "WEBP"}


def validate_survey_image(file):
    if file.size > MAX_IMAGE_SIZE_BYTES:
        raise ValidationError("Image exceeds the maximum allowed size of 10 MB.")

    try:
        file.seek(0)
        image = Image.open(file)
        image_format = image.format
        image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError("Uploaded file is not a valid image.") from exc
    finally:
        file.seek(0)

    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError("Unsupported image type. Only JPEG and WebP are allowed.")


def validate_attributes(value):
    if not isinstance(value, dict):
        raise ValidationError("attributes must be a JSON object.")

    for key, val in value.items():
        if not isinstance(key, str) or not key.strip():
            raise ValidationError("attributes keys must be non-empty strings.")
        if not isinstance(val, str):
            raise ValidationError(f"attributes value for '{key}' must be a string.")
