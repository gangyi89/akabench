# Agent Guide — AKAbench Backend

---

## Overview

The backend consists of a Python **job controller** that:
1. Subscribes to NATS JetStream for incoming benchmark requests
2. Renders a Jinja2 K8s Job manifest
3. Submits the Job to Kubernetes via the Python `kubernetes` client
4. Polls the Job status and writes progress to Postgres (`job_status` table)
5. Publishes the final result back to NATS

---

## Directory Layout

```
backend/
├── AGENTS.md                  # This file
├── CLAUDE.md                  # Pointer to this file
├── Dockerfile
├── requirements.txt
├── .env                       # Local dev env vars (not committed)
├── .venv/                     # Python virtualenv
│
├── job_controller/
│   ├── main.py                # Entry point — wires up all components and runs uvicorn
│   ├── models.py              # Pydantic models: BenchmarkRequest, BenchmarkResult, CollectorPayload
│   ├── scheduler.py           # NATS message handler, K8s job submitter, status watcher
│   ├── nats_client.py         # NATS JetStream singleton (connect, publish, subscribe)
│   ├── k8s_client.py          # Kubernetes BatchV1Api wrapper (create_job, get_job_status)
│   ├── renderer.py            # Jinja2 template renderer → returns parsed dict for K8s API
│   ├── db.py                  # asyncpg Postgres client — writes to job_status table only
│   └── collector_api.py       # FastAPI app — receives results POST from results-collector pod
│
├── db/
│   └── schema.sql             # Postgres schema (run once to initialise)
│
└── templates/
    ├── benchmark-job-vllm.yaml       # Jinja2 template — vLLM engine path
    ├── benchmark-job-vllm-test.yaml  # Static test manifest (no Jinja2 — direct kubectl apply)
    └── benchmark-job-trtllm.yaml     # Jinja2 template — TRT-LLM engine path
```

---

## Local Dev Setup

### Prerequisites

- Python 3.12
- Docker (for Postgres + NATS via docker-compose)
- `kubectl` configured against a cluster with at least one GPU node

### Services (docker-compose)

```bash
cd deploy/local
docker compose up -d
```

Starts:
- **Postgres** on `localhost:5432` — database `akabench`, user `akabench`, password `akabench`
- **NATS** on `localhost:4222` (client) / `8222` (monitoring UI) with JetStream enabled

### Initialise the database

```bash
PGPASSWORD=akabench psql -h localhost -U akabench -d akabench -f db/schema.sql
```

### Python environment

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### Model cache PVC (optional but recommended)

Both job templates (`benchmark-job-vllm.yaml`, `benchmark-job-trtllm.yaml`) mount
the model cache volume from the PVC named by `MODEL_CACHE_PVC`. If the env var is
absent or empty the templates fall back to an `emptyDir` — models download fresh
from HuggingFace Hub on every run (slow, and burns egress).

```bash
kubectl apply -f deploy/infra/model-cache-pvc.yaml
# Provisions 5 TiB linode-block-storage-retain PVC named "model-cache-pvc"
```

Then add `MODEL_CACHE_PVC=model-cache-pvc` to `.env`.

### Environment variables (`.env`)

```
NATS_URL=nats://localhost:4222
DATABASE_URL=postgres://akabench:akabench@localhost:5432/akabench
K8S_NAMESPACE=default
TEMPLATE_DIR=./templates
HTTP_HOST=0.0.0.0
HTTP_PORT=8080
POLL_INTERVAL_SECONDS=15
# Optional — omit to use emptyDir (models re-download each run)
MODEL_CACHE_PVC=model-cache-pvc
```

### Run the controller

```bash
cd backend
.venv/bin/python -m job_controller.main
```

### ⚠ After any code change — restart the local process

The job controller is a plain Python process running locally (not a K8s deployment). Python does not hot-reload — **any change to `job_controller/` or `templates/` requires a process restart to take effect.**

After editing any file under `backend/`:

```bash
pkill -f "job_controller.main"
cd /Users/galim/Documents/akabench/backend && .venv/bin/python -m job_controller.main &> /tmp/job_controller.log &
tail -5 /tmp/job_controller.log   # confirm it started cleanly
```

**Note:** Jinja2 templates (`templates/*.yaml`) are read from disk at render time — template-only changes do not require a restart. Only changes to `.py` files require it.

---

## Database Ownership

Two tables — each has a single writer:

| Table | Writer | Contents |
|---|---|---|
| `jobs` | Next.js (`POST /api/jobs`) | Full job definition — model, engine, params, submitted_by |
| `job_status` | Job controller | Execution state — k8s_job_name, status, error, completed_at |

`job_status.job_id` is a FK to `jobs.job_id`. A `job_status` row can only be created after Next.js has inserted the corresponding `jobs` row.

Connect to Postgres locally:
```bash
PGPASSWORD=akabench psql -h localhost -U akabench -d akabench
```

Useful queries:
```sql
SELECT * FROM jobs;
SELECT * FROM job_status;

-- Joined view
SELECT j.job_id, j.model_id, j.engine, j.gpu_type, j.submitted_by,
       js.status, js.created_at, js.completed_at
FROM jobs j
LEFT JOIN job_status js ON js.job_id = j.job_id
ORDER BY j.created_at DESC;
```

---

## NATS Streams

| Stream | Subject | Publisher | Consumer |
|---|---|---|---|
| `JOBS` | `jobs` | Next.js (`/api/jobs` POST) | Job controller (`scheduler.subscribe`) |
| `JOBS_DLQ` | `jobs.dlq` | Job controller | TBD (alerting) |

The controller subscribes with durable consumer name `job-controller` — messages are re-delivered on restart until ack'd.

---

## Request Flow

```
Next.js POST /api/jobs
  → INSERT INTO jobs
  → publish to NATS subject 'jobs'
      → job controller handle_request()
          → render_manifest(req, engine)       # Jinja2 → dict
          → k8s_client.create_job(manifest)    # kubectl apply equivalent
          → db.insert_job_status(...)          # status = 'pending'
          → _spawn_watcher(req, k8s_job_name)
              → polls k8s every 15s
              → db.update_status(...)          # pending → running → complete/failed
              → nats_client.publish_result()   # publishes to 'results' subject
```

---

## Kubernetes

- **Cluster:** Linode LKE (`lke590684-ctx`)
- **Namespace:** `default`
- **GPU node:** `lke590684-865105-5390de120000` — 4 vCPU, 16 GB RAM, 1× RTX 4000 Ada (20 GB VRAM)
- **GPU label:** `nvidia.com/gpu.product=NVIDIA-RTX-4000-Ada-Generation`
- No `benchmark-node` nodeSelector — removed, not present on cluster nodes
- No PVC in dev — `model_cache_pvc` defaults to `None` → template uses `emptyDir` (model downloads fresh each run)

### CPU resource budgets (vLLM job)

| Container | Request | Limit |
|---|---|---|
| `vllm-server` | 2 CPU | — |
| `aiperf` | 1 CPU | 2 CPU |

Total request = 3 CPU, fits within the 4-CPU node (with ~0.5 CPU already allocated to system pods).

### CrashLoopBackOff — automatic failure handling

The job controller detects engine container crashes and fails the job automatically without operator intervention. This prevents a crashing pod from holding the GPU node indefinitely.

**Threshold:** `CRASH_THRESHOLD = 5` in `k8s_client.py`

**Flow (implemented in `scheduler.py` `_watch_job` + `k8s_client.py`):**

1. Every poll cycle (15 s), `get_engine_restart_count()` checks the `restartCount` on the engine sidecar (`vllm-server` or `trtllm-server`) via the K8s CoreV1Api.
2. When `restartCount >= 5`:
   - `get_pod_logs()` fetches the last 60 lines from the engine container (tries the previous terminated instance first, then current).
   - Logs are written to `job_status.error` in Postgres — surfaced in the UI on the Jobs list and Job detail pages.
   - `fail_job()` patches the K8s Job with `activeDeadlineSeconds: 1`, causing K8s to terminate the pod and mark the Job `Failed` with reason `DeadlineExceeded`.
   - The watcher exits. No further action needed.
3. The pod is **not deleted** — it persists for `ttlSecondsAfterFinished: 86400` (24 h) so logs remain accessible via `kubectl logs`.

**Why `activeDeadlineSeconds: 1` instead of deletion:**
- K8s owns the termination — no race condition between a delete call and pod state transitions.
- The Job shows `DeadlineExceeded` in K8s, which is a clear operator signal.
- Pod and logs survive for the full 24 h TTL.

**Note:** Non-CrashLoopBackOff failures (e.g. OOM, node eviction) are caught by the normal Job-level status poll — those also capture logs and write to `job_status.error` before marking failed.

### Useful kubectl commands

```bash
# Watch jobs
kubectl get jobs -n default -l app=gpu-benchmark

# Watch pods
kubectl get pods -n default -l app=gpu-benchmark

# Stream aiperf logs (benchmark progress + results table)
kubectl logs -f <pod-name> -c aiperf -n default

# Stream vllm-server logs
kubectl logs -f <pod-name> -c vllm-server -n default

# Describe pod (scheduling errors, image pull status)
kubectl describe pod <pod-name> -n default

# Delete all benchmark jobs
kubectl delete jobs -n default -l app=gpu-benchmark

# Force-fail a specific job immediately (same mechanism as the job controller's fail_job())
# K8s terminates the pod and marks the Job Failed with reason DeadlineExceeded.
# Pod and logs are preserved for 24 h per ttlSecondsAfterFinished.
kubectl patch job <job-name> -n default --type merge -p '{"spec":{"activeDeadlineSeconds":1}}'
```

---

## DCGM Exporter — Verify Fields Before Running

The aiperf container polls the GPU Operator DCGM Exporter via its ClusterIP Service at `http://nvidia-dcgm-exporter.gpu-operator.svc.cluster.local:9400/metrics`. Do not use `NODE_IP` — the exporter does not run with `hostNetwork: true`. Two fields must be present in the exporter's ConfigMap:

| Prometheus field | Used for |
|---|---|
| `DCGM_FI_DEV_GPU_UTIL` | GPU utilisation % |
| `DCGM_FI_DEV_FB_USED` | VRAM used (MB) |

Check the active ConfigMap:
```bash
kubectl get configmap dcgm-exporter-metrics -n gpu-operator -o yaml | grep -E "DCGM_FI_DEV_GPU_UTIL|DCGM_FI_DEV_FB_USED"
```

If either field is missing, add it to the ConfigMap. The DCGM Exporter pod does not need restarting — it reloads on ConfigMap change.

---

## vLLM Template — Known Gotchas

| Issue | Fix applied |
|---|---|
| Comment `{{ }}` in template header caused Jinja2 parse error | Escaped to `{​{ }}` |
| GPU type keys `rtx4000ada`/`rtxpro6000` didn't match actual values | Fixed to `rtx-4000-ada`/`rtx-pro-6000` |
| Conditional args (`--enable-prefix-caching` etc.) were bare strings in YAML list | Replaced with `{%- if %} - "..."` block syntax |
| `--streaming` flag collapsed into `--extra-inputs` by `{%- -%}` whitespace stripping | Replaced with `{% if streaming %}--streaming \` on its own line |
| `--quantization` flag passed for `fp16`/`bf16` which are dtypes not quant formats | Skipped when `quantisation in ('fp16', 'bf16')` or null |
| `model-cache-pvc` not present on dev cluster | `model_cache_pvc` field on `BenchmarkRequest` defaults to `None` → `emptyDir` |
| `cat /results/artifacts/*/output.json` glob failed (no subdirectory) | Fixed to `cat /results/artifacts/output.json` |
| asyncpg returns `UUID` type for job_id in `recover()` | Cast to `str()` in scheduler.py |

---

## Testing Without Next.js

When publishing directly to NATS (bypassing Next.js), you must first insert a `jobs` row manually — the FK constraint on `job_status` will reject the insert otherwise:

```python
import asyncio, json, nats, uuid, asyncpg

JOB_ID = str(uuid.uuid4())

async def main():
    pool = await asyncpg.create_pool('postgres://akabench:akabench@localhost:5432/akabench')
    await pool.execute('''
        INSERT INTO jobs (job_id, submitted_by, gpu_type, engine, model_id, quantisation,
                          concurrency, input_tokens_mean, output_tokens_mean, request_count,
                          streaming, backend, max_model_len, gpu_memory_util, max_batch_size,
                          prefix_caching, chunked_prefill, flash_attention)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ''', JOB_ID, 'anonymous', 'rtx-4000-ada', 'vllm',
         'TinyLlama/TinyLlama-1.1B-Chat-v1.0', 'fp16',
         10, 512, 128, 100, True, 'openai', 2048, 0.90, 32, True, True, True)
    await pool.close()

    nc = await nats.connect('nats://localhost:4222')
    js = nc.jetstream()
    await js.publish('jobs', json.dumps({
        'job_id': JOB_ID, 'submitted_by': 'anonymous', 'gpu_type': 'rtx-4000-ada',
        'model_id': 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', 'quantisation': 'fp16',
        'concurrency': 10, 'input_tokens_mean': 512, 'output_tokens_mean': 128,
        'request_count': 100, 'streaming': True, 'max_model_len': 2048,
        'gpu_memory_util': 0.9, 'max_batch_size': 32,
        'prefix_caching': True, 'chunked_prefill': True, 'flash_attention': True,
    }).encode())
    await nc.drain()

asyncio.run(main())
```

Run from `backend/` with `.venv/bin/python`.
