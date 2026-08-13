from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "date_joined")
        read_only_fields = fields


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class SafeTokenRefreshSerializer(TokenRefreshSerializer):
    """TokenRefreshSerializer, but a well-formed token for a since-deleted
    user raises SimpleJWT's own InvalidToken (-> 401) instead of an
    unhandled User.DoesNotExist (-> 500)."""

    def validate(self, attrs):
        try:
            return super().validate(attrs)
        except User.DoesNotExist:
            raise InvalidToken("Token is invalid or expired")
