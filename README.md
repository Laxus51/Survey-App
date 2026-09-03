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
# Leave VITE_API_BASE_URL blank - it falls back to the page's own origin,
# and Vite's dev-server proxy (vite.config.ts) forwards /api and /media to
# the backend. Only set it to an absolute URL for a real deploy where the
# frontend and backend are on different domains (see Deployment below).

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

## Deployment

**Frontend → Vercel. Backend + Postgres → Render. Survey photos → Cloudflare R2.**

Not ngrok: ngrok requires your own machine and the tunnel to be running at
the exact moment someone opens the link, which doesn't work for an async
review. Not Render's local disk for media: Render's filesystem is
ephemeral (a photo saved to `backend/media/` is lost on the next
restart/redeploy), and `urls.py` only serves `/media/*` when `DEBUG=True` —
in a real deploy (`DEBUG=False`, as it must be), images wouldn't be
reachable at all without a real storage backend, not just fragile. R2 is
free (10GB, no egress fees) and S3-compatible, so it's a small
`django-storages` config, not a rewrite.

GeoDjango needs the GEOS/GDAL system libraries, which Render's native Python
runtime can't install (no root/apt access) — that's why this app deploys on
Render via **Docker** (`backend/Dockerfile`), not the plain Python buildpack.

### 1. Cloudflare R2 (survey photos)

1. Create an R2 bucket (e.g. `survey-app-media`).
2. Enable public access on it (R2.dev subdomain is enough) so photo URLs are
   directly viewable.
3. Create an API token scoped to Object Read & Write on that bucket. Note
   down: Account ID, Access Key ID, Secret Access Key, the bucket's public
   R2.dev domain, and the account's S3 API endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).

### 2. Render (backend + Postgres)

`render.yaml` (repo root) is a Blueprint that provisions the Postgres
instance and the Docker web service together — in Render, "New" →
"Blueprint", point it at this repo; Render auto-detects it since it's at
the repo root.

After it provisions:

1. **Enable PostGIS once**, via Render's psql shell against the new
   database: `CREATE EXTENSION postgis;`
2. **Fill in the env vars the Blueprint left blank** (`sync: false` in
   `render.yaml`) on the web service:
   - `DJANGO_ALLOWED_HOSTS` — this service's own hostname, e.g.
     `survey-app-backend.onrender.com`
   - `CORS_ALLOWED_ORIGINS` — the Vercel frontend's URL (step 3) — comes back
     to this after step 3, since it isn't known until then
   - `AWS_STORAGE_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
     `AWS_S3_ENDPOINT_URL`, `AWS_S3_CUSTOM_DOMAIN` — from step 1
3. Migrations run automatically on every container start (baked into
   `backend/Dockerfile`'s start command, not a Render "pre-deploy command" —
   that feature needs a paid plan). Create the admin login once, via Render's
   shell: `python manage.py createsuperuser`

### 3. Vercel (frontend)

1. Import this repo, set **Root Directory** to `frontend`.
2. Set the environment variable `VITE_API_BASE_URL` to the Render backend's
   URL from step 2 (e.g. `https://survey-app-backend.onrender.com`) —
   `frontend/vercel.json`'s SPA rewrite is already committed, so client-side
   routes like `/surveys/new` won't 404 on refresh.
3. Deploy. Take the resulting `*.vercel.app` URL back to step 2's
   `CORS_ALLOWED_ORIGINS`.

### Verifying it worked

- `curl https://<render-backend>/api/auth/login` (should reject with a real
  405/401, not a connection error) confirms the backend is up and migrated.
- Log in on the deployed frontend, capture or view a survey, and confirm the
  photo actually loads from the R2 URL — that's the whole point of this
  setup, so don't skip it.

---

## Keeping this file current

This file should get a one- or two-line update whenever a change affects how
someone else sets up or runs the project: a new required env var, a changed
dependency-install step, a new prerequisite, a new gitignored folder that
needs separate handoff (like `media/` above). Treat it as living
documentation, not a one-time setup note — update it in the same change that
introduces the thing it needs to describe, not as an afterthought later.
