from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken


def blacklist_refresh_token(refresh_token: str) -> None:
    """Invalidate a refresh token so it can no longer be used to obtain new access tokens.

    Raises TokenError if the token is malformed, expired, or already blacklisted.
    """
    token = RefreshToken(refresh_token)
    token.blacklist()
