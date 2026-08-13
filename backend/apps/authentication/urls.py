from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView

from .views import LogoutView, MeView, SafeTokenRefreshView

urlpatterns = [
    path("login", TokenObtainPairView.as_view(), name="auth-login"),
    path("refresh", SafeTokenRefreshView.as_view(), name="auth-refresh"),
    path("logout", LogoutView.as_view(), name="auth-logout"),
    path("me", MeView.as_view(), name="auth-me"),
]
