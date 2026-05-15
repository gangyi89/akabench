# Agent Guide — AKAbench (root)

This document covers the full project. For frontend-specific conventions (TypeScript rules, shadcn/ui, component patterns, state management) read **`frontend/AGENTS.md`** — it is the authoritative guide for any work inside `frontend/`.

---

## Project Overview

**AKAbench** is an internal Akamai portal for Sales Engineers to benchmark LLM inference on NVIDIA GPU hardware and produce customer-facing reports. Engineers select a model, inference engine, hardware tier, and load parameters, then trigger a live benchmark run. Results are streamed back in real time and can be exported as a PDF/Markdown/JSON report.

**Supported engines:** TensorRT-LLM (latency story) and vLLM (throughput story)  
**Supported hardware:** RTX 4000 Ada (20 GB VRAM) and RTX Pro 6000 (96 GB VRAM, NVFP4-capable)  
**Benchmark tool:** NVIDIA AIPerf

---

## Repository Layout

```
akabench/
├── CLAUDE.md              # Root context file (you are reading its companion)
├── AGENTS.md              # This file
├── functional.md          # Product spec — portal UX, model catalogue, advisor logic
├── technical.md           # Architecture — K8s lifecycle, engine paths, API contract
├── project.md             # Earlier combined doc (superseded; for historical context only)
│
├── frontend/                  # Next.js app (frontend + API routes)
│   ├── CLAUDE.md          # → @AGENTS.md (just a pointer)
│   ├── AGENTS.md          # ← Read this for all frontend work
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # Main portal page (4-panel layout)
│       │   ├── layout.tsx
│       │   └── api/
│       │       ├── hardware/route.ts  # GET /api/hardware
│       │       ├── models/
│       │       │   ├── search/route.ts        # GET /api/models/search?q=
│       │       │   └── derive/route.ts        # GET /api/models/:id/derive?gpu=
│       │       └── jobs/                      # POST /api/jobs + GET /api/jobs/:id
│       ├── components/
│       │   ├── ui/                    # shadcn/ui — do not hand-edit
│       │   ├── panels/                # HardwarePanel, ModelPanel, EngineQuantPanel, …
│       │   └── shared/                # QuantChip, etc.
│       ├── lib/
│       │   ├── catalogue/             # types.ts, db.ts (in-memory), seed.ts
│       │   └── enrichment/            # engine.ts, quants.ts, vram.ts
│       └── store/
│           └── benchmarkStore.ts      # Zustand global state
│
├── backend/
│   ├── AGENTS.md              # Backend-specific guide
│   ├── job_controller/
│   │   ├── main.py            # Entry point — uvicorn + NATS wiring
│   │   ├── models.py          # Pydantic: BenchmarkRequest, BenchmarkResult
│   │   ├── scheduler.py       # NATS consumer → K8s submit → status poll
│   │   ├── renderer.py        # Jinja2 template renderer (derives infra values)
│   │   ├── nats_client.py     # JetStream singleton
│   │   ├── k8s_client.py      # BatchV1Api wrapper
│   │   ├── db.py              # asyncpg — writes job_status only
│   │   └── collector_api.py   # FastAPI — receives results POST from pod
│   ├── db/
│   │   └── schema.sql         # Postgres schema (jobs + job_status tables)
│   └── templates/
│       ├── benchmark-job-vllm.yaml    # Jinja2 — vLLM engine path
│       └── benchmark-job-trtllm.yaml  # Jinja2 — TRT-LLM engine paths
│
└── infra/
    └── yaml/                  # Static reference manifests (superseded by backend/templates)
```

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

`dtype` is derived from `quantisation` in `POST /api/jobs` and stored in Postgres. The engine string is normalised from `trt-llm` (frontend) to `trtllm` (backend) at the same point. Neither the NATS consumer nor the renderer re-derives these — they read the stored values.

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
  │    ├─ engine_cache_key               (TRT-LLM binary cache path)
  │    ├─ input_tokens_stddev            (from isl_distribution)
  │    └─ MODEL_CACHE_PVC               (from env var)
  │
  ├─→ [on K8s submit failure] → job_dlq (Postgres) + JOBS_DLQ (NATS)
  │
  ▼
kubectl apply → K8s Job in gpu-benchmarks namespace
  │  Multi-container pod: engine sidecar + aiperf + results-collector
  │
  ├─→ [on job execution failure] → job_dlq (Postgres) + JOBS_DLQ (NATS)
  │
  ▼
results-collector  POST /jobs/{job_id}/results  (collector_api.py)
  │  Updates job_status table in Postgres
  └─→ publishes to NATS subject 'results'
```

### Architecture — The Two Worlds

#### World 1: Next.js app (`frontend/`)

Serves the UI and exposes API routes for model search, VRAM estimation, engine recommendation, quant compatibility, and job submission. The full job submission pipeline — Postgres insert + NATS publish — is implemented.

Data flow rule: **all derived UI state comes from `/api/models/:id/derive`**. Panels never compute compatibility themselves. This is the most important architectural constraint in the codebase.

#### World 2: Python job controller + Kubernetes (`backend/` + `infra/`)

The job controller consumes from NATS, renders the Jinja2 K8s Job manifest, submits it to the cluster, and polls status back to Postgres. Each K8s Job provisions a multi-container pod:

1. **Engine container** (native sidecar, `restartPolicy: Always`) — starts the inference server on port 8000, stays alive for the lifetime of the Job
2. **aiperf container** — waits for `/health`, drives the benchmark, writes results JSON to a shared `emptyDir` volume
3. **results-collector container** — POSTs structured metrics back to the collector API

GPU node isolation is enforced via `nodeSelector` + `tolerations` — benchmark nodes are tainted `gpu-benchmark=true:NoSchedule`.

---

## Engine Paths — Know These Before Touching Infra

| Path | Trigger | What happens |
|---|---|---|
| **TRT-LLM Path A (NGC)** | Model has an NGC container (`ngcContainerTag != null`) | Pre-compiled engine — no build step. Starts `trtllm-serve` immediately. Requires `ngc-registry` imagePullSecret. |
| **TRT-LLM Path B (HF)** | TRT-LLM selected, no NGC container | Runs `trtllm-build` as an initContainer. Checks PVC engine cache first (`/models/engines/{slug}/{quant}/{gpu_type}/`). Cache miss = 15 min to 4 hrs compile. |
| **vLLM** | vLLM selected | Loads safetensors directly from PVC model cache or HF Hub. No compile step. Fastest cold start. |

All three expose `POST /v1/completions` and `GET /health` on port 8000. AIPerf targets `localhost:8000` regardless of engine — the infra abstraction is clean.

**No Triton.** Do not introduce Triton Inference Server — it adds routing overhead that obscures raw engine performance numbers.

---

## Quantisation & Compatibility Rules

These rules are enforced in two places: client-side in `EngineQuantPanel.tsx` and server-side in the `/derive` route. Server-side is authoritative.

| Rule | What happens |
|---|---|
| NVFP4 + vLLM | Block — NVFP4 is TRT-LLM exclusive |
| NVFP4 + RTX 4000 Ada | Block — FP4 tensor cores only on RTX Pro 6000 |
| SmoothQuant / W4A8 / W4A16 + vLLM | Block — NVIDIA-proprietary formats |
| GGUF / EXL2 + TRT-LLM | Block — not supported |

The quant type list lives in `frontend/src/lib/catalogue/types.ts`. Add new formats there first, then update `enrichment/quants.ts` and the K8s manifests.

---

## Secrets — Required Before Any Real Job Runs

All K8s secrets must exist in the `default` namespace (the benchmark job namespace):

```bash
# HuggingFace token (for gated models: LLaMA, Gemma)
kubectl create secret generic hf-token \
  --from-literal=token=<HF_TOKEN> \
  --namespace default

# Linode Object Storage (S3-compatible) — for uploading AIPerf + DCGM results
# endpoint_url format: https://<cluster-id>.linodeobjects.com
kubectl create secret generic object-storage \
  --from-literal=endpoint_url=<LINODE_ENDPOINT_URL> \
  --from-literal=bucket=<BUCKET_NAME> \
  --from-literal=access_key_id=<ACCESS_KEY> \
  --from-literal=secret_access_key=<SECRET_KEY> \
  --namespace default

# NGC registry (for TRT-LLM Path A NGC container images — TRT-LLM not yet in scope)
kubectl create secret docker-registry ngc-registry \
  --docker-server=nvcr.io \
  --docker-username='$oauthtoken' \
  --docker-password=<NGC_API_KEY> \
  --namespace default
```

---

## Image Pinning — Non-Negotiable

**Always pin image versions in K8s manifests.** Never use `:latest` in Job specs.

| Image | Pinned version |
|---|---|
| `vllm/vllm-openai` | `v0.19.0` |
| `nvcr.io/nvidia/tensorrt-llm/release` | `1.2.0` |
| `aiperf` (pip package) | `0.7.0` |

Rationale: NGC images update frequently. Unpinned images break result reproducibility between runs — a cardinal sin for a benchmark tool.

---

## MVP Boundaries — Do Not Build These

The following are **explicitly out of scope**. Do not stub, scaffold, or hint at these in code:

- SSE streaming of live benchmark events back to the browser
- Authentication / SSO — the user chip is static
- Model Selection Advisor — recommendations panel
- Concurrency sweep automation
- Multi-GPU / tensor parallelism
- Historical run comparison
- Scheduled runs
- Cost modelling

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
- [ ] NVIDIA driver ≥ 535, CUDA 12.x (required for FP8, TRT-LLM 0.12)
- [ ] PVC `model-cache-pvc` (ReadWriteMany) in `gpu-benchmarks` namespace
- [ ] NGC API key + `ngc-registry` secret
- [ ] HF token + `hf-token` secret (with LLaMA 3 and Gemma 2 licences accepted)
- [ ] SSO/OIDC integration with Akamai internal IdP
- [ ] `trtllm-serve` `/v1/completions` endpoint verified compatible with AIPerf

---

## Cross-References

| Question | Where to look |
|---|---|
| How does engine recommendation work? | `frontend/src/lib/enrichment/engine.ts` |
| What quants are supported per model? | `frontend/src/lib/enrichment/quants.ts` |
| How is VRAM estimated? | `frontend/src/lib/enrichment/vram.ts` |
| What does the /derive endpoint return? | `frontend/src/lib/catalogue/types.ts` → `DeriveResult` |
| K8s job structure for vLLM | `infra/yaml/benchmark-job-vllm.yaml` |
| K8s job structure for TRT-LLM | `infra/yaml/benchmark-job-trtllm.yaml` |
| Full product spec | `functional.md` |
| Full technical spec | `technical.md` |
