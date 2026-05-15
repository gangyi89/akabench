# Agent Guide — AKAbench (root)

This document covers the full project. For frontend-specific conventions (TypeScript rules, shadcn/ui, component patterns, state management) read **`frontend/AGENTS.md`** — it is the authoritative guide for any work inside `frontend/`.

---

## Project Overview

**AKAbench** is an internal Akamai portal for Sales Engineers to benchmark LLM inference on NVIDIA GPU hardware and produce customer-facing reports. Engineers select a model, inference engine, hardware tier, and load parameters, then trigger a live benchmark run. Results are written back to Postgres + Linode Object Storage and surfaced on the Jobs and Reports pages.

**Supported engines (executable):** vLLM (throughput) and SGLang (latency / structured generation). TensorRT-LLM is referenced by the frontend recommendation logic but is **not currently executable** — the backend templates and renderer have been removed pending a working NGC path. See "Engine Paths" below.
**Supported hardware:** RTX 4000 Ada (20 GB VRAM) and RTX Pro 6000 (96 GB VRAM, NVFP4-capable)
**Benchmark tool:** NVIDIA AIPerf

---

## Repository Layout

```
akabench/
├── CLAUDE.md              # Root context file → @AGENTS.md
├── AGENTS.md              # This file
├── README.md              # Architecture, local dev, deploy instructions
├── Makefile               # build / push / release / deploy targets
├── functional.md          # Product spec — portal UX, model catalogue, advisor logic
├── technical.md           # Architecture — K8s lifecycle, engine paths, API contract
├── project.md             # Earlier combined doc (superseded; for historical context only)
│
├── frontend/                  # Next.js 15 app (frontend + API routes)
│   ├── CLAUDE.md          # → @AGENTS.md
│   ├── AGENTS.md          # ← Read this for all frontend work
│   ├── Dockerfile         # Multi-stage standalone build (node:20-alpine)
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # Landing page (marketing + LoginModal entry)
│       │   ├── landing.css            # Landing-page-only styles
│       │   ├── portal/page.tsx        # Configure wizard (4-panel layout, auth-gated)
│       │   ├── jobs/page.tsx          # Jobs list (SWR 5s refresh)
│       │   ├── jobs/[id]/page.tsx     # Job detail (logs + report download)
│       │   ├── reports/page.tsx       # Reports list
│       │   ├── reports/[id]/page.tsx  # Report detail
│       │   ├── layout.tsx
│       │   └── api/
│       │       ├── auth/              # /login, /logout, /me — HMAC session cookies
│       │       ├── hardware/route.ts  # GET /api/hardware
│       │       ├── models/
│       │       │   ├── search/route.ts        # GET /api/models/search?q=
│       │       │   └── derive/route.ts        # GET /api/models/derive?id=&gpu=
│       │       ├── jobs/
│       │       │   ├── route.ts               # GET / POST /api/jobs
│       │       │   └── [id]/
│       │       │       ├── route.ts           # GET /api/jobs/:id
│       │       │       ├── logs/route.ts      # GET /api/jobs/:id/logs?container=
│       │       │       └── report/route.ts    # GET /api/jobs/:id/report?file=
│       │       └── reports/
│       │           ├── route.ts               # GET /api/reports
│       │           └── [id]/route.ts          # GET /api/reports/:id
│       ├── proxy.ts                   # Next.js middleware — auth gate (matches /portal, /jobs, /reports, protected APIs)
│       ├── components/
│       │   ├── ui/                    # shadcn/ui — do not hand-edit
│       │   ├── panels/                # ModelPanel, EngineQuantPanel, HardwarePanel, TestParamsPanel
│       │   └── shared/                # TopNav, LoginModal, QuantChip
│       ├── lib/
│       │   ├── auth/                  # HMAC session cookie helpers + user list
│       │   ├── catalogue/             # types.ts, db.ts (Postgres-backed), seed.ts (GPUs only), derived.ts (UI helpers)
│       │   ├── enrichment/            # engine.ts, quants.ts, vram.ts
│       │   └── jobs/                  # store.ts, validation.ts, nats.ts
│       └── store/
│           └── benchmarkStore.ts      # Zustand global state
│
├── backend/
│   ├── AGENTS.md              # Backend-specific guide
│   ├── CLAUDE.md              # → @AGENTS.md
│   ├── job_controller/
│   │   ├── main.py            # Entry point — uvicorn + NATS wiring
│   │   ├── models.py          # Pydantic: BenchmarkRequest, BenchmarkResult, CollectorPayload
│   │   ├── scheduler.py       # NATS consumer → K8s submit → status poll + DLQ
│   │   ├── renderer.py        # Jinja2 template renderer (vllm + sglang only)
│   │   ├── nats_client.py     # JetStream singleton (JOBS + JOBS_DLQ streams)
│   │   ├── k8s_client.py      # BatchV1Api wrapper — crash-loop detection, log fetch, fail_job
│   │   ├── db.py              # asyncpg — reads jobs, writes job_status + job_dlq
│   │   └── collector_api.py   # FastAPI app on :8080 — currently dormant (no in-cluster caller)
│   ├── templates/
│   │   ├── benchmark-job-vllm.yaml          # Jinja2 — vLLM engine path
│   │   ├── benchmark-job-vllm-test.yaml     # Static test manifest
│   │   ├── benchmark-job-sglang.yaml        # Jinja2 — SGLang engine path
│   │   └── benchmark-job-sglang-test.yaml   # Static test manifest
│   └── tests/
│       └── test_renderer.py   # vLLM renderer tests (SGLang coverage gap — see backend/AGENTS.md)
│
├── db/
│   ├── schema.sql             # Postgres schema — models, jobs, job_status, job_dlq
│   └── migrations/
│       └── 0001_seed_models.sql       # Catalogue seed (~48 models)
│
├── tests/
│   └── AGENTS.md              # E2E test runbook (submit jobs, monitor, report)
│
└── deploy/
    ├── infra/                 # postgres.yaml, nats.yaml, model-cache-pvc.yaml
    ├── app/                   # job-controller.yaml, web.yaml, rbac.yaml
    └── local/                 # docker-compose.yaml (Postgres + NATS for dev)
```

`infra/yaml/` (mentioned in earlier docs) has been removed. The Jinja2 templates in `backend/templates/` are the authoritative job manifests; cluster service manifests live in `deploy/infra/`.

---

## Key Design Principles

### 1. Postgres is the single source of truth

All benchmark parameters are written to the `jobs` table by Next.js immediately on submission. The job controller reads them back from Postgres — it does not rely on the NATS message for parameter data.

### 2. NATS is for ordering and delivery only

The NATS payload on the `jobs` subject contains only `{ job_id }`. This eliminates any possibility of drift between what is stored and what is executed. NATS provides durable, ordered delivery; Postgres provides the data.

### 3. Dead-letter queue for all failures

Any job that cannot be processed is written to both:
- `job_dlq` table in Postgres (persistent, queryable)
- `JOBS_DLQ` NATS stream on subject `jobs.dlq` (for alerting / reactive consumers)

Two failure points are covered: K8s submission failure (manifest render or API error) and K8s job execution failure.

### 4. Parameter ownership — two categories, never mixed

| Category | Owned by | Where it lives |
|---|---|---|
| **User intent** | Frontend → Postgres | `jobs` table, passed to renderer via `BenchmarkRequest` |
| **Backend infra** | Renderer / env vars | Derived at manifest-render time, never stored |

Infrastructure values (`memory_request/limit`, `engine_cache_key`, `model_cache_pvc`, `gemm_autotuning`, `speculative_decoding`) are derived by `renderer.py` from the user-intent values already in the DB row. They must never appear in the `jobs` table or NATS payload.

### 5. Derived values are computed once, at the API boundary

`dtype` is derived from `quantisation` in `POST /api/jobs` and stored in Postgres. Engine strings are stored in their backend form (`vllm`, `sglang`). Neither the NATS consumer nor the renderer re-derives these — they read the stored values.

---

## End-to-End Data Flow

```
User (browser)
  │  Selects model, engine, quant, GPU, load profile, engine tuning
  │
  ▼
POST /api/jobs  (frontend/src/app/api/jobs/route.ts)
  │  Validates compat rules
  │  Derives dtype from quantisation (fp16→float16, bf16→bfloat16, else auto)
  │  ├─→ INSERT INTO jobs (Postgres)    ← all params stored here, source of truth
  │  └─→ publish { job_id } to NATS    ← trigger only, no params
  │
  ▼
NATS JetStream — stream: JOBS / subject: jobs
  │  Payload: { job_id } only
  │
  ▼
Python job controller  (backend/job_controller/scheduler.py)
  │  Reads full BenchmarkRequest from Postgres via db.get_job(job_id)
  │  renderer.py derives infra values from the request:
  │    ├─ memory_request / memory_limit  (from gpu_type)
  │    ├─ input_tokens_stddev            (from isl_distribution)
  │    └─ MODEL_CACHE_PVC               (from env var)
  │
  ├─→ [on K8s submit failure] → job_dlq (Postgres) + JOBS_DLQ (NATS)
  │
  ▼
kubectl apply → K8s Job in default namespace
  │  Two-container pod: engine sidecar + aiperf
  │
  ▼
aiperf  uploads aiperf.json + dcgm.json to Linode Object Storage
  │
  └─→ controller polls K8s Job status, writes complete/failed to job_status
      on failure: job_dlq (Postgres) + JOBS_DLQ (NATS)
```

### Architecture — The Two Worlds

#### World 1: Next.js app (`frontend/`)

Serves the UI and exposes API routes for model search, VRAM estimation, engine recommendation, quant compatibility, and job submission. The full job submission pipeline — Postgres insert + NATS publish — is implemented.

Data flow rule: **all derived UI state comes from `/api/models/:id/derive`**. Panels never compute compatibility themselves. This is the most important architectural constraint in the codebase.

#### World 2: Python job controller + Kubernetes (`backend/` + `deploy/`)

The job controller consumes from NATS, renders the Jinja2 K8s Job manifest, submits it to the cluster, and polls status back to Postgres. Each K8s Job provisions a two-container pod:

1. **Engine container** (native sidecar, `restartPolicy: Always`) — `vllm-server` or `sglang-server`, starts the inference server on port 8000, stays alive for the lifetime of the Job
2. **aiperf container** — waits for `/health`, drives the benchmark, writes results JSON to a shared volume, and uploads results + DCGM metrics to Linode Object Storage

The controller polls K8s for terminal Job state and writes it to `job_status`. It also detects engine container crash-loops (`restartCount >= 5`) and fails the Job via `activeDeadlineSeconds: 1`, capturing the last 60 lines of engine logs into `job_status.error`. See `backend/AGENTS.md` for details.

---

## Engine Paths — Know These Before Touching Infra

| Path | Trigger | What happens |
|---|---|---|
| **vLLM** | vLLM selected (default) | Loads safetensors directly from PVC model cache or HF Hub. No compile step. Fastest cold start. Default image `vllm/vllm-openai:v0.19.0`; Gemma 4 models use a custom image with a patched Transformers version. |
| **SGLang** | SGLang selected | Loads safetensors directly. No compile step. Image `lmsysorg/sglang:v0.5.1-cu126`. |
| **TRT-LLM** | _Frontend recommends it, backend cannot execute it._ | The renderer has no `trtllm` template and `BenchmarkRequest` rejects engine values outside `{vllm, sglang}`. Any TRT-LLM submission will fail validation in the controller and be written to `job_dlq`. Tests/runbook calls for overriding the recommendation to vLLM. |

Both runnable engines expose `POST /v1/completions` and `GET /health` on port 8000. AIPerf targets `localhost:8000` regardless of engine.

**No Triton.** Do not introduce Triton Inference Server — it adds routing overhead that obscures raw engine performance numbers.

---

## Quantisation & Compatibility Rules

These rules are enforced in two places: client-side in `EngineQuantPanel.tsx` and server-side in the `/derive` route. Server-side is authoritative.

| Rule | What happens |
|---|---|
| NVFP4 + RTX 4000 Ada | Block — FP4 tensor cores only on RTX Pro 6000 |
| SmoothQuant / W4A8 / W4A16 + vLLM or SGLang | Block — TensorRT-LLM exclusive |

The quant type list lives in `frontend/src/lib/catalogue/types.ts`. Add new formats there first, then update `enrichment/quants.ts` and the K8s manifests.

---

## Cluster Safety — `default` is Production

The shared Linode cluster runs production (`default` namespace) and the
operator's local development workload side by side so they can share the
GPU node pool. This means:

- **`default` is the production namespace.** Never edit, delete, restart,
  or run destructive `kubectl` against any resource in `default` — Jobs,
  Pods, Deployments, Secrets, PVCs, ConfigMaps, the Gateway, the
  Certificate. No exceptions for "cleanup". The only commands that
  should ever touch `default` are read-only inspections (`kubectl get`,
  `describe`, `logs`).
- **All development goes into `akabench-dev`.** When working from a local
  machine, the job controller submits Jobs into `akabench-dev` (set
  `K8S_NAMESPACE=akabench-dev` in `backend/.env`). Secrets, PVCs and any
  test resources for dev work belong in `akabench-dev`.
- **If you need to delete or restart something** — confirm the namespace
  with the operator first. Default to `-n akabench-dev` on every
  `kubectl` invocation when in doubt; never omit `-n` on destructive
  commands, since `kubectl` falls back to the current context's default
  namespace (which on this cluster *is* `default`).

This guard exists because there is no separate prod cluster — a stray
`kubectl delete` in `default` takes down the live portal.

---

## Secrets — Required Before Any Real Job Runs

All K8s secrets must exist in the `default` namespace (the benchmark job namespace):

```bash
# HuggingFace token (for gated models: LLaMA, Gemma)
kubectl create secret generic hf-token \
  --from-literal=token=<HF_TOKEN> \
  --namespace default

# Linode Object Storage (S3-compatible) — for uploading AIPerf + DCGM results
# Also read by the web Deployment to presign log + report downloads
# endpoint_url format: https://<cluster-id>.linodeobjects.com
kubectl create secret generic object-storage \
  --from-literal=endpoint_url=<LINODE_ENDPOINT_URL> \
  --from-literal=bucket=<BUCKET_NAME> \
  --from-literal=access_key_id=<ACCESS_KEY> \
  --from-literal=secret_access_key=<SECRET_KEY> \
  --namespace default

# Web app session signing key (HMAC for aka_session cookies — 32+ bytes random)
kubectl create secret generic web-secrets \
  --from-literal=auth-secret=<RANDOM_HEX> \
  --namespace default

# Postgres credentials for the postgres pod + connection URL for web/job-controller.
# All three keys are required:
#   - username / password — consumed by postgres.yaml as POSTGRES_USER / POSTGRES_PASSWORD
#   - database-url        — consumed by web.yaml and job-controller.yaml
# The password value MUST be identical in `password` and inside `database-url`.
# Define it once in a shell var and reuse — never hand-edit the URL.
PG_USER=akabench
PG_PASS="${PG_PASS:?set PG_PASS before running}"
kubectl create secret generic postgres-secrets --namespace default \
  --from-literal=username="$PG_USER" \
  --from-literal=password="$PG_PASS" \
  --from-literal=database-url="postgres://$PG_USER:$PG_PASS@postgres:5432/akabench"
```

NGC registry secret is **not** required at present — TRT-LLM is not executable.

---

## Image Pinning — Non-Negotiable

**Always pin image versions in K8s manifests.** Never use `:latest` in Job specs.

| Image | Pinned version |
|---|---|
| `vllm/vllm-openai` | `v0.19.0` (Gemma 4 overrides to a custom `gemma4` tag — patched Transformers) |
| `lmsysorg/sglang` | `v0.5.1-cu126` |
| `aiperf` (pip package) | `0.7.0` |

Image tags are injected by `renderer.py` (via `_VLLM_IMAGE_OVERRIDES` and the `sglang_image` template variable) — never hand-edit them in the Jinja2 manifests.

Rationale: upstream images update frequently. Unpinned images break result reproducibility between runs — a cardinal sin for a benchmark tool.

---

## MVP Boundaries — Do Not Build These

The following are **explicitly out of scope**. Do not stub, scaffold, or hint at these in code:

- SSE streaming of live benchmark events back to the browser (logs are fetched on-demand from Object Storage)
- SSO / OIDC integration with the Akamai internal IdP (current auth is a hardcoded user + HMAC session cookie — sufficient for internal-only access)
- Model Selection Advisor — recommendations panel
- Multi-GPU / tensor parallelism
- Historical run comparison
- Scheduled runs
- Cost modelling

Concurrency sweeps (`concurrencyLevels[]` on `POST /api/jobs`) are now in scope and partially implemented — see `frontend/AGENTS.md`.

---

## Key Metrics the Portal Captures

All produced by AIPerf. Know what these mean when working on the results schema or report generation:

| Metric | Unit | Meaning |
|---|---|---|
| Throughput | tok/s | Total output tokens/sec across all concurrent users |
| TTFT p50/p95/p99 | ms | Time to first token — prefill latency |
| TPOT p50/p95 | ms/tok | Time per output token — decode speed |
| End-to-end latency p50/p99 | ms | Full request round-trip |
| GPU utilisation | % | Compute saturation during test |
| GPU VRAM peak | GB | Memory headroom signal |

---

## Infra Prerequisites Checklist

Before wiring up real job execution, confirm:

- [ ] K8s ≥ 1.29 (native sidecar `restartPolicy: Always` support)
- [ ] NVIDIA device plugin + nvidia-container-toolkit on GPU nodes
- [ ] NVIDIA driver ≥ 535, CUDA 12.x (required for FP8)
- [ ] PVC `model-cache-pvc` (ReadWriteMany) — provisioned via `deploy/infra/model-cache-pvc.yaml`
- [ ] HF token + `hf-token` secret (with LLaMA 3 and Gemma 3/4 licences accepted)
- [ ] `object-storage` secret (S3-compatible, used by both the in-pod uploader and the web app for presigning)
- [ ] `web-secrets` (AUTH_SECRET) + `postgres-secrets` (DATABASE_URL)
- [ ] DCGM Exporter ConfigMap exposes `DCGM_FI_DEV_GPU_UTIL` and `DCGM_FI_DEV_FB_USED` (see backend/AGENTS.md)

---

## Cross-References

| Question | Where to look |
|---|---|
| How does engine recommendation work? | `frontend/src/lib/enrichment/engine.ts` |
| What quants are supported per model? | `frontend/src/lib/enrichment/quants.ts` |
| How is VRAM estimated? | `frontend/src/lib/enrichment/vram.ts` |
| What does the /derive endpoint return? | `frontend/src/lib/catalogue/types.ts` → `DeriveResult` |
| K8s job structure for vLLM | `backend/templates/benchmark-job-vllm.yaml` |
| K8s job structure for SGLang | `backend/templates/benchmark-job-sglang.yaml` |
| Auth / session cookie format | `frontend/src/lib/auth/`, `frontend/src/proxy.ts` |
| Model catalogue (Postgres seed) | `db/migrations/0001_seed_models.sql` |
| Full product spec | `functional.md` |
| Full technical spec | `technical.md` |
