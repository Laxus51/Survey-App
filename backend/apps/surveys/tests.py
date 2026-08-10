import io
import shutil
import tempfile
import threading
import uuid

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import Survey

User = get_user_model()


def make_image_file(name="photo.jpg", fmt="JPEG", size_bytes=None):
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), color="red").save(buffer, format=fmt)
    content = buffer.getvalue()
    if size_bytes is not None:
        content += b"0" * max(0, size_bytes - len(content))
    content_type = "image/jpeg" if fmt == "JPEG" else "image/webp"
    return SimpleUploadedFile(name, content, content_type=content_type)


_TEST_MEDIA_ROOT = tempfile.mkdtemp(prefix="survey_app_test_media_")


@override_settings(MEDIA_ROOT=_TEST_MEDIA_ROOT)
class SurveyAPITestCase(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_TEST_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        self.user = User.objects.create_user(username="surveyor1", password="pass12345!")
        self.other_user = User.objects.create_user(username="surveyor2", password="pass12345!")
        self.list_url = reverse("survey-list-create")
        self.sync_url = reverse("survey-sync")

    def detail_url(self, pk):
        return reverse("survey-detail", args=[pk])

    def valid_payload(self, **overrides):
        payload = {
            "name": "Utility Pole 12",
            "description": "Near the intersection",
            "image": make_image_file(),
            "latitude": 33.6844,
            "longitude": 73.0479,
            "accuracy": 5.5,
            "attributes": '{"Pole Height": "12", "Transformer": "Yes"}',
        }
        payload.update(overrides)
        return payload


class SurveyCreateTests(SurveyAPITestCase):
    def test_create_survey_success(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["name"], "Utility Pole 12")
        self.assertEqual(response.data["latitude"], 33.6844)
        self.assertEqual(response.data["longitude"], 73.0479)

    def test_create_requires_authentication(self):
        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_sets_owner_to_authenticated_user(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")

        survey = Survey.objects.get(pk=response.data["id"])
        self.assertEqual(survey.user, self.user)

    def test_client_supplied_uuid_is_persisted(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())

        response = self.client.post(
            self.list_url, self.valid_payload(id=client_id), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["id"], client_id)
        self.assertTrue(Survey.objects.filter(pk=client_id).exists())

    def test_id_auto_generated_when_omitted(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        # Raises ValueError if not a valid UUID.
        uuid.UUID(response.data["id"])

    def test_duplicate_client_supplied_uuid_is_rejected(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())
        self.client.post(self.list_url, self.valid_payload(id=client_id), format="multipart")

        response = self.client.post(
            self.list_url, self.valid_payload(id=client_id), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_image_is_stored(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")

        survey = Survey.objects.get(pk=response.data["id"])
        self.assertTrue(survey.image.name)
        self.assertTrue(survey.image.storage.exists(survey.image.name))
        survey.image.delete(save=False)

    def test_webp_image_is_accepted(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url,
            self.valid_payload(image=make_image_file(name="photo.webp", fmt="WEBP")),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_invalid_image_type_is_rejected(self):
        self.client.force_authenticate(self.user)
        bogus_file = SimpleUploadedFile(
            "not-an-image.jpg", b"this is not image data", content_type="image/jpeg"
        )

        response = self.client.post(
            self.list_url, self.valid_payload(image=bogus_file), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("image", response.data)

    def test_unsupported_image_format_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url,
            self.valid_payload(image=make_image_file(name="photo.png", fmt="PNG")),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("image", response.data)

    def test_oversized_image_is_rejected(self):
        self.client.force_authenticate(self.user)
        oversized = make_image_file(size_bytes=11 * 1024 * 1024)

        response = self.client.post(
            self.list_url, self.valid_payload(image=oversized), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("image", response.data)

    def test_missing_name_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url, self.valid_payload(name=""), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.data)

    def test_invalid_latitude_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url, self.valid_payload(latitude=200), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("latitude", response.data)

    def test_invalid_longitude_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url, self.valid_payload(longitude=-200), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("longitude", response.data)

    def test_negative_accuracy_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url, self.valid_payload(accuracy=-1), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("accuracy", response.data)

    def test_attributes_persisted_as_jsonb(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")

        survey = Survey.objects.get(pk=response.data["id"])
        self.assertEqual(survey.attributes, {"Pole Height": "12", "Transformer": "Yes"})

    def test_attributes_non_object_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url, self.valid_payload(attributes="[1, 2, 3]"), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("attributes", response.data)

    def test_attributes_with_non_string_value_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.list_url,
            self.valid_payload(attributes='{"Pole Height": 12}'),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("attributes", response.data)


class SurveyListTests(SurveyAPITestCase):
    def _create_survey(self, user, **overrides):
        self.client.force_authenticate(user)
        response = self.client.post(self.list_url, self.valid_payload(**overrides), format="multipart")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        return response.data["id"]

    def test_list_returns_only_authenticated_users_surveys(self):
        self._create_survey(self.user)
        self._create_survey(self.other_user)

        self.client.force_authenticate(self.user)
        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)

    def test_list_excludes_soft_deleted_surveys(self):
        survey_id = self._create_survey(self.user)
        self.client.force_authenticate(self.user)
        self.client.delete(self.detail_url(survey_id))

        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 0)

    def test_list_is_paginated(self):
        for _ in range(3):
            self._create_survey(self.user)
        self.client.force_authenticate(self.user)

        response = self.client.get(self.list_url, {"page_size": 2})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIsNotNone(response.data["next"])

    def test_list_requires_authentication(self):
        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class SurveyDetailTests(SurveyAPITestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.user)
        response = self.client.post(self.list_url, self.valid_payload(), format="multipart")
        self.survey_id = response.data["id"]

    def test_owner_can_retrieve_survey(self):
        response = self.client.get(self.detail_url(self.survey_id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], self.survey_id)

    def test_other_user_cannot_retrieve_survey(self):
        self.client.force_authenticate(self.other_user)

        response = self.client.get(self.detail_url(self.survey_id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_requires_authentication(self):
        self.client.force_authenticate(None)

        response = self.client.get(self.detail_url(self.survey_id))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_owner_can_update_survey(self):
        response = self.client.put(
            self.detail_url(self.survey_id),
            self.valid_payload(name="Updated Pole Name"),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["name"], "Updated Pole Name")
        self.assertEqual(Survey.objects.get(pk=self.survey_id).name, "Updated Pole Name")

    def test_other_user_cannot_update_survey(self):
        self.client.force_authenticate(self.other_user)

        response = self.client.put(
            self.detail_url(self.survey_id),
            self.valid_payload(name="Hijacked"),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_owner_can_soft_delete_survey(self):
        response = self.client.delete(self.detail_url(self.survey_id))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        survey = Survey.objects.get(pk=self.survey_id)
        self.assertTrue(survey.is_deleted)

    def test_soft_deleted_survey_not_retrievable_by_owner(self):
        self.client.delete(self.detail_url(self.survey_id))

        response = self.client.get(self.detail_url(self.survey_id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_other_user_cannot_delete_survey(self):
        self.client.force_authenticate(self.other_user)

        response = self.client.delete(self.detail_url(self.survey_id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(Survey.objects.get(pk=self.survey_id).is_deleted)


class SurveySyncTests(SurveyAPITestCase):
    def test_new_uuid_creates_survey(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())

        response = self.client.post(
            self.sync_url, self.valid_payload(id=client_id), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["id"], client_id)
        self.assertTrue(response.data["created"])
        self.assertEqual(Survey.objects.filter(pk=client_id).count(), 1)

    def test_sync_requires_client_supplied_id(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.sync_url, self.valid_payload(), format="multipart")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("id", response.data)

    def test_synced_survey_is_owned_by_authenticated_user(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())

        self.client.post(self.sync_url, self.valid_payload(id=client_id), format="multipart")

        self.assertEqual(Survey.objects.get(pk=client_id).user, self.user)

    def test_repeating_same_sync_does_not_create_duplicate(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())
        payload = self.valid_payload(id=client_id)

        first = self.client.post(self.sync_url, payload, format="multipart")
        second = self.client.post(
            self.sync_url, self.valid_payload(id=client_id), format="multipart"
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertFalse(second.data["created"])
        self.assertEqual(Survey.objects.filter(pk=client_id).count(), 1)

    def test_repeated_sync_updates_same_record(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())
        self.client.post(
            self.sync_url, self.valid_payload(id=client_id, name="First Name"), format="multipart"
        )

        response = self.client.post(
            self.sync_url,
            self.valid_payload(id=client_id, name="Resynced Name"),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["id"], client_id)
        self.assertEqual(Survey.objects.get(pk=client_id).name, "Resynced Name")

    def test_sync_of_another_users_uuid_is_rejected(self):
        self.client.force_authenticate(self.other_user)
        client_id = str(uuid.uuid4())
        self.client.post(self.sync_url, self.valid_payload(id=client_id), format="multipart")

        self.client.force_authenticate(self.user)
        response = self.client.post(
            self.sync_url,
            self.valid_payload(id=client_id, name="Hijack attempt"),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        survey = Survey.objects.get(pk=client_id)
        self.assertEqual(survey.user, self.other_user)
        self.assertNotEqual(survey.name, "Hijack attempt")

    def test_sync_image_is_stored(self):
        self.client.force_authenticate(self.user)
        client_id = str(uuid.uuid4())

        response = self.client.post(
            self.sync_url, self.valid_payload(id=client_id), format="multipart"
        )

        survey = Survey.objects.get(pk=client_id)
        self.assertTrue(survey.image.name)
        self.assertTrue(survey.image.storage.exists(survey.image.name))

    def test_sync_invalid_image_is_rejected(self):
        self.client.force_authenticate(self.user)
        bogus_file = SimpleUploadedFile(
            "not-an-image.jpg", b"this is not image data", content_type="image/jpeg"
        )

        response = self.client.post(
            self.sync_url,
            self.valid_payload(id=str(uuid.uuid4()), image=bogus_file),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("image", response.data)

    def test_sync_invalid_coordinates_are_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.sync_url,
            self.valid_payload(id=str(uuid.uuid4()), latitude=200),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("latitude", response.data)

    def test_sync_invalid_attributes_are_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.sync_url,
            self.valid_payload(id=str(uuid.uuid4()), attributes='{"Height": 12}'),
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("attributes", response.data)

    def test_sync_requires_authentication(self):
        response = self.client.post(
            self.sync_url, self.valid_payload(id=str(uuid.uuid4())), format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


@override_settings(MEDIA_ROOT=_TEST_MEDIA_ROOT)
class SurveySyncConcurrencyTests(TransactionTestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_TEST_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        self.user = User.objects.create_user(username="surveyor1", password="pass12345!")
        self.sync_url = reverse("survey-sync")

    def test_concurrent_sync_requests_for_same_uuid_do_not_duplicate(self):
        client_id = str(uuid.uuid4())
        status_codes = []
        errors = []

        def do_sync():
            try:
                client = APIClient()
                client.force_authenticate(self.user)
                response = client.post(
                    self.sync_url,
                    {
                        "id": client_id,
                        "name": "Concurrent Pole",
                        "description": "",
                        "latitude": 33.6844,
                        "longitude": 73.0479,
                        "accuracy": 5.0,
                        "attributes": "{}",
                        "image": make_image_file(),
                    },
                    format="multipart",
                )
                status_codes.append(response.status_code)
            except Exception as exc:  # pragma: no cover - surfaced via errors list
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=do_sync) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        self.assertEqual(Survey.objects.filter(pk=client_id).count(), 1)
        self.assertEqual(status_codes.count(status.HTTP_201_CREATED), 1)
        self.assertEqual(status_codes.count(status.HTTP_200_OK), 5)
