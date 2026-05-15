@AGENTS.md

# AKAbench — Akamai GPU Benchmark Portal

Internal tool for Akamai Sales Engineers to run reproducible LLM inference benchmarks on NVIDIA GPU hardware and generate customer-facing reports. **Not accessible to external customers.**

## What this repo contains

| Directory | Purpose |
|---|---|
| `frontend/` | Next.js frontend + API (App Router, TypeScript, Tailwind v4, shadcn/ui) |
| `infra/yaml/` | Kubernetes Job manifests for benchmark runs (vLLM and TRT-LLM) |
| `functional.md` | Product-level feature spec — what the portal does and why |
| `technical.md` | Architecture and infrastructure decisions |
| `project.md` | Combined design document (superseded by functional.md + technical.md) |

## Current build status (MVP)

- Steps 1–3 of the 4-step wizard are functional (model search, engine/quant selection, hardware selection)
- Step 4 (Run & Report) is **not yet implemented** — job execution and SSE streaming are out of scope for MVP; report viewing (`/api/reports`) is implemented
- Authentication is static display only — SSO integration is post-MVP
- Database is in-memory — no Postgres yet

## Running the project

```bash
cd frontend
npm run dev    # http://localhost:3000
npm run build
npm run lint
```

## Key decisions already made

- **API server:** Next.js Route Handlers — no separate FastAPI backend for MVP
- **Job queue:** Not implemented yet — infra/yaml/ templates are for the real backend
- **Engine recommendation logic** lives in `frontend/src/lib/enrichment/engine.ts` and is called exclusively via the `/api/models/[id]/derive` route — panels never compute compatibility themselves
- **Always pin image versions** in K8s manifests — never `:latest` in production
