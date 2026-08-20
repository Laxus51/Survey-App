"""
Django settings for config project.

Environment-driven configuration: all deployment-specific values are read
from environment variables (see .env.example), so the same codebase runs
across local dev, CI, and future production environments without edits.
"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-dev-key-change-me")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env_bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# Dev-only, off by default: when Django sits behind a local HTTPS tunnel
# (e.g. ngrok) that terminates TLS and forwards plain HTTP, request.scheme
# is "http" unless told otherwise, so request.build_absolute_uri() (used for
# SurveySerializer's image URLs) would return http:// URLs that an https
# phone browser blocks as mixed content. Enabling this makes Django trust
# the tunnel's X-Forwarded-Proto header instead. Not a custom proxy
# implementation - this is Django's own built-in mechanism. Only enable this
# when the app is exclusively reached through such a proxy (as in this
# ngrok setup); it must stay off wherever Django is otherwise reachable
# directly, since Django trusts this header unconditionally once set.
if env_bool("DJANGO_TRUST_X_FORWARDED_PROTO", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    # Local apps
    "apps.authentication",
    "apps.surveys",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database
# https://docs.djangoproject.com/en/6.1/ref/settings/#databases
# Engine is GeoDjango's PostGIS backend, per the approved PostgreSQL + PostGIS
# architecture. No models are defined against it yet (Phase 2).

DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": os.environ.get("DB_NAME", "survey_app"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
    }
}

# GeoDjango needs GEOS/GDAL native libraries. On Windows these often aren't on
# PATH under the filenames Django's auto-detection expects, so point at them
# explicitly when present (e.g. bundled with a local PostgreSQL/PostGIS
# install). Leave unset elsewhere and Django's own auto-detection applies.
_GEOS_LIBRARY_PATH = os.environ.get("GEOS_LIBRARY_PATH")
if _GEOS_LIBRARY_PATH and Path(_GEOS_LIBRARY_PATH).exists():
    GEOS_LIBRARY_PATH = _GEOS_LIBRARY_PATH

_GDAL_LIBRARY_PATH = os.environ.get("GDAL_LIBRARY_PATH")
if _GDAL_LIBRARY_PATH and Path(_GDAL_LIBRARY_PATH).exists():
    GDAL_LIBRARY_PATH = _GDAL_LIBRARY_PATH


# Password validation
# https://docs.djangoproject.com/en/6.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# Internationalization
# https://docs.djangoproject.com/en/6.1/topics/i18n/

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


# Static & media files
# https://docs.djangoproject.com/en/6.1/howto/static-files/
# Media root is local disk for the MVP (see system design, Section 3);
# object storage is an explicitly deferred future step, not implemented here.

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Email
# https://docs.djangoproject.com/en/6.1/topics/email/#topic-email-configuration

MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.console.EmailBackend",
    },
}


# Django REST Framework
# JWT auth wiring only (SimpleJWT) — no login/logout/me/refresh views are
# implemented yet; that is Phase 2.

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=int(os.environ.get("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", 30))
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=int(os.environ.get("JWT_REFRESH_TOKEN_LIFETIME_DAYS", 7))
    ),
    "ROTATE_REFRESH_TOKENS": True,
    # Paired with ROTATE_REFRESH_TOKENS: without this, an old refresh token
    # remains valid after being rotated, which defeats the point of rotation.
    "BLACKLIST_AFTER_ROTATION": True,
}


# CORS
# Allows the locally-run Vite dev server to call this API during development.

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
)
