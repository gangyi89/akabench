# Akamai GPU Benchmark Portal — Technical Design

> **Internal use only — Akamai employees only.**
> This document covers the implementation architecture, infrastructure, API contracts, Kubernetes manifests, and all technical decisions for the portal. For feature scope, UX flow, and product decisions see `functional.md`.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
   - 1.1 [Component overview](#11-component-overview)
   - 1.2 [End-to-end data flow](#12-end-to-end-data-flow)
   - 1.3 [GPU node isolation](#13-gpu-node-isolation)
2. [Inference Engine Implementation](#2-inference-engine-implementation)
   - 2.1 [vLLM](#21-vllm)
   - 2.2 [TensorRT-LLM — Path A (NGC pre-built)](#22-tensorrt-llm--path-a-ngc-pre-built)
   - 2.3 [TensorRT-LLM — Path B (HF weights)](#23-tensorrt-llm--path-b-hf-weights)
   - 2.4 [Serving layer — no Triton](#24-serving-layer--no-triton)
3. [Benchmark Tooling](#3-benchmark-tooling)
4. [Kubernetes Manifests](#4-kubernetes-manifests)
   - 4.1 [Node labels & taints](#41-node-labels--taints)
   - 4.2 [Job manifest structure](#42-job-manifest-structure)
5. [API Design](#5-api-design)
   - 5.1 [Frontend API routes (Next.js)](#51-frontend-api-routes-nextjs)
   - 5.2 [Backend collector API (Python)](#52-backend-collector-api-python)
   - 5.3 [Compatibility validation](#53-compatibility-validation)
6. [Database Schema](#6-database-schema)
7. [NATS JetStream](#7-nats-jetstream)
8. [Engine Tuning Parameters](#8-engine-tuning-parameters)
9. [Environment Variables](#9-environment-variables)
10. [Tech Stack Summary](#10-tech-stack-summary)
11. [Pre-Deploy Checklist](#11-pre-deploy-checklist)

---

## 1. System Architecture

### 1.1 Component overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  Portal UI — Next.js 15 (App Router, TypeScript, Tailwind v4)   │
└───────────────────────┬──────────────────────────────────────────┘
                        │ HTTP  (Next.js Route Handlers)
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Next.js API (frontend/src/app/api/)                             │
│  - Model search & engine/quant derivation                        │
│  - Compatibility validation (server-authoritative)               │
│  - Job submission: INSERT → Postgres, publish → NATS             │
│  - Job status & report retrieval                                 │
└──────────┬────────────────────────┬─────────────────────────────┘
           │ INSERT                 │ publish { job_id }
           ▼                        ▼
┌──────────────────┐    ┌────────────────────────┐
│  PostgreSQL      │    │  NATS JetStream         │
│  jobs            │    │  Stream: JOBS           │
│  job_status      │    │  Subject: jobs          │
│  job_dlq         │    │  DLQ stream: JOBS_DLQ   │
└──────────────────┘    └──────────┬─────────────┘
                                   │ consume { job_id }
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Python job controller  (backend/job_controller/)                │
│  scheduler.py — reads full params from Postgres via job_id       │
│  renderer.py  — derives infra values, renders Jinja2 manifest    │
│  k8s_client.py — submits Job, polls status                       │
│  db.py        — writes job_status / job_dlq                      │
│  collector_api.py — receives POST /jobs/{id}/results from pod    │
│                                                                  │
│  On K8s submit failure → job_dlq (Postgres) + JOBS_DLQ (NATS)   │
│  On K8s job failure    → job_dlq (Postgres) + JOBS_DLQ (NATS)   │
└──────────┬───────────────────────────────────────────────────────┘
           │ kubectl apply
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster — namespace: default                         │
│                                                                  │
│  ┌─────────────────────────┐  ┌─────────────────────────┐        │
│  │  GPU Node — RTX 4000 Ada│  │  GPU Node — RTX Pro 6000│        │
│  │  (labels from GPU       │  │  (labels from GPU        │       │
│  │   Operator)             │  │   Operator)              │       │
│  │                         │  │                          │       │
│  │  [engine sidecar]       │  │  [engine sidecar]        │       │
│  │  [aiperf]               │  │  [aiperf]                │       │
│  │  [results-collector]    │  │  [results-collector]     │       │
│  └─────────────────────────┘  └─────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

**What is NOT in scope for MVP:**
- SSE streaming of live benchmark events to the browser
- Authentication / SSO — the user chip is static display
- Model Selection Advisor panel

### 1.2 End-to-end data flow

1. **Browser** POSTs to `POST /api/jobs` (Next.js Route Handler).
2. **Next.js** validates compat rules, derives `dtype` from `quantisation`, normalises engine string (`trt-llm` → `trtllm`), INSERTs full params into `jobs` table (Postgres), publishes `{ job_id }` to NATS subject `jobs`, returns `{ jobId }` to browser.
3. **NATS** delivers `{ job_id }` to the job controller (durable consumer `"job-controller"`). The payload contains **only** `job_id` — no benchmark parameters.
4. **Job controller** reads the full `BenchmarkRequest` from Postgres via `db.get_job(job_id)`, calls `renderer.py` to derive infra values and render the Jinja2 K8s manifest, submits it via `k8s_client.create_job()`.
5. **K8s** schedules the pod on the correct GPU node. The pod runs three containers:
   - **Engine sidecar** (`restartPolicy: Always`) — starts the inference server on port 8000
   - **aiperf** — waits for `/health`, runs the benchmark, writes `output.json` to shared `emptyDir`
   - **results-collector** — POSTs structured metrics to `POST /jobs/{job_id}/results` on the job controller's HTTP server (default port 8080)
6. **Job controller collector API** caches metrics in memory (`scheduler.pending_metrics[job_id]`), updates `job_status` in Postgres.

**Parameter ownership — two categories, never mixed:**

| Category | Owned by | Where it lives |
|---|---|---|
| **User intent** | Frontend → Postgres | `jobs` table; passed to renderer via `BenchmarkRequest` |
| **Backend infra** | Renderer / env vars | Derived at manifest-render time; never stored in DB |

Infrastructure values derived by `renderer.py` (never in DB):
- `memory_request` / `memory_limit` — from `gpu_type`
- `engine_cache_key` — TRT-LLM binary cache path on PVC
- `input_tokens_stddev` — from `isl_distribution`
- `MODEL_CACHE_PVC` — from env var

### 1.3 GPU node isolation

Benchmark Jobs are scheduled exclusively on dedicated GPU nodes using `nodeSelector` and `tolerations`. Node labels are provided automatically by the **NVIDIA GPU Operator** — no custom labels are applied manually.

The `nodeSelector` in Job manifests uses the GPU Operator label `nvidia.com/gpu.product` to target the correct node:

| GPU | `nvidia.com/gpu.product` value |
|---|---|
| RTX 4000 Ada | `NVIDIA-RTX-4000-Ada-Generation` |
| RTX Pro 6000 | *(confirm value from GPU Operator on target node)* |

The taint `gpu-benchmark=true:NoSchedule` must still be applied manually to prevent non-benchmark workloads from sharing the node during a run:

```bash
kubectl taint node <gpu-node> gpu-benchmark=true:NoSchedule
```

---

## 2. Inference Engine Implementation

### 2.1 vLLM

**Use for:** Any HuggingFace model. No compilation step. Fastest cold start. **Implemented.**

**How it works:** Loads safetensors directly from the PVC model cache or HF Hub. FP8 is quantized on-the-fly at load time — no pre-quantized weights required.

**Pinned image:** `vllm/vllm-openai:v0.19.0`

**Note on newer architectures:** Models like Gemma 4 require a newer `transformers` version than what ships with vLLM 0.19.0. These use a custom container that patches the `transformers` library.

### 2.2 TensorRT-LLM — Path A (NGC pre-built)

**Use for:** Models with an `ngcContainerTag` in the catalogue (e.g. Nemotron-Mini-4B). Pre-compiled engine — no `trtllm-build` step.

**How it works:** NVIDIA publishes NGC container images that include pre-compiled TRT-LLM engine binaries targeted at specific GPU architectures. The engine container starts and runs `trtllm-serve` immediately.

**Pinned image:** `nvcr.io/nvidia/tensorrt-llm/release:1.2.0`

**Authentication:** Requires an NGC API key stored as a K8s `docker-registry` secret:

```bash
kubectl create secret docker-registry ngc-registry \
  --docker-server=nvcr.io \
  --docker-username='$oauthtoken' \
  --docker-password=<NGC_API_KEY> \
  --namespace default
```

### 2.3 TensorRT-LLM — Path B (HF weights)

**Use for:** TRT-LLM selected, no NGC pre-built container. Runs `trtllm-build` as an initContainer.

**Engine cache:** `/models/engines/{model_id_slug}/{quantisation}/{gpu_type}/` on the model cache PVC. Cache hit skips compilation.

**Compilation time estimates:**

| Model size | Approx. compile time |
|---|---|
| 7–9B | 15–30 min |
| 13B | 30–60 min |
| 70B | 2–4 hrs |

**Pinned image:** `nvcr.io/nvidia/tensorrt-llm/release:1.2.0`

### 2.4 Serving layer — no Triton

All three paths expose an OpenAI-compatible interface. No NVIDIA Triton Inference Server — it adds routing overhead that obscures raw engine performance numbers.

```
POST http://localhost:8000/v1/completions
GET  http://localhost:8000/health
```

AIPerf targets `localhost:8000` identically regardless of which engine is running.

---

## 3. Benchmark Tooling

### AIPerf (NVIDIA)

AIPerf is the single benchmarker used by this portal. Results are directly comparable to published NVIDIA benchmarks.

**Pinned version:** `aiperf==0.7.0`

**Key properties:**
- Standalone Python package — no Triton dependency
- Targets any OpenAI-compatible `/v1/completions` endpoint
- Outputs structured JSON with all key latency and throughput metrics
- Supports concurrency sweeps

**Invocation:**
```bash
aiperf profile \
  --model ${MODEL_ID} \
  --url http://localhost:8000 \
  --endpoint-type chat \
  --tokenizer ${MODEL_ID} \
  --concurrency ${CONCURRENCY} \
  --request-count ${REQUEST_COUNT} \
  --isl ${INPUT_TOKENS_MEAN} \
  --osl ${OUTPUT_TOKENS_MEAN} \
  --extra-inputs min_tokens:${OUTPUT_TOKENS_MEAN} \
  --extra-inputs ignore_eos:true \
  --streaming \
  --use-legacy-max-tokens \
  --artifact-dir /results/artifacts \
  --profile-export-file output.json
```

**Metrics captured:**

| Metric | Unit | Meaning |
|---|---|---|
| Throughput | tok/s | Total output tokens/sec across all concurrent users |
| TTFT p50/p95/p99 | ms | Time to first token — prefill latency |
| TPOT p50/p95 | ms/tok | Time per output token — decode speed |
| End-to-end latency p50/p99 | ms | Full request round-trip |
| GPU utilisation | % | Compute saturation during test |
| GPU VRAM peak | GB | Memory headroom signal |

---

## 4. Kubernetes Manifests

### 4.1 Node taints

See [Section 1.3](#13-gpu-node-isolation). Node labels come from the NVIDIA GPU Operator — only the `gpu-benchmark=true:NoSchedule` taint is applied manually.

### 4.2 Job manifest structure

Templates live in `backend/templates/`. Rendered by `renderer.py` from the `BenchmarkRequest` read out of Postgres.

**vLLM template** (`benchmark-job-vllm.yaml`):
- 1 initContainer: `vllm-server` (`restartPolicy: Always` — native sidecar, K8s ≥ 1.29 required)
- 2 main containers: `aiperf`, `results-collector`

**TRT-LLM template** (`benchmark-job-trtllm.yaml`):
- 2 initContainers: `trtllm-build` (cache check + compile), `trtllm-server` (`restartPolicy: Always`)
- 2 main containers: `aiperf`, `results-collector`

**Jinja2 variables passed to both templates:**

| Variable | Source |
|---|---|
| `job_id` | Postgres `jobs.job_id` |
| `submitted_by` | Postgres `jobs.submitted_by` |
| `gpu_type` | Postgres `jobs.gpu_type` |
| `model_id` | Postgres `jobs.model_id` |
| `dtype` | Postgres `jobs.dtype` |
| `quantisation` | Postgres `jobs.quantisation` |
| `kv_cache_dtype` | Postgres `jobs.kv_cache_dtype` |
| `max_model_len` | Postgres `jobs.max_model_len` |
| `gpu_memory_util` | Postgres `jobs.gpu_memory_util` |
| `max_batch_size` | Postgres `jobs.max_batch_size` |
| `prefix_caching` | Postgres `jobs.prefix_caching` |
| `chunked_prefill` | Postgres `jobs.chunked_prefill` |
| `flash_attention` | Postgres `jobs.flash_attention` |
| `concurrency` | Postgres `jobs.concurrency` |
| `input_tokens_mean` | Postgres `jobs.input_tokens_mean` |
| `output_tokens_mean` | Postgres `jobs.output_tokens_mean` |
| `request_count` | Postgres `jobs.request_count` |
| `streaming` | Postgres `jobs.streaming` |
| `memory_request` / `memory_limit` | **Derived** by renderer from `gpu_type` |
| `input_tokens_stddev` | **Derived** by renderer from `isl_distribution` |
| `model_cache_pvc` | **Derived** from `MODEL_CACHE_PVC` env var |
| `engine_cache_key` *(TRT-LLM only)* | **Derived** by renderer |
| `batch_scheduler` *(TRT-LLM only)* | Postgres `jobs.batch_scheduler` |
| `cuda_graphs` *(TRT-LLM only)* | Postgres `jobs.cuda_graphs` |
| `gemm_autotuning` *(TRT-LLM only)* | **Derived** by renderer |
| `speculative_decoding` *(TRT-LLM only)* | **Derived** by renderer |

**Image versions used in manifests:**

| Container | Image |
|---|---|
| vLLM engine | `vllm/vllm-openai:v0.19.0` |
| TRT-LLM engine | `nvcr.io/nvidia/tensorrt-llm/release:1.2.0` |
| aiperf | `python:3.12-slim` + `pip install aiperf==0.7.0` |

**Always pin image versions. Never use `:latest` in Job manifests.**

**K8s secrets required in `default` namespace:**

```bash
# HuggingFace token (for gated models: LLaMA, Gemma)
kubectl create secret generic hf-token \
  --from-literal=token=<HF_TOKEN> \
  --namespace default

# Linode Object Storage (S3-compatible)
kubectl create secret generic object-storage \
  --from-literal=endpoint_url=<LINODE_ENDPOINT_URL> \
  --from-literal=bucket=<BUCKET_NAME> \
  --from-literal=access_key_id=<ACCESS_KEY> \
  --from-literal=secret_access_key=<SECRET_KEY> \
  --namespace default

# NGC registry (TRT-LLM engine images)
kubectl create secret docker-registry ngc-registry \
  --docker-server=nvcr.io \
  --docker-username='$oauthtoken' \
  --docker-password=<NGC_API_KEY> \
  --namespace default
```

---

## 5. API Design

### 5.1 Frontend API routes (Next.js)

All routes are Next.js Route Handlers under `frontend/src/app/api/`.

#### `GET /api/models/search?q={query}`
```typescript
{ results: SearchResultItem[] }
```
Filters the in-memory catalogue by `hfRepoId`, family, and vendor (case-insensitive).

#### `GET /api/models/derive?id={hfRepoId}&gpu={gpuId}`
The main intelligence endpoint. Powers all cross-panel reactions. `gpu` is optional.
```typescript
{
  model: EnrichedModel
  engineRecommendation: 'trt-llm' | 'vllm'
  engineNote: string
  supportedQuants: QuantType[]
  quantNotice: string | null
  compatWarning: string | null
  compat: CompatResult[]        // one entry per GPU: { gpuId, fitsFp16, fitsFp8, fitsNvfp4, warning }
}
```

#### `GET /api/hardware`
```typescript
{ gpus: GPU[] }
```

#### `POST /api/jobs`
```typescript
// Request body
{
  // Required
  modelId: string
  engine: 'trt-llm' | 'vllm'
  quantisation: QuantType | null
  gpuId: string

  // Optional — server-side defaults applied
  concurrency?: number           // default 16
  inputTokensMean?: number       // default 512
  outputTokensMean?: number      // default 256
  requestCount?: number          // default 100
  streaming?: boolean            // default true
  measurementWindow?: number     // default 120 (seconds)
  islDistribution?: string       // default 'normal-25'
  backend?: string               // default 'openai'
  kvCacheDtype?: string          // default 'auto'
  maxModelLen?: number           // default 2048
  gpuMemoryUtil?: number         // default 0.90
  maxBatchSize?: number          // default 64
  prefixCaching?: boolean        // default true
  chunkedPrefill?: boolean       // default true
  flashAttention?: boolean       // default true
  batchScheduler?: 'inflight' | 'static'   // default 'inflight'
  cudaGraphs?: boolean           // default true
}

// Response — 201
{ jobId: string }
```

Server derives `dtype` from `quantisation` (`fp16` → `float16`, `bf16` → `bfloat16`, else `auto`) and normalises engine string (`trt-llm` → `trtllm`) before writing to Postgres.

#### `GET /api/jobs`
```typescript
{ jobs: Job[] }   // ordered by created_at DESC
```

Job fields: `id`, `modelId`, `modelName`, `engine`, `quantisation`, `gpuId`, `gpuName`, `status`, `submittedBy`, `submittedAt`, `completedAt`, `error`.

Job status values: `'queued' | 'pending' | 'running' | 'complete' | 'failed'`

#### `GET /api/jobs/:id`
```typescript
Job | 404
```

#### `GET /api/jobs/:id/report?file={aiperf|dcgm}`
```typescript
{ url: string, expiresIn: number }   // presigned S3 URL, 60s expiry
```

#### `GET /api/reports`
```typescript
{ reports: ReportListItem[] }
```

#### `GET /api/reports/:id`
```typescript
{ job: JobDetail, aiperf: AiperfResults, dcgm: DcgmResults }
// Only available for jobs with status 'complete'
```

### 5.2 Backend collector API (Python)

Served by `collector_api.py` via uvicorn on `HTTP_HOST:HTTP_PORT` (default `0.0.0.0:8080`).

#### `POST /jobs/{job_id}/results`

Called by the `results-collector` sidecar container inside the benchmark pod after AIPerf finishes.

```python
class CollectorPayload(BaseModel):
    job_id: str
    metrics: dict          # aiperf output.json contents
    raw_results_path: str  # best-effort path on PVC (default "")
```

Response: HTTP 204. Caches `payload.metrics` in `scheduler.pending_metrics[job_id]` for aggregation with job metadata before publishing to NATS results subject.

### 5.3 Compatibility validation

Enforced server-side in `frontend/src/lib/jobs/validation.ts`. Also enforced client-side (chips disabled in `EngineQuantPanel`). Server is authoritative.

| Condition | HTTP response |
|---|---|
| NVFP4 + `rtx-4000-ada` | 422 — "NVFP4 requires RTX Pro 6000 (no FP4 cores)" |
| NVFP4 + vLLM | 422 — "NVFP4 is TensorRT-LLM exclusive" |
| smoothquant / w4a8 / w4a16 + vLLM | 422 — "TensorRT-LLM exclusive" |
| GGUF / EXL2 + TRT-LLM | 422 — "not supported by TRT-LLM" |

---

## 6. Database Schema

Schema: `backend/db/schema.sql`. Three tables; ownership is split between Next.js and the job controller.

### `jobs` table — owned by Next.js

All user-intent parameters. Written by `POST /api/jobs`, never modified after insert.

| Column | Type | Default | Notes |
|---|---|---|---|
| `job_id` | UUID | `gen_random_uuid()` | PRIMARY KEY |
| `submitted_by` | TEXT | — | NOT NULL |
| `gpu_type` | TEXT | — | `rtx-4000-ada` or `rtx-pro-6000` |
| `engine` | TEXT | — | `vllm` or `trtllm` |
| `model_id` | TEXT | — | HuggingFace repo ID |
| `quantisation` | TEXT | — | `fp16`, `fp8`, `awq`, `gptq`, `nvfp4`, or NULL |
| `dtype` | TEXT | `'auto'` | Derived from quantisation at submission |
| `kv_cache_dtype` | TEXT | `'auto'` | |
| `max_model_len` | INT | `2048` | |
| `gpu_memory_util` | NUMERIC(4,3) | `0.900` | |
| `max_batch_size` | INT | `64` | |
| `prefix_caching` | BOOLEAN | `TRUE` | |
| `chunked_prefill` | BOOLEAN | `TRUE` | |
| `flash_attention` | BOOLEAN | `TRUE` | |
| `concurrency` | INT | `16` | |
| `input_tokens_mean` | INT | `512` | |
| `output_tokens_mean` | INT | `256` | |
| `request_count` | INT | `100` | |
| `streaming` | BOOLEAN | `TRUE` | |
| `measurement_window` | INT | `120` | seconds |
| `isl_distribution` | TEXT | — | `fixed`, `normal-10`, `normal-25`, `exponential`, `synthetic` |
| `backend` | TEXT | `'openai'` | `openai` or `triton-grpc` |
| `batch_scheduler` | TEXT | `'inflight'` | `inflight` or `static` (TRT-LLM) |
| `cuda_graphs` | BOOLEAN | `TRUE` | TRT-LLM only |
| `created_at` | TIMESTAMPTZ | `now()` | |

### `job_status` table — owned by job controller

| Column | Type | Default | Notes |
|---|---|---|---|
| `job_id` | UUID | — | PRIMARY KEY, FK → `jobs(job_id)` |
| `k8s_job_name` | TEXT | — | NOT NULL |
| `engine` | TEXT | — | `vllm` or `trtllm` |
| `status` | TEXT | `'pending'` | `pending`, `running`, `complete`, `failed` |
| `error` | TEXT | NULL | |
| `created_at` | TIMESTAMPTZ | `now()` | |
| `completed_at` | TIMESTAMPTZ | NULL | |

### `job_dlq` table — owned by job controller

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | BIGSERIAL | — | PRIMARY KEY |
| `job_id` | UUID | — | FK → `jobs(job_id)` |
| `error` | TEXT | — | NOT NULL |
| `created_at` | TIMESTAMPTZ | `now()` | |

Written on K8s submission failure and on K8s job execution failure. Paired with a publish to NATS `JOBS_DLQ` / `jobs.dlq` for alerting.

---

## 7. NATS JetStream

| Property | Value |
|---|---|
| Jobs stream | `JOBS` |
| Jobs subject | `jobs` |
| DLQ stream | `JOBS_DLQ` |
| DLQ subject | `jobs.dlq` |
| Jobs payload | `{ job_id: string }` |
| DLQ payload | `{ job_id: string, error: string }` |
| Consumer | Durable, name `"job-controller"` |
| Publisher | `frontend/src/lib/jobs/nats.ts` — lazy singleton, silent no-op if `NATS_URL` unset |

**Design rule:** The NATS payload carries **only** `job_id`. All benchmark parameters are read from Postgres by the job controller. This eliminates drift between what is stored and what is executed.

To inspect messages without consuming:
```bash
nats stream view JOBS --server <NATS_URL>
```

---

## 8. Engine Tuning Parameters

### Why these parameters matter for benchmark results

**GPU memory utilisation** controls the KV cache size. Higher values allow more concurrent requests before OOM. Default 0.90 for both engines.

**Prefix caching** (vLLM) caches the KV state of a shared system prompt. If the benchmark uses a shared system prompt, prefix caching dramatically reduces TTFT for all requests after the first.

**In-flight batching** (TRT-LLM `batch_scheduler=inflight`) vs static batching — in-flight dynamically adds requests to running batches, giving lower TPOT at high concurrency.

**GEMM autotuning** (TRT-LLM) is run at engine compile time and baked into the binary. Selects the optimal matrix multiplication kernel for each layer shape on the target GPU. Cannot be toggled at serve time.

**Speculative decoding** requires a compatible draft model checkpoint. For Path B (HF weights), a draft model must be compiled separately and co-located on the PVC.

**CUDA graphs** (TRT-LLM) capture the CUDA kernel execution graph and replay it, eliminating CPU-side launch overhead. Enabled by default. Disable only for debugging.

---

## 9. Environment Variables

### Frontend (`frontend/`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NATS_URL` | No | NATS server URL — omit in dev to skip publishing silently |
| `S3_ENDPOINT_URL` | Yes (reports) | S3-compatible storage endpoint |
| `AWS_ACCESS_KEY_ID` | Yes (reports) | S3 credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes (reports) | S3 credentials |
| `S3_REGION` | No | Default `'us-east-1'` |
| `S3_BUCKET` | Yes (reports) | S3 bucket name |

### Backend job controller (`backend/job_controller/`)

| Variable | Required | Description |
|---|---|---|
| `NATS_URL` | Yes | NATS server URL |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `K8S_NAMESPACE` | No | Kubernetes namespace; default `'default'` |
| `TEMPLATE_DIR` | No | Path to Jinja2 templates; default `'/app/templates'` |
| `MODEL_CACHE_PVC` | No | PVC name for model cache; uses `emptyDir` if unset |
| `HTTP_HOST` | No | Collector API host; default `'0.0.0.0'` |
| `HTTP_PORT` | No | Collector API port; default `8080` |
| `POLL_INTERVAL_SECONDS` | No | K8s status poll interval; default `15` |

---

## 10. Tech Stack Summary

| Layer | Technology | Version / Notes |
|---|---|---|
| Portal frontend | Next.js (App Router, TypeScript strict) | 15 |
| UI components | shadcn/ui + Tailwind CSS | v4 — do not hand-edit `components/ui/` |
| Global state | Zustand | — |
| Jobs page data fetching | SWR | 5-second refresh interval |
| API server | Next.js Route Handlers | No separate FastAPI backend |
| Database | PostgreSQL + asyncpg | 3 tables: `jobs`, `job_status`, `job_dlq` |
| Object storage | S3-compatible (Linode Object Storage) | Raw AIPerf + DCGM results; presigned URLs for download |
| Job queue | NATS JetStream | Stream: `JOBS` / Subject: `jobs`; payload: `{ job_id }` only |
| Dead-letter queue | NATS JetStream + Postgres | Stream: `JOBS_DLQ`; table: `job_dlq` |
| Job controller | Python (asyncpg, kubernetes client, uvicorn) | Consumes NATS, renders Jinja2, submits K8s Jobs |
| vLLM | `vllm/vllm-openai` | `v0.19.0` — pin this |
| TRT-LLM | `nvcr.io/nvidia/tensorrt-llm/release` | `1.2.0` — pin this |
| Benchmark tool | `aiperf` (pip) | `0.7.0` |
| Kubernetes | K8s | ≥ 1.29 (native sidecar `restartPolicy: Always` support) |
| GPU driver | NVIDIA driver + CUDA | ≥ 535 + CUDA 12.x (required for FP8, TRT-LLM 1.2) |
| Container runtime | containerd + NVIDIA container toolkit | `nvidia-container-runtime` required on GPU nodes |
| Model cache storage | PVC ReadWriteMany | HF safetensors + compiled TRT-LLM engine binaries |

---

## 11. Pre-Deploy Checklist

### Infrastructure

- [ ] K8s ≥ 1.29 — confirm native sidecar `restartPolicy: Always` support
- [ ] NVIDIA device plugin + `nvidia-container-toolkit` on GPU nodes
- [ ] NVIDIA driver ≥ 535, CUDA 12.x (required for FP8, TRT-LLM 1.2)
- [ ] PVC `model-cache-pvc` (ReadWriteMany) in `default` namespace
- [ ] Postgres instance accessible from both Next.js and job controller
- [ ] NATS JetStream instance accessible from both Next.js and job controller
- [ ] S3-compatible storage for AIPerf + DCGM result files

### Secrets (all in `default` namespace)

- [ ] `hf-token` secret with key `token` — HF access token (accept LLaMA 3 and Gemma licences on HF first)
- [ ] `object-storage` secret — `endpoint_url`, `bucket`, `access_key_id`, `secret_access_key`
- [ ] `ngc-registry` docker secret — NGC API key for TRT-LLM engine images

### Validation

- [ ] Confirm `trtllm-serve` `/v1/completions` endpoint is compatible with AIPerf on target GPU
- [ ] Confirm `vllm serve` `/v1/completions` endpoint is compatible with AIPerf on target GPU
- [ ] Confirm PVC ReadWriteMany storage class is available (or design S3-based alternative for engine cache)
- [ ] Smoke-test job submission end-to-end: `POST /api/jobs` → NATS → controller → K8s pod → results POST → `job_status` updated

### Phase 2 work (post-MVP)

- [ ] SSE streaming of live benchmark events to the browser
- [ ] Authentication / SSO — Akamai internal IdP (OIDC)
- [ ] Side-by-side engine comparison — sequential Job chaining, merged results schema
- [ ] Concurrency sweep automation — parameterised loop over `[1, 2, 4, 8, 16, 32, 64]`
- [ ] Multi-GPU tensor parallelism — `--tensor-parallel-size` flag, multi-GPU node affinity
- [ ] TRT-LLM speculative decoding — draft model compile pipeline, co-location on PVC
- [ ] Engine cache eviction policy — LRU or size-based eviction when PVC approaches capacity

---

*Audience: Engineering — backend, infrastructure, DevOps*
*For feature scope and UX decisions see: `functional.md`*
