# Hut Hunter

License: GPL-3.0

Hut Hunter is a booking assistant for popular, hard-to-book huts and campsites. It monitors availability, sends alerts quickly, and can continue through the booking flow to secure a reservation hold so you do not lose your spot.

Today the app is centered on New Zealand DOC inventory and supports:

- Great Walks
- Standard huts
- Campsite-style booking workflows exposed through the current DOC adapters

Other booking sites are in the works (Canadian Provincial parks) as well as an agentic adapter builder to streamline extensible compatability. (See __Coming Soon__ below)

The product promise reflected in the welcome screen is the core of the app:

- **Availability checks** for preferred dates, direction, and party setup
- **Notifications** through email or Gotify
- **Booking holds and auto-booking** using saved site credentials and saved occupant details

## Repo notes

- This project is not affiliated with New Zealand DOC.
- Booking credentials and occupant details are user data. Treat this as a private app unless you are prepared to operate it responsibly.
- The production deployment path in this repo is aimed at a single-owner demo on a trusted host, not a hardened multi-tenant SaaS launch.

## What the app does

After sign-in, Hut Hunter gives each user a private workspace for:

- Creating watch jobs against a booking adapter
- Saving occupants once and reusing them across bookings
- Configuring notification settings for email or Gotify
- Saving adapter-specific booking credentials, encrypted at rest
- Turning monitoring on for scheduled checks or running manual checks on demand
- Auto-booking when every requested site is fully available
- Keeping a live held cart open through the DOC 25 minute hold for the user to finish payment
- Reviewing snapshots and artifacts from failed or successful automation runs

## Current product flow

1. A user registers or logs in.
2. The frontend loads the user session from `/api/v1/auth/me`.
3. The user configures occupants, adapter credentials, and notification targets.
4. The user creates a watch job with adapter-specific search parameters.
5. The poll worker checks availability on a schedule or via manual trigger.
6. If inventory is found, the app notifies the user or enqueues the hold worker.
7. The hold worker opens a headed Playwright browser, places the hold, and exposes the payment page over noVNC.
8. The user completes payment before the cart expires (25 minutes for DOC).

## Architecture Overview

The repo is split into a React frontend and a FastAPI backend, with Redis-backed background workers for polling and hold automation.

```text
frontend (React + Vite)
  -> calls FastAPI at /api/v1

backend API (FastAPI + SQLModel)
  -> Postgres for app data
  -> Redis/ARQ for background jobs
  -> adapter registry for site-specific automation

poll_worker
  -> headless Playwright availability detection
  -> notifications
  -> enqueue hold jobs when auto-book is allowed

hold_worker
  -> headed Playwright booking flow
  -> keeps payment page alive
  -> exposes noVNC session for user checkout
```

### Backend shape

- `backend/app/main.py`: FastAPI app startup, router mounting, `/health`, artifact hosting
- `backend/app/api/`: auth, jobs, holds, occupants, credentials, notifications
- `backend/app/models/`: SQLModel entities and API schemas
- `backend/app/adapters/`: adapter registry and site-specific booking logic
- `backend/app/workers/poll_worker.py`: scheduled availability checks
- `backend/app/workers/hold_worker.py`: hold placement and live checkout browser management
- `backend/migrations/`: Alembic migrations

### Frontend shape

- `frontend/src/App.tsx`: auth gate and authenticated shell
- `frontend/src/components/auth/`: login/register welcome experience
- `frontend/src/components/jobs/`: job creation, job list, status views, booking actions
- `frontend/src/components/occupants/`: saved camper management
- `frontend/src/components/credentials/`: adapter credential management
- `frontend/src/components/notifications/`: email and Gotify settings
- `frontend/src/lib/api.ts`: typed API client
- `frontend/src/store/jobs.ts`: shared client job state

## Tech Stack

### Frontend

- **React 19**: main UI runtime
- **TypeScript**: typed client code
- **Vite**: local dev server and build pipeline
- **TanStack Query**: server-state fetching and caching for auth, jobs, adapters, occupants, credentials, and notifications
- **Zustand**: lightweight client state for selected jobs and booking state
- **Tailwind CSS v4**: styling system
- **Radix UI + shadcn-style components**: dialog, input, switch, select, table, tooltip primitives
- **Lucide React**: iconography
- **Axios**: API client with cookie-based auth

How it is used:

- The frontend proxies `/api`, `/artifacts`, `/pay`, and `/jobs` to the backend during local development.
- Auth is cookie-backed, so the SPA does not manage raw JWTs directly.
- Adapter metadata from `/api/v1/adapters` drives the job form dynamically.

### Backend

- **FastAPI**: HTTP API and public routes
- **SQLModel + SQLAlchemy async**: models, persistence, and async DB access
- **PostgreSQL**: primary relational database
- **Alembic**: schema migrations
- **ARQ + Redis**: background job queue and scheduler
- **Playwright**: browser automation for availability detection and hold placement
- **python-jose**: signed auth session tokens
- **passlib[bcrypt]**: password hashing
- **cryptography / Fernet**: encryption for stored booking credentials and secrets
- **httpx + smtplib**: Gotify and email delivery

How it is used:

- The API handles user auth, CRUD for jobs and supporting records, and serves automation artifacts.
- The poll worker runs headless checks and decides whether to notify or escalate to booking.
- The hold worker runs headed Chromium, parks the payment page, and keeps the session active.
- Adapter classes encapsulate site-specific field definitions, detection logic, expiry rules, and optional hold flows.

## Supported Adapters

The current adapter registry includes:

- `doc_great_walk`
- `doc_standard_hut`

Each adapter publishes:

- search parameter definitions for the frontend form
- optional occupant field requirements
- whether credentials are required
- booking timezone and cutoff rules
- availability detection logic
- optional hold automation logic

## Installation

There are three practical ways to run the project.

### Option 1: Docker Compose for local development

This is the easiest path for local work because it includes Postgres, Redis, Mailpit, the API, and both workers.

1. Copy the example environment:

```bash
cp .env.example .env
```

2. Fill in at minimum:

- `SECRET_KEY`
- `ENCRYPTION_KEY`

Generate a Fernet key for `ENCRYPTION_KEY` with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

3. Start the stack:

```bash
docker compose -f docker-compose.dev.yml up --build
```

4. Start the frontend in a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

5. Open:

- Frontend: `http://localhost:5173`
- API health: `http://localhost:8000/health`
- Mailpit inbox: `http://localhost:8025`
- noVNC checkout session: `http://localhost:6080`

### Option 2: Production-style Docker deployment

Use this when deploying the demo to a NAS (including Synology Container Manager) or another always-on box and putting it behind Cloudflare Tunnel or another reverse proxy.

`docker-compose.yml` is the production stack. Container Manager and similar UIs pick it up automatically — no `-f` flag required.

What this stack does:

- builds the frontend into a static site
- serves the frontend and API from one public origin
- reverse-proxies noVNC through the same web entrypoint
- keeps Postgres, Redis, and the hold-worker VNC service off public ports

1. Copy environment config:

```bash
cp .env.example .env
```

2. Set production values:

- `ENVIRONMENT=production`
- `APP_URL=https://your-public-hostname`
- `VNC_URL=https://your-public-hostname` (optional; defaults to `APP_URL` in production)
- `SECRET_KEY` to a long random value
- `ENCRYPTION_KEY` to a generated Fernet key
- `POSTGRES_PASSWORD` to a real secret
- `SMTP_*` to a real provider
- `WEB_PORT` if the default host port `8080` is already taken (e.g. `8099` on a NAS)

3. Start the production stack:

```bash
docker compose up --build -d
```

In Synology Container Manager, point the project at this repo directory (or paste `docker-compose.yml` when creating the project) and rebuild from the UI.

4. Point your Cloudflare Tunnel or reverse proxy at:

- `http://<nas-or-docker-host>:${WEB_PORT:-8080}`

5. Open the app at your public hostname.

Important deployment notes:

- Keep `5432`, `6379`, and the worker-side VNC service unexposed.
- The pay page depends on WebSocket proxying for `/websockify`; make sure your tunnel/proxy allows WebSockets (Cloudflare Tunnel supports this by default).
- noVNC is served on the same public origin as the app (`/vnc.html`, `/websockify`); do not expose hold-worker port `6080` publicly.
- This stack intentionally does not include Mailpit.

### Option 3: Local backend + local frontend

Use this when you want to run Python and Node directly on your machine.

#### Prerequisites

- Python 3.13
- Node.js and npm
- PostgreSQL
- Redis
- Chromium installed for Playwright

#### Backend setup

1. Copy environment config:

```bash
cp .env.example .env
```

2. Create and activate a virtual environment, then install dependencies:

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

3. Install Playwright Chromium:

```bash
playwright install chromium
```

4. Make sure Postgres and Redis match the values in `.env`.

5. Run migrations:

```bash
alembic -c alembic.ini upgrade head
```

6. Start the API:

```bash
python run.py
```

7. In additional terminals, start the workers:

```bash
cd backend
source .venv/bin/activate
python bin/run_poll_worker.py
```

```bash
cd backend
source .venv/bin/activate
python bin/run_hold_worker.py
```

#### Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies backend routes to `http://localhost:8000`.

For the full headed booking session with browser sharing over noVNC, prefer the Docker Compose path. The local Python path runs the hold worker directly, but it does not provision the containerized Xvfb/x11vnc/noVNC stack for you.

## Environment Notes

Important variables from `.env.example`:

- `APP_URL`: public API/app base URL
- `DATABASE_URL`: async Postgres connection string
- `REDIS_URL`: Redis connection
- `SECRET_KEY`: signing key for session cookies
- `ENCRYPTION_KEY`: required to decrypt stored credentials and notification secrets
- `BROWSER_HEADLESS_DETECT`: whether availability detection runs headless
- `BROWSER_DISPLAY`: display target for headed booking automation
- `VNC_PORT` / `VNC_URL`: how users reach the live payment session
- `SMTP_*`: email delivery settings

## Testing

Backend tests are in `backend/tests`.

Run them with:

```bash
cd backend
source .venv/bin/activate
pytest
```

## Coming Soon

Planned extensions already suggested by the project structure and config:

- **Canadian Provincial Parks (Camis) adapters** — BC Parks and Ontario Parks, on a shared `BaseCamisAdapter`. Platform recon is documented in [`docs/adapters/camis-recon.md`](docs/adapters/camis-recon.md); adapter builds are logged against the [build-log template](docs/adapters/adapter-build-log-template.md)
- **More booking site adapters** beyond the current DOC flows
- **Broader campsite coverage** where the booking workflow is similar but not yet implemented
- **AI agent adapter builder** for unsupported booking sites, aimed at generating or scaffolding new adapter logic faster
- **A cleaner adapter onboarding path** so new providers can define params, credentials, occupant fields, detection rules, and hold automation with less hand-written boilerplate

The `ANTHROPIC_API_KEY` note in `.env.example` points at that future adapter-builder workflow, but it is not a production-ready feature yet.

## Repository Layout

```text
hut-hunter/
├── backend/
│   ├── app/
│   │   ├── adapters/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   └── workers/
│   ├── migrations/
│   ├── tests/
│   └── run.py
├── frontend/
│   ├── public/
│   └── src/
├── docker/
├── docker-compose.yml          # production / NAS (default)
├── docker-compose.dev.yml      # local development
└── Dockerfile
```

## Status

This repo is already a functional end-to-end booking automation system for the currently supported DOC flows, with user auth, monitoring, notifications, encrypted credentials, and hold automation wired together.
