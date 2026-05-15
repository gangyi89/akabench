<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Agent Guide — AKAbench Frontend (`frontend/`)

This is the authoritative guide for all work inside the `frontend/` directory. Read it before writing any code.

---

## Stack

- **Next.js 15** (App Router, TypeScript strict mode, `output: 'standalone'` for Docker)
- **Tailwind CSS v4**
- **shadcn/ui** — primitive components only (do not hand-edit `src/components/ui/`)
- **Zustand** — global UI state
- **nats** npm package — JetStream publisher (`src/lib/jobs/nats.ts`)
- **pg** — Postgres client for jobs/reports/models reads
- **@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner** — log/report fetch + presign
- **swr** — data fetching on the Jobs / Reports pages

---

## Folder Structure

```
src/
├── proxy.ts                            # Next.js middleware — auth gate (matches /portal, /jobs, /reports, protected APIs)
├── app/
│   ├── page.tsx                        # Landing page (marketing + LoginModal entry)
│   ├── landing.css                     # Landing-page-only styles
│   ├── portal/
│   │   └── page.tsx                    # Configure wizard (4-panel layout + action bar)
│   ├── jobs/
│   │   ├── page.tsx                    # Jobs list (SWR 5s refresh)
│   │   └── [id]/page.tsx               # Job detail (logs + report download)
│   ├── reports/
│   │   ├── page.tsx                    # Reports list (completed jobs)
│   │   └── [id]/page.tsx               # Report detail
│   ├── layout.tsx
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts          # POST — username/password → HMAC session cookie
│       │   ├── logout/route.ts         # POST — clears cookie
│       │   └── me/route.ts             # GET  — current user (or null)
│       ├── models/
│       │   ├── search/route.ts         # GET  /api/models/search?q=
│       │   └── derive/route.ts         # GET  /api/models/derive?id=&gpu=
│       ├── hardware/route.ts           # GET  /api/hardware
│       ├── jobs/
│       │   ├── route.ts                # GET  /api/jobs  |  POST /api/jobs
│       │   └── [id]/
│       │       ├── route.ts            # GET  /api/jobs/:id
│       │       ├── logs/route.ts       # GET  /api/jobs/:id/logs?container=engine|aiperf
│       │       └── report/route.ts     # GET  /api/jobs/:id/report?file=aiperf|dcgm  (presigned URL)
│       └── reports/
│           ├── route.ts                # GET  /api/reports
│           └── [id]/route.ts           # GET  /api/reports/:id
│
├── components/
│   ├── ui/                             # shadcn/ui — DO NOT hand-edit
│   ├── panels/
│   │   ├── ModelPanel.tsx              # Panel 1 — model search & selection
│   │   ├── EngineQuantPanel.tsx        # Panel 2 — engine cards + quant chips
│   │   ├── HardwarePanel.tsx           # Panel 3 — GPU cards
│   │   └── TestParamsPanel.tsx         # Panel 4 — load profile & engine tuning tabs
│   └── shared/
│       ├── TopNav.tsx                  # Configure / Jobs / Reports tabs + user chip
│       └── LoginModal.tsx              # Username/password form (shown on landing)
│
├── lib/
│   ├── auth/                           # HMAC session cookie helpers + hardcoded user list
│   ├── catalogue/
│   │   ├── types.ts                    # All shared TypeScript types
│   │   ├── db.ts                       # Postgres-backed catalogue (searchModels, getModel, getAllGpus, getGpu)
│   │   ├── seed.ts                     # SEED_GPUS (2 GPUs). Model seed has moved to db/migrations/0001_seed_models.sql.
│   │   └── derived.ts                  # UI helpers — vramFp16Gb, vramFp8Gb, vramNvfp4Gb, isMoe, tagsFor
│   ├── enrichment/
│   │   ├── engine.ts                   # Engine recommendation logic
│   │   ├── quants.ts                   # Supported quants deriver
│   │   └── vram.ts                     # Per-GPU VRAM compatibility checker
│   └── jobs/
│       ├── store.ts                    # insertJob / getJob / listJobs (asyncpg-style pg client)
│       ├── validation.ts               # Engine+quant compatibility gate (server-side)
│       └── nats.ts                     # JetStream publisher singleton
│
└── store/
    └── benchmarkStore.ts               # Zustand global UI state
```

---

## API Contract

All routes except `/api/auth/*` are gated by `proxy.ts`. Unauthenticated requests get `401 { error, code: 'unauthenticated' }`; unauthenticated page navigation redirects to `/?login=1&from=<path>`.

### Auth

| Route | Body / Query | Response |
|---|---|---|
| `POST /api/auth/login` | `{ username, password }` | `{ user: { username, displayName } }` + sets `aka_session` cookie (HttpOnly, 12 h TTL) |
| `POST /api/auth/logout` | — | clears cookie |
| `GET  /api/auth/me` | — | `{ user: { username, displayName } | null }` |

### `GET /api/models/search?q={query}`
```ts
{ results: SearchResultItem[] }
```
Reads from the Postgres `models` table (seeded by `db/migrations/0001_seed_models.sql`). Filters by hfRepoId / family / vendor (case-insensitive).

### `GET /api/models/derive?id={hfRepoId}&gpu={gpuId}`
The main intelligence endpoint. Powers all cross-panel reactions. `gpu` is optional.
```ts
{
  model: EnrichedModel
  engineRecommendation: EngineType        // 'trt-llm' | 'vllm' | 'sglang'
  engineNote: string
  supportedQuants: QuantType[]
  quantNotice: string | null
  compatWarning: string | null
  compat: CompatResult[]     // one entry per GPU
}
```
Note: the recommendation may return `'trt-llm'` for NGC / NVIDIA-published models, but the backend does not currently execute TRT-LLM jobs. Override to `'vllm'` (or `'sglang'`) at the UI layer when submitting.

### `GET /api/hardware`
```ts
{ gpus: GPU[] }
```

### `POST /api/jobs`
```ts
// Request body
{
  modelId: string
  engine: EngineType            // 'trt-llm' | 'vllm' | 'sglang'
  quantisation: QuantType | null
  gpuId: string
  // optional — defaults applied server-side:
  concurrency?: number          // default 10
  concurrencyLevels?: number[]  // sweep mode (empty = single-level run)
  inputTokensMean?: number      // default 512
  outputTokensMean?: number     // default 128
  islDistribution?: string      // default 'normal-25'  (controls input_tokens_stddev)
  requestCount?: number         // default 100
  measurementWindow?: number    // seconds, default 1800
  backend?: 'openai' | 'triton-grpc'    // default 'openai'
  streaming?: boolean           // default true
  maxModelLen?: number          // default 2048
  gpuMemoryUtil?: number        // default 0.90
  maxBatchSize?: number         // default 32
  prefixCaching?: boolean       // default true
  chunkedPrefill?: boolean      // default true
  flashAttention?: boolean      // default true
  kvCacheDtype?: string         // 'auto' | 'fp8' | 'int8' | 'fp16'
  // TRT-LLM-only tuning (carried through but currently unused):
  batchScheduler?: 'inflight' | 'static'
  cudaGraphs?: boolean
}
// Response — 201
{ jobId: string }
```
Validates compat rules → derives dtype from quantisation → `INSERT INTO jobs` → publishes `{ job_id }` to NATS subject `jobs` → returns `jobId`.

### `GET /api/jobs`
```ts
{ jobs: Job[] }   // ordered by created_at DESC
```

### `GET /api/jobs/:id`
```ts
Job | 404
```
Uses Next.js 15 async `ctx.params` pattern — do not use sync destructuring.

### `GET /api/jobs/:id/logs?container=engine|aiperf`
Fetches the relevant `*.log` from Object Storage and returns it as plain text. Used by the Job detail page.

### `GET /api/jobs/:id/report?file=aiperf|dcgm`
Returns a 60-second presigned URL for the matching result file in Object Storage:
```ts
{ url: string, expiresIn: number }
```

### `GET /api/reports` / `GET /api/reports/:id`
Listing + detail for completed jobs (filtered to `status = 'complete'`). Same shape as `/api/jobs` plus links to the report files.

---

## NATS JetStream

- **Stream:** `JOBS`
- **Subject:** `jobs`
- **Publisher:** `src/lib/jobs/nats.ts` — lazy singleton, fails silently if `NATS_URL` env var is unset
- **Consumer:** Python job controller in `backend/job_controller/`
- **Payload:** `{ job_id }` only — full request parameters are read back from Postgres by the controller. Do not add fields to the NATS payload.

To inspect messages without consuming:
```bash
nats stream view JOBS --server <NATS_URL>
```

---

## Zustand Store (`benchmarkStore.ts`)

### State fields
| Field | Type | Description |
|---|---|---|
| `selectedModelId` | `string \| null` | HF repo ID of selected model |
| `isDeriving` | `boolean` | True while `/derive` fetch is in-flight |
| `selectedEngine` | `EngineType` | `'trt-llm'` \| `'vllm'` \| `'sglang'` |
| `selectedQuant` | `QuantType \| null` | Selected quantisation |
| `deriveResult` | `DeriveResult \| null` | Last result from `/derive` |
| `selectedGpuId` | `string \| null` | ID of selected GPU |
| `availableGpus` | `GPU[]` | Loaded from `/api/hardware` |
| `isReadyToRun` | `boolean` | True when model + quant + GPU all set |
| `concurrencyLevels` | `number[]` | Sweep mode — empty = single-level run |
| `measurementWindow` | `number` | Seconds, default `1800` |
| `islDistribution` | `string` | Default `'normal-25'` |
| `backend` | `'openai' \| 'triton-grpc'` | AIPerf transport, default `'openai'` |
| `kvCacheDtype` | `string` | Shared engine tuning (default `'auto'`) |
| `batchScheduler` | `'inflight' \| 'static'` | TRT-LLM tuning |
| `cudaGraphs` | `boolean` | TRT-LLM tuning, default `true` |

### Actions
| Action | Description |
|---|---|
| `commitModel(hfRepoId, result)` | **Atomic** — sets `selectedModelId`, `deriveResult`, `selectedEngine`, `selectedQuant`, `isReadyToRun` in one `set()` call. Always use this when selecting a model. |
| `setDeriveResult(result)` | Updates derive result when GPU changes with a model already selected |
| `setSelectedEngine(engine)` | User overrides the engine recommendation |
| `setSelectedQuant(quant)` | User selects a quant chip |
| `setSelectedGpu(gpuId)` | Sets GPU and recalculates `isReadyToRun` |
| `setAvailableGpus(gpus)` | Populates GPU list from the hardware API |
| `setIsDeriving(val)` | Loading flag for the derive fetch |
| `setConcurrencyLevels(levels)` / `setMeasurementWindow(s)` / `setIslDistribution(d)` / `setBackend(b)` / `setKvCacheDtype(d)` / `setBatchScheduler(s)` / `setCudaGraphs(b)` | Load profile + engine tuning setters |

**Critical:** Always use `commitModel` when selecting a model — never call separate actions for `selectedModelId` and `deriveResult`. Two `set()` calls = two renders = visible flicker.

---

## Panels

### ModelPanel (Panel 1)
- Search input triggers `GET /api/models/search?q=`; loads full list on mount (empty query)
- On model click: fetches `/derive`, then calls `commitModel(hfRepoId, result)` atomically
- Re-derives when `selectedGpuId` changes (GPU context affects VRAM compat)
- Tag colour coding: nvidia/ngc=blue, nvfp4=purple, apache2/mit=green, gated=amber, fp8=gray

### EngineQuantPanel (Panel 2)
- Reads `deriveResult` from store — never computes recommendations itself
- Two engine cards (TRT-LLM / vLLM) with "recommended" badge
- Quant chips displayed: `fp16, bf16, fp8, nvfp4`
- NVFP4 chip disabled when GPU lacks FP4 cores

### HardwarePanel (Panel 3)
- Fetches `/api/hardware` on mount, writes to `availableGpus` in store
- GPU cards show VRAM, INT8 TOPS, max compatible model size
- Dims GPUs where none of fp16/fp8/nvfp4 fit the selected model
- Reads `compat` matrix from `deriveResult` for per-GPU fit status

### TestParamsPanel (Panel 4)
- Two tabs: **Load Profile** and **Engine Tuning** (custom underline-style tab bar — not shadcn Tabs)
- All state is local to the component (not persisted to Zustand)
- Engine Tuning tab renders TRT-LLM or vLLM-specific params based on `selectedEngine`
- Custom sub-components: `SliderParam`, `SelectParam`, `ToggleParam`, `ParamGroup`, `SectionTitle`

---

## Landing Page (`app/page.tsx`)

- Marketing hero + "Sign In" CTA — public (no auth required)
- Shows `LoginModal` on mount when URL has `?login=1` (set by middleware redirect)
- On successful login: redirects to `?from=<path>` if present, otherwise `/portal`

## Portal Page (`app/portal/page.tsx`)

**Layout (auth-gated by `proxy.ts`):**
- Sticky top nav: branding, Configure/Jobs/Reports tabs, "Internal Only" badge, user chip
- 2-column grid: `ModelPanel` left | `EngineQuantPanel + HardwarePanel` stacked right
- Full-width `TestParamsPanel` below
- Sticky bottom `ActionBar` (52px height) — 4-step progress indicator + "Run Benchmark" CTA

**4-step progress:** Model → Engine & Quant → Hardware → Parameters (all must be complete to enable Run)

**Confirmation flow:**
1. "Run Benchmark" → opens `ConfirmModal` with config summary table + GPU occupancy warning
2. Confirm → POSTs to `/api/jobs`, shows spinner for 3 seconds, then navigates to `/jobs`
3. Spinner is on the Confirm button (`isSubmitting` state); navigation happens regardless of API response

---

## Jobs Page (`app/jobs/page.tsx` + `app/jobs/[id]/page.tsx`)

- Listing fetches `GET /api/jobs` via `useSWR` with **5-second refresh interval**
- Table columns: Model, Engine·Quant, Hardware, Status, Submitted by, Started, View
- Status chips: running=blue+pulse dot, complete=green, failed=red, queued/pending=gray
- Engine badges: TRT-LLM=blue, vLLM=green, SGLang=purple
- Relative timestamps: "just now" / "5 min ago" / "2 hr ago" / "3 days ago"
- Empty state when no jobs exist
- "+ New Benchmark" → `router.push('/portal')`
- Detail page shows job parameters, tabbed access to engine + aiperf logs (via `/api/jobs/:id/logs`) and download buttons for aiperf/dcgm result files (via `/api/jobs/:id/report` presigned URLs).

## Reports Page (`app/reports/page.tsx` + `app/reports/[id]/page.tsx`)

- Listing of completed jobs only — same shape as Jobs list but filtered to `status = 'complete'`
- Detail page renders the AIPerf result summary and exposes the underlying JSON/CSV downloads

---

## Catalogue

### GPUs (`src/lib/catalogue/seed.ts` → `SEED_GPUS`)
| ID | Name | VRAM | FP4 cores | `available` | Role |
|---|---|---|---|---|---|
| `rtx-pro-6000` | RTX Pro 6000 | 96 GB | ✓ | false | Large models, NVFP4 — Option B (not yet provisioned) |
| `rtx-4000-ada` | RTX 4000 Ada | 20 GB | ✗ | true | Small/mid models ≤13B FP16 — Option A |

### Models (~48, Postgres-backed)
The model catalogue lives in the Postgres `models` table, seeded by `db/migrations/0001_seed_models.sql`. `src/lib/catalogue/db.ts` exposes async `searchModels()` / `getModel()` against that table. There is no in-memory `SEED_MODELS` array any more — adding or editing a model means a new migration.

### How `supportedQuants` is determined

`supportedQuants` on each model in `seed.ts` must reflect what is **actually runnable** for that model's `hfRepoId` — not what is theoretically possible for the model family. The rules:

| Quant | When to include |
|---|---|
| `fp16` | Always — base precision, no config needed |
| `bf16` | Always — base precision, no config needed |
| `fp8` | Always for Ada Lovelace+ GPUs — vLLM quantizes on-the-fly from bf16 at load time. No pre-quantized weights needed. |
| `nvfp4` | Only when the model is pre-quantised (NVIDIA ModelOpt — `quantization_config.quant_method: modelopt` in `config.json`, or a separate `hf_quant_config.json`). Runnable on vLLM ≥ 0.7, SGLang, and TRT-LLM. Requires RTX Pro 6000 (FP4 tensor cores). |
| `int4_awq` | **Do not add to base model repos.** AWQ requires pre-quantized weights with `awq_config.json` present in the HF repo. Verify by checking `config.json` for a `quantization_config.quant_method: awq` field. If a separate AWQ repo exists (e.g. `Qwen/Qwen2.5-7B-Instruct-AWQ`), add it as a distinct model entry with its own `hfRepoId`. |

**How to verify a model's actual quant support:**
```bash
# Check if a model has pre-quantized weights (AWQ, GPTQ, FP8, etc.)
curl -s "https://huggingface.co/<repo>/resolve/main/config.json" \
  | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('quantization_config', 'none'))"
# Output "none" → base precision only (fp16, bf16, fp8 on-the-fly)
# Output {"quant_method": "awq", ...} → AWQ pre-quantized, add int4_awq
# Output {"quant_method": "fp8", ...} → FP8 pre-quantized (higher quality than on-the-fly)
```

---

## Engine Recommendation Logic (`enrichment/engine.ts`)

1. NGC container tag present → **TRT-LLM** (pre-built, no compile step)
2. NVIDIA vendor, no NGC → **TRT-LLM** (requires trtllm-build, 10–30 min)
3. MoE architecture → **vLLM** (PagedAttention handles expert routing better)
4. GPU doesn't support TRT-LLM → **vLLM**
5. Default → **vLLM** (no build step, fastest cold start)

**Caveat:** the backend renderer currently only supports `vllm` and `sglang` — TRT-LLM jobs will fail in the controller (Pydantic rejects the engine string and the message is DLQ'd). The recommendation logic still emits `'trt-llm'` for NGC/NVIDIA models because the catalogue tags those models for it; consumers must override before submitting. Once a working TRT-LLM template is restored, this caveat goes away.

---

## Compatibility Validation Rules (`jobs/validation.ts`)

Server-side gate — returns HTTP 422 on violation. Also enforced client-side (chips disabled). Server is authoritative.

| Condition | Error code |
|---|---|
| NVFP4 + `rtx-4000-ada` | `NVFP4_REQUIRES_RTX_PRO_6000` |
| smoothquant / w4a8 / w4a16 + (vLLM or SGLang) | `QUANT_TRTLLM_ONLY` |

---

## Core Conventions

### TypeScript
- Strict mode on — no `any`, use `unknown` and narrow
- All shared types in `src/lib/catalogue/types.ts` — never redefine the same shape elsewhere
- Route handlers typed with `NextRequest` / `NextResponse`
- Prefer `type` over `interface` unless declaration merging is needed

### Styling
- Tailwind utilities for everything static; inline `style={{}}` only for truly dynamic values
- Custom tokens in `globals.css`: `--aka-blue` (#009bde), `--aka-navy`, `--aka-gray-*`, `--aka-green`, `--aka-amber`, `--aka-light`
- Do not hardcode hex values where a CSS variable already exists

### Data Flow — Golden Rule
> All derived UI state (quant chip enabled/disabled, GPU dimmed, engine recommendation) must come from `/api/models/derive`. No panel computes compatibility itself.

### Route Handlers
- Thin: validate → call lib function → return JSON
- Business logic in `src/lib/`, not in route files
- Error shape: `{ error: string, code: string }`
- Use Next.js 15 async `ctx.params` pattern in dynamic routes

### Adding shadcn Components
```bash
npx shadcn@latest add <component-name>
```
Run from `frontend/`. Commit generated `src/components/ui/` files unchanged.

---

## Authentication (`lib/auth/` + `proxy.ts`)

- **Mechanism:** HMAC-SHA256 signed session token stored in `aka_session` cookie (HttpOnly, `SameSite=Lax`, 12 h TTL). No JWT, no external IdP.
- **Token shape:** `base64url(JSON.stringify({ username, exp })) + '.' + base64url(HMAC-SHA256(...))`
- **Verification:** `proxy.ts` (Next.js middleware) runs on every matched route, calls `verifySessionToken()`, returns 401 JSON for `/api/*` or 302 redirect to `/?login=1&from=<path>` for HTML routes.
- **Matched routes:** `/portal/*`, `/jobs/*`, `/reports/*`, `/api/jobs/*`, `/api/reports/*`, `/api/hardware/*`, `/api/models/*`. `/api/auth/*` and `/` are exempt.
- **User base:** Hardcoded list in `lib/auth/users.ts` (currently one account: `akamai` / `akabench`, displayName `Akamai`). Passwords are compared with `timingSafeEqual`. SSO is not in scope — see root AGENTS.md.

The HMAC key comes from `AUTH_SECRET` (required in production; falls back to a dev key when unset).

---

## Environment Variables

| Variable | Required for | Description |
|---|---|---|
| `NATS_URL` | Job execution | NATS server URL — omit in dev to skip publishing silently |
| `DATABASE_URL` | All DB-backed routes | Postgres connection string |
| `AUTH_SECRET` | Production auth | HMAC key for session cookies (32+ random bytes) |
| `OBJECT_STORAGE_ENDPOINT_URL` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | Logs + report download | Linode Object Storage (S3-compatible) — also read by the in-pod uploader |

---

## Running Locally

```bash
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

---

## Key Files to Read Before Editing

| Task | Read first |
|---|---|
| Adding/changing a panel | `src/store/benchmarkStore.ts`, `src/lib/catalogue/types.ts` |
| Changing engine recommendation | `src/lib/enrichment/engine.ts`, `src/app/api/models/derive/route.ts` |
| Changing quant logic | `src/lib/enrichment/quants.ts`, `src/lib/jobs/validation.ts` |
| Adding a GPU | `src/lib/catalogue/seed.ts`, `src/lib/catalogue/types.ts` |
| Adding a model | `db/migrations/` (write a new migration; the catalogue reads from Postgres) |
| Changing job submission | `src/app/api/jobs/route.ts`, `src/lib/jobs/nats.ts` |
| Changing UI tokens/colours | `src/app/globals.css` |
| Touching auth | `src/lib/auth/`, `src/proxy.ts`, `src/app/api/auth/` |
| Touching log/report download | `src/app/api/jobs/[id]/logs/route.ts`, `src/app/api/jobs/[id]/report/route.ts` |
