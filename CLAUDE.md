@AGENTS.md

# AKAbench — Akamai GPU Benchmark Portal

Internal tool for Akamai Sales Engineers to run reproducible LLM inference benchmarks on NVIDIA GPU hardware and generate customer-facing reports. **Not accessible to external customers.**

## What this repo contains

| Directory | Purpose |
|---|---|
| `frontend/` | Next.js 15 frontend + API (App Router, TypeScript, Tailwind v4, shadcn/ui) |
| `backend/` | Python job controller (NATS consumer → K8s submitter → Postgres writer) + Jinja2 manifests |
| `db/` | Postgres `schema.sql` + `migrations/` (catalogue seed) |
| `deploy/` | K8s manifests (`infra/`, `app/`) and local docker-compose (`local/`) |
| `tests/` | E2E test runbook |
| `functional.md` | Product-level feature spec — what the portal does and why |
| `technical.md` | Architecture and infrastructure decisions |
| `project.md` | Combined design document (superseded by functional.md + technical.md) |

## Current build status

- All four wizard steps are functional end-to-end. Job submission, K8s execution, and report viewing all work.
- The Python job controller consumes from NATS JetStream (`JOBS` stream), renders Jinja2 manifests (vLLM or SGLang), and writes status back to Postgres.
- TRT-LLM is **not currently executable** — the backend renderer and templates have been removed. The frontend recommendation logic still emits `'trt-llm'` for NGC / NVIDIA-vendor models; the user must override before submitting.
- Authentication is an HMAC-signed `aka_session` cookie with a single hardcoded user (`akamai` / `akabench`). SSO is still post-MVP.
- Catalogue lives in Postgres (`models` table, seeded via `db/migrations/0001_seed_models.sql`).

## Running the project

```bash
# Infra (Postgres + NATS)
cd deploy/local && docker compose up -d

# Schema + catalogue seed
docker exec -i local-postgres-1 psql -U akabench -d akabench < db/schema.sql
docker exec -i local-postgres-1 psql -U akabench -d akabench < db/migrations/0001_seed_models.sql

# Frontend
cd frontend && npm run dev    # http://localhost:3000

# Job controller (separate terminal)
cd backend && .venv/bin/python -m job_controller.main
```

## Key decisions already made

- **API server:** Next.js Route Handlers — no separate FastAPI service for the web app. The `collector_api` FastAPI process is part of the Python job controller, used only by results-collector pods.
- **Job queue:** NATS JetStream (`JOBS` + `JOBS_DLQ` streams). The NATS payload is `{ job_id }` only — Postgres is the source of truth.
- **Engine recommendation logic** lives in `frontend/src/lib/enrichment/engine.ts` and is called exclusively via the `/api/models/derive` route — panels never compute compatibility themselves.
- **Always pin image versions** in K8s manifests — never `:latest` in production.
