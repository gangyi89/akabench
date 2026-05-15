# AKAbench — Akamai GPU Benchmark Portal

Internal web portal that lets Akamai Sales Engineers run reproducible LLM
inference benchmarks on Akamai GPU hardware and generate customer-facing
reports.

> **Not accessible to external customers.** Static identity / SSO is enforced
> at the ingress.

---

## What it does

Engineers pick a model, an inference engine, a hardware tier, and a load
profile through a 4-step wizard. The portal then submits a Kubernetes Job that
spins up the engine, drives it with NVIDIA AIPerf, and streams structured
results back. Results are persisted in Postgres and object storage and can be
rendered into PDF / Markdown / JSON reports.

| Wizard step       | What the user does                                                   |
|-------------------|----------------------------------------------------------------------|
| 1. Model          | Search & pick from a curated catalogue of 45 HF models               |
| 2. Engine & quant | vLLM, SGLang, or TensorRT-LLM; pick a precision (bf16 / fp8 / nvfp4) |
| 3. Hardware       | RTX 4000 Ada (20 GB) or RTX Pro 6000 (96 GB, FP4-capable)            |
| 4. Run & report   | Submit, watch progress, view metrics, export the report             |

### Key metrics produced

All produced by AIPerf and surfaced in the report:

| Metric                     | Unit    | Meaning                                       |
|----------------------------|---------|-----------------------------------------------|
| Throughput                 | tok/s   | Total output tokens/sec across all users      |
| TTFT p50 / p95 / p99       | ms      | Time to first token — prefill latency         |
| TPOT p50 / p95             | ms/tok  | Time per output token — decode speed          |
| End-to-end latency p50/p99 | ms      | Full request round-trip                       |
| GPU utilisation            | %       | Compute saturation during the test            |
| GPU VRAM peak              | GB      | Memory headroom signal                        |

---

## Architecture

Two long-lived services in the same Kubernetes namespace, talking via NATS
and Postgres. The frontend is the only writer of `jobs`; the job_controller is
the only writer of `job_status`. Postgres is the single source of truth — NATS
carries only the `job_id` (the consumer reads parameters from the DB).

```
┌───────────────────────────────────────────────────────────────────┐
│                              Browser                              │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ HTTPS
                                    ▼
┌───────────────────────────────────────────────────────────────────┐
│  web  (Next.js 16)                              deploy/app/web.yaml│
│    Pages, API routes, NATS publisher, Postgres writer             │
└─┬──────────────────────┬─────────────────────────────────────────┬┘
  │                      │                                         │
  │ INSERT jobs row      │ publish { job_id }                      │ presign
  ▼                      ▼                                         ▼
┌───────────┐    ┌─────────────────┐                       ┌───────────────┐
│ Postgres  │    │ NATS JetStream  │                       │ Linode Object │
│   jobs    │    │  stream:JOBS    │                       │   Storage     │
│ job_dlq   │    │  subject:jobs   │                       │ (aiperf/dcgm) │
│ job_status│    │                 │                       └───────▲───────┘
│  models   │    └────────┬────────┘                               │
└─────▲─────┘             │ consume                                │
      │                   ▼                                        │
      │       ┌──────────────────────────────┐                     │
      │       │ job_controller (Python)      │                     │
      │       │   deploy/app/job-controller  │                     │
      │       │  • read params from Postgres │                     │
      │       │  • render Jinja2 K8s Job     │                     │
      │       │  • submit + poll status      │                     │
      │       │  • write job_status          │                     │
      │       └─────────────┬────────────────┘                     │
      │                     │ kubectl apply                        │
      │                     ▼                                      │
      │       ┌──────────────────────────────┐                     │
      │       │  K8s Job (per benchmark)     │                     │
      │ poll  │  ┌──────────┐  ┌──────────┐  │  S3 PUT             │
      └───────│  │ engine   │  │  aiperf  │──┼─────────────────────┘
              │  │ sidecar  │←─│  driver  │  │   aiperf installs boto3
              │  └──────────┘  └──────────┘  │   and uploads results
              └──────────────────────────────┘   directly to object store
```

### Service responsibilities

| Service              | Tech                           | Owns           | Reads        |
|----------------------|--------------------------------|----------------|--------------|
| `web`                | Next.js 16 (App Router, TS)    | `jobs` writes  | `models`, `job_status` |
| `job_controller`     | Python 3.12, FastAPI, asyncpg  | `job_status`, `job_dlq` writes | `jobs` |
| `Postgres 16`        | —                              | source of truth | —            |
| `NATS 2.10`          | JetStream                      | ordering / delivery only | — |
| `Linode Object Storage` | S3-compatible              | aiperf.json + dcgm.json results | — |

Per-job pods are short-lived and have two containers: `<engine>-server` (vLLM
or SGLang) serves on `localhost:8000`, and the `aiperf` container drives the
benchmark, runs DCGM collection, and uploads `aiperf.json` + `dcgm.json` to
object storage itself.

---

## Repo layout

```
akabench/
├── README.md                  ← you are here
├── functional.md              ← full product spec
├── technical.md               ← full architecture spec
├── Makefile                   ← build / push / release
│
├── frontend/                  ← Next.js app (UI + API routes)
│   ├── src/app/api/          ← model search / derive / hardware / jobs / reports
│   ├── src/components/panels ← ModelPanel, EngineQuantPanel, HardwarePanel, TestParamsPanel
│   ├── src/lib/catalogue     ← types + Postgres-backed model catalogue
│   ├── src/lib/enrichment    ← engine recommendation, VRAM compat, quant gates
│   ├── src/lib/jobs          ← NATS publisher, validation, Postgres job writer
│   └── Dockerfile             ← multi-stage standalone build (≈210 MB)
│
├── backend/
│   ├── job_controller/        ← FastAPI + asyncpg + kubernetes client
│   ├── templates/             ← Jinja2 K8s Job manifests per engine
│   └── Dockerfile             ← python:3.12-slim, ENTRYPOINT job_controller.main
│
├── db/
│   ├── schema.sql             ← DDL for models / jobs / job_dlq / job_status
│   └── migrations/
│       └── 0001_seed_models.sql  ← 45-row catalogue insert
│
├── deploy/
│   ├── app/                   ← K8s manifests: rbac, job-controller, web
│   ├── infra/                 ← postgres, nats, model-cache PVC
│   └── local/                 ← docker-compose for local Postgres + NATS
│
└── infra/yaml/                ← static reference manifests (superseded by backend/templates)
```

---

## Local development

### 1. Start Postgres + NATS

```bash
cd deploy/local
docker compose up -d
```

Postgres on `5432`, NATS on `4222` (monitoring UI on `8222`).

### 2. Initialise the database

```bash
psql "postgres://akabench:akabench@localhost:5432/akabench" -f db/schema.sql
psql "postgres://akabench:akabench@localhost:5432/akabench" -f db/migrations/0001_seed_models.sql
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

### 4. Backend (job_controller)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m job_controller.main   # http://localhost:8080
```

The job_controller HTTP listener on `:8080` is currently dormant (no
in-cluster caller). The wizard works without it, but jobs stay in `queued`
state until the NATS consumer is running.

### Required environment variables

`frontend/.env.local`:

```
DATABASE_URL=postgres://akabench:akabench@localhost:5432/akabench
NATS_URL=nats://localhost:4222
AUTH_SECRET=dev-only-do-not-use-in-prod
S3_ENDPOINT_URL=https://<linode-cluster>.linodeobjects.com
S3_BUCKET=akabench-dev
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

`backend/.env`:

```
DATABASE_URL=postgres://akabench:akabench@localhost:5432/akabench
NATS_URL=nats://localhost:4222
K8S_NAMESPACE=default
HTTP_PORT=8080
POLL_INTERVAL_SECONDS=15
MODEL_CACHE_PVC=model-cache-pvc      # optional
```

---

## Build & deploy

The repo ships a `Makefile` that builds and pushes the two app images, tagged
with the short git SHA. Override `REGISTRY` via env var.

### One-shot release

```bash
make release
```

Equivalent to: `make build` → `make push` → `kubectl set image deployment/job-controller …` + `kubectl set image deployment/web …`.

This builds two images:

- `…/job-controller:<sha>` (Python)
- `…/web:<sha>`            (Next.js)

…pushes them to the registry, and rolls the live Deployments to the new tag.

### Granular targets

| Command                  | What it does                                             |
|--------------------------|----------------------------------------------------------|
| `make build`             | Build both images, no push                               |
| `make build-web`         | Build just the frontend                                  |
| `make build-job-controller` | Build just the job_controller                         |
| `make push`              | Push both to the registry                                |
| `make images`            | Print the tags that `release` will produce               |

### Cluster prerequisites (one-time, per cluster)

These cluster-wide controllers must be installed **before** applying any
`deploy/` manifests. They're not part of `make deploy` because they're owned
by their respective Helm releases.

#### 1. Envoy Gateway (Gateway API ingress)

Provides the `eg` GatewayClass that `deploy/app/web.yaml` references. Envoy
Gateway provisions a Service of type `LoadBalancer` per Gateway — on Linode
that becomes a NodeBalancer with a public IP.

```bash
helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.8.0 \
  --namespace envoy-gateway-system --create-namespace
```

#### 2. cert-manager (TLS via Let's Encrypt)

The `ClusterIssuer` and `Certificate` in `deploy/app/web.yaml` need
cert-manager running with Gateway API support enabled.

```bash
helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --set config.enableGatewayAPI=true
```

#### 3. NVIDIA GPU Operator (drivers + device plugin + DCGM)

Benchmark Jobs request `nvidia.com/gpu` resources and the `aiperf` container
polls the DCGM Exporter for `DCGM_FI_DEV_GPU_UTIL` / `DCGM_FI_DEV_FB_USED`.
The GPU Operator bundles the
NVIDIA driver (≥ 535), container toolkit, device plugin, DCGM Exporter, and
MIG manager in one release. Install on the GPU node pool only.

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --repo https://helm.ngc.nvidia.com/nvidia \
  --namespace gpu-operator --create-namespace
```

#### 4. RWX storage for `model-cache-pvc`

`deploy/infra/model-cache-pvc.yaml` requires a `ReadWriteMany` storage class
(multiple pods mount the same HF model cache). Linode block storage is RWO
only, so this typically means installing an NFS provisioner or pointing at an
external file server. Set the matching `storageClassName` in the PVC before
applying it.

#### 5. DNS

After Envoy Gateway has provisioned the NodeBalancer (`kubectl get gateway
akabench-gateway -n default` shows the address), point the
`akabench.gangstack.com` A record at that IP. DNS must resolve **before**
applying `deploy/app/web.yaml`, otherwise cert-manager's HTTP-01 challenge
won't reach the cluster and the cert won't issue.

---

### First-time install (or fresh cluster)

```bash
# DB
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/migrations/0001_seed_models.sql

# Secrets — populate once
kubectl create secret generic postgres-secrets \
  --from-literal=database-url="$DATABASE_URL" -n default
kubectl create secret generic web-secrets \
  --from-literal=auth-secret="$(openssl rand -base64 48)" -n default
kubectl create secret generic object-storage \
  --from-literal=endpoint_url="$S3_ENDPOINT_URL" \
  --from-literal=bucket="$S3_BUCKET" \
  --from-literal=access_key_id="$AWS_ACCESS_KEY_ID" \
  --from-literal=secret_access_key="$AWS_SECRET_ACCESS_KEY" \
  -n default
kubectl create secret generic hf-token \
  --from-literal=token="$HF_TOKEN" -n default

# Infra (Postgres, NATS) + RBAC + Deployments
make deploy

# Roll the freshly-built images
make release
```

After this, every iteration is just `make release`.

### Override the registry

```bash
REGISTRY=my.other.registry/akabench make release
```

---

## Where to read deeper

| Topic                            | Doc                       |
|----------------------------------|---------------------------|
| Full product spec & UX           | [functional.md](functional.md) |
| Full technical architecture      | [technical.md](technical.md)   |
| Frontend conventions             | [frontend/AGENTS.md](frontend/AGENTS.md) |
| Backend conventions              | [backend/AGENTS.md](backend/AGENTS.md)   |
| Root design principles & rules   | [AGENTS.md](AGENTS.md)     |
