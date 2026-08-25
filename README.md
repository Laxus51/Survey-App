# Survey App

Offline-first field-survey app. Surveyors capture a photo, GPS location, and
custom attributes on their phone (works fully offline, syncs when back
online); a corporate-styled dashboard lets them review pending/synced
surveys. React 19 + TypeScript + Vite PWA frontend, Django REST Framework +
PostGIS backend.

```
backend/    Django REST Framework + GeoDjango/PostGIS API
frontend/   React + TypeScript + Vite PWA, Tailwind v4 + daisyUI
```

---

## Prerequisites

- **Python 3.13+** and **PostgreSQL with the PostGIS extension** installed locally
- **Node.js 20+** and npm
- On Windows, GeoDjango needs the GEOS/GDAL native libraries. These normally
  ship alongside a local PostgreSQL install (e.g. `C:\Program Files\PostgreSQL\18\bin\`)
  — you just need to point `.env` at them (see below). On Linux/macOS, Django's
  own auto-detection usually finds them without any extra config.

## Backend setup (`backend/`)

Dependencies are pinned in `requirements.txt` — that's the source of truth for
what to install.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

copy .env.example .env
# edit .env: at minimum set DB_PASSWORD, and on Windows set
# GEOS_LIBRARY_PATH / GDAL_LIBRARY_PATH to your local PostgreSQL bin folder

# create the Postgres database first (with PostGIS enabled), then:
python manage.py migrate
python manage.py createsuperuser   # needed to log into the app itself
python manage.py runserver
```

Run backend tests with `python manage.py test`.

## Frontend setup (`frontend/`)

Dependencies are declared in `package.json` (exact resolved versions locked
in `package-lock.json`) — `npm install` reads both.

```powershell
cd frontend
npm install

copy .env.example .env.development
# VITE_API_BASE_URL defaults to http://localhost:8000, which matches the
# backend's default runserver port - usually no edit needed for local dev

npm run dev
```

Run frontend tests with `npm run test`, lint with `npm run lint`, and build
a production bundle with `npm run build` (only the production build via
`npm run preview` has a real service worker/PWA behavior — `npm run dev`
does not).

## Handing off / sharing a database backup

`backend/media/` (survey photos) is gitignored on purpose — user-uploaded
binary content doesn't belong in git. That means **a database backup alone
never includes the actual photos**: Postgres only stores each survey's image
as a file *path* (e.g. `surveys/7/<uuid>/photo.jpg`); the file itself lives
on disk under `backend/media/`, completely separate from the database.

Whenever you share a DB backup with someone (a teammate, a reviewer), also
zip and send `backend/media/`:

```powershell
# from the repo root
Compress-Archive -Path backend\media\* -DestinationPath survey-media.zip
```

The person receiving it needs to extract that zip into their own
`backend\media\` (same relative path) *before* running the app, or every
survey's image will 404:

```powershell
Expand-Archive -Path survey-media.zip -DestinationPath backend\media
```

Take the DB backup and the media zip at the same time, from the same state
of the app — a mismatch between them (rows referencing images that weren't
included, or vice versa) is the actual failure mode this whole step exists
to avoid.

---

## Keeping this file current

This file should get a one- or two-line update whenever a change affects how
someone else sets up or runs the project: a new required env var, a changed
dependency-install step, a new prerequisite, a new gitignored folder that
needs separate handoff (like `media/` above). Treat it as living
documentation, not a one-time setup note — update it in the same change that
introduces the thing it needs to describe, not as an afterthought later.
