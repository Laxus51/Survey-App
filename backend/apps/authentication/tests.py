from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()


class AuthenticationTests(APITestCase):
    def setUp(self):
        self.password = "StrongPass123!"
        self.user = User.objects.create_user(
            username="surveyor1", email="surveyor1@example.com", password=self.password
        )
        self.login_url = reverse("auth-login")
        self.refresh_url = reverse("auth-refresh")
        self.logout_url = reverse("auth-logout")
        self.me_url = reverse("auth-me")

    def _login(self):
        response = self.client.post(
            self.login_url, {"username": "surveyor1", "password": self.password}
        )
        return response.data

    def _auth_header(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_login_success_returns_access_and_refresh_tokens(self):
        response = self.client.post(
            self.login_url, {"username": "surveyor1", "password": self.password}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_login_with_invalid_credentials_is_rejected(self):
        response = self.client.post(
            self.login_url, {"username": "surveyor1", "password": "wrong-password"}
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_with_valid_token_returns_current_user(self):
        tokens = self._login()

        response = self.client.get(self.me_url, **self._auth_header(tokens["access"]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], "surveyor1")
        self.assertEqual(response.data["email"], "surveyor1@example.com")

    def test_me_without_authentication_is_rejected(self):
        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_token_issues_new_access_token(self):
        tokens = self._login()

        response = self.client.post(self.refresh_url, {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        # ROTATE_REFRESH_TOKENS is on, so a new refresh token is also issued.
        self.assertIn("refresh", response.data)

    def test_refresh_with_invalid_token_is_rejected(self):
        response = self.client.post(self.refresh_url, {"refresh": "not-a-real-token"})

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_blacklists_refresh_token(self):
        tokens = self._login()

        logout_response = self.client.post(
            self.logout_url,
            {"refresh": tokens["refresh"]},
            **self._auth_header(tokens["access"]),
        )
        self.assertEqual(logout_response.status_code, status.HTTP_205_RESET_CONTENT)

        # The blacklisted refresh token must no longer be usable.
        reuse_response = self.client.post(self.refresh_url, {"refresh": tokens["refresh"]})
        self.assertEqual(reuse_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_without_authentication_is_rejected(self):
        response = self.client.post(self.logout_url, {"refresh": "irrelevant"})

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
