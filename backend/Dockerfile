# Render's native Python runtime has no way to install system packages, but
# GeoDjango needs the GEOS/GDAL/PROJ C libraries - not just Python packages -
# so this app must deploy via Render's Docker runtime, not the buildpack one.
FROM python:3.13-slim

# Standard GeoDjango dependency list for Debian/Ubuntu (per Django's own
# GeoDjango install docs) - gdal-bin pulls in libgdal/libgeos/libproj.
RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils gdal-bin libproj-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Needs no database - only reads INSTALLED_APPS' static assets - so this is
# safe to run at build time before any real environment variables exist.
# DJANGO_SECRET_KEY/DEBUG fall back to their insecure local-dev defaults for
# this step only, which is fine since nothing here touches request handling.
RUN python manage.py collectstatic --noinput

# Render injects the actual port to bind via $PORT at container start - it's
# not known at build time, so this can't be a fixed EXPOSE/--bind value.
#
# Migrations run here, not as a Render "pre-deploy command" - that feature
# requires a paid plan. Running migrate on every container start (every
# deploy, and every free-tier sleep/wake cycle) is safe: it's a no-op when
# there's nothing new to apply.
#
# createsuperuser --noinput is the same idea, for the same reason: Render's
# free tier also has no Shell access to run it interactively. It reads
# DJANGO_SUPERUSER_USERNAME/EMAIL/PASSWORD from the environment (Django's own
# convention for this exact flag - see its createsuperuser docs) and is
# grouped with `|| true` so a second run (the user already exists) doesn't
# fail the whole startup chain - only a genuine `migrate` failure should ever
# stop gunicorn from starting. Local dev is unaffected: those env vars are
# unset there, so this step no-ops (missing required fields) and does
# nothing, same as always.
CMD python manage.py migrate && (python manage.py createsuperuser --noinput || true) && gunicorn config.wsgi:application --bind 0.0.0.0:$PORT
