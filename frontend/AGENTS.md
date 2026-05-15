<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Agent Guide — AKAbench Frontend (`frontend/`)

This is the authoritative guide for all work inside the `frontend/` directory. Read it before writing any code.

---

## Stack

- **Next.js 15** (App Router, TypeScript strict mode)
- **Tailwind CSS v4**
- **shadcn/ui** — primitive components only (do not hand-edit `src/components/ui/`)
- **Zustand** — global UI state
- **nats** npm package — JetStream publisher
- **swr** — data fetching on the Jobs page

---

## Folder Structure

```
src/
├── app/
│   ├── page.tsx                        # Main configure page (4-panel layout + action bar)
│   ├── jobs/
│   │   └── page.tsx                    # Jobs listing page (live SWR refresh)
│   ├── layout.tsx
│   └── api/
│       ├── models/
│       │   ├── search/route.ts         # GET  /api/models/search?q=
│       │   └── derive/route.ts         # GET  /api/models/derive?id=&gpu=
│       ├── hardware/route.ts           # GET  /api/hardware
│       └── jobs/
│           ├── route.ts                # GET  /api/jobs  |  POST /api/jobs
│           └── [id]/route.ts           # GET  /api/jobs/:id
│
├── components/
│   ├── ui/                             # shadcn/ui — DO NOT hand-edit
│   ├── panels/
│   │   ├── ModelPanel.tsx              # Panel 1 — model search & selection
│   │   ├── EngineQuantPanel.tsx        # Panel 2 — engine cards + quant chips
│   │   ├── HardwarePanel.tsx           # Panel 3 — GPU cards
│   │   └── TestParamsPanel.tsx         # Panel 4 — load profile & engine tuning tabs
│   └── shared/                         # (reserved for reusable non-shadcn components)
│
├── lib/
│   ├── catalogue/
│   │   ├── types.ts                    # All shared TypeScript types
│   │   ├── db.ts                       # In-memory catalogue (searchModels, getModel, getAllGpus, getGpu)
│   │   └── seed.ts                     # SEED_MODELS (37 models) + SEED_GPUS (2 GPUs)
│   ├── enrichment/
│   │   ├── engine.ts                   # Engine recommendation logic
│   │   ├── quants.ts                   # Supported quants deriver
│   │   └── vram.ts                     # Per-GPU VRAM compatibility checker
│   └── jobs/
│       ├── store.ts                    # insertJob / getJob / listJobs (SQL client)
│       ├── validation.ts               # Engine+quant compatibility gate (server-side)
│       └── nats.ts                     # JetStream publisher singleton
│
└── store/
    └── benchmarkStore.ts               # Zustand global UI state
```

---

## API Contract

### `GET /api/models/search?q={query}`
```ts
{ results: SearchResultItem[] }
```
Filters SEED_MODELS by hfRepoId / family / vendor (case-insensitive). Returns lightweight items with license warnings and tags.

### `GET /api/models/derive?id={hfRepoId}&gpu={gpuId}`
The main intelligence endpoint. Powers all cross-panel reactions. `gpu` is optional.
```ts
{
  model: EnrichedModel
  engineRecommendation: 'trt-llm' | 'vllm'
  engineNote: string
  supportedQuants: QuantType[]
  quantNotice: string | null
  compatWarning: string | null
  compat: CompatResult[]     // one entry per GPU
}
```

### `GET /api/hardware`
```ts
{ gpus: GPU[] }
```

### `POST /api/jobs`
```ts
// Request body
{
  modelId: string
  engine: 'trt-llm' | 'vllm'
  quantisation: QuantType | null
  gpuId: string
  // optional — defaults applied server-side:
  concurrency?: number          // default 10
  inputTokensMean?: number      // default 512
  outputTokensMean?: number     // default 128
  requestCount?: number         // default 100
  streaming?: boolean           // default true
  maxModelLen?: number          // default 2048
  gpuMemoryUtil?: number        // default 0.90
  maxBatchSize?: number         // default 32
  prefixCaching?: boolean       // default true
  chunkedPrefill?: boolean      // default true
  flashAttention?: boolean      // default true
}
// Response — 201
{ jobId: string }
```
Validates compat rules → inserts job into DB → publishes to NATS → returns `jobId`.

### `GET /api/jobs`
```ts
{ jobs: Job[] }   // ordered by created_at DESC
```

### `GET /api/jobs/:id`
```ts
Job | 404
```
Uses Next.js 15 async `ctx.params` pattern — do not use sync destructuring.

---

## NATS JetStream

- **Stream:** `REQUESTS`
- **Subject:** `requests`
- **Publisher:** `src/lib/jobs/nats.ts` — lazy singleton, fails silently if `NATS_URL` env var is unset
- **Consumer:** Python job controller in `backend/job_controller/`
- **Payload:** snake_case `BenchmarkRequest` matching what the consumer expects

To inspect messages without consuming:
```bash
nats stream view REQUESTS --server <NATS_URL>
```

---

## Zustand Store (`benchmarkStore.ts`)

### State fields
| Field | Type | Description |
|---|---|---|
| `selectedModelId` | `string \| null` | HF repo ID of selected model |
| `isDeriving` | `boolean` | True while `/derive` fetch is in-flight |
| `selectedEngine` | `EngineType` | `'trt-llm'` (default) or `'vllm'` |
| `selectedQuant` | `QuantType \| null` | Selected quantisation |
| `deriveResult` | `DeriveResult \| null` | Last result from `/derive` |
| `selectedGpuId` | `string \| null` | ID of selected GPU |
| `availableGpus` | `GPU[]` | Loaded from `/api/hardware` |
| `isReadyToRun` | `boolean` | True when model + quant + GPU all set |

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
- NVFP4 chip disabled when GPU lacks FP4 cores or engine is vLLM

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

## Main Page (`app/page.tsx`)

**Layout:**
- Sticky top nav: branding, Configure/Jobs tabs, "Internal Only" badge, user chip
- 2-column grid: `ModelPanel` left | `EngineQuantPanel + HardwarePanel` stacked right
- Full-width `TestParamsPanel` below
- Sticky bottom `ActionBar` (52px height) — 4-step progress indicator + "Run Benchmark" CTA

**4-step progress:** Model → Engine & Quant → Hardware → Parameters (all must be complete to enable Run)

**Confirmation flow:**
1. "Run Benchmark" → opens `ConfirmModal` with config summary table + GPU occupancy warning
2. Confirm → POSTs to `/api/jobs`, shows spinner for 3 seconds, then navigates to `/jobs`
3. Spinner is on the Confirm button (`isSubmitting` state); navigation happens regardless of API response

---

## Jobs Page (`app/jobs/page.tsx`)

- Fetches `GET /api/jobs` via `useSWR` with **5-second refresh interval**
- Table columns: Model, Engine·Quant, Hardware, Status, Submitted by, Started, View
- Status chips: running=blue+pulse dot, complete=green, failed=red, queued/pending=gray
- Engine badges: TRT-LLM=blue, vLLM=green
- Relative timestamps: "just now" / "5 min ago" / "2 hr ago" / "3 days ago"
- Empty state when no jobs exist
- "+ New Benchmark" → `router.push('/')`

---

## Catalogue

### GPUs (2)
| ID | Name | VRAM | FP4 cores | Role |
|---|---|---|---|---|
| `rtx-pro-6000` | RTX Pro 6000 | 96 GB | ✓ | Large models, NVFP4 — Option B |
| `rtx-4000-ada` | RTX 4000 Ada | 20 GB | ✗ | Small/mid models ≤13B FP16 — Option A |

### Models (35)
NVIDIA Nemotron (3) · Meta LLaMA-3.x (3) · Qwen 2.5 + 3 (6) · DeepSeek R1 distills (4) · Google Gemma 3 (3) · Google Gemma 4 (3) · Microsoft Phi 4 (2) · Mistral/Mixtral (2) · Cohere Command R7B (1) · NVFP4 pre-quantized (10)

### How `supportedQuants` is determined

`supportedQuants` on each model in `seed.ts` must reflect what is **actually runnable** for that model's `hfRepoId` — not what is theoretically possible for the model family. The rules:

| Quant | When to include |
|---|---|
| `fp16` | Always — base precision, no config needed |
| `bf16` | Always — base precision, no config needed |
| `fp8` | Always for Ada Lovelace+ GPUs — vLLM quantizes on-the-fly from bf16 at load time. No pre-quantized weights needed. |
| `nvfp4` | Only when the model has an NGC NIM container (`ngcContainerTag` is set) or is explicitly confirmed to support NVFP4 via TRT-LLM. TRT-LLM exclusive — never valid for vLLM. |
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

---

## Compatibility Validation Rules (`jobs/validation.ts`)

Server-side gate — returns HTTP 422 on violation. Also enforced client-side (chips disabled). Server is authoritative.

| Condition | Error |
|---|---|
| NVFP4 + `rtx-4000-ada` | "NVFP4 requires RTX Pro 6000 (no FP4 cores)" |
| smoothquant / w4a8 / w4a16 + vLLM | "TensorRT-LLM exclusive" |

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

## Environment Variables

| Variable | Required for | Description |
|---|---|---|
| `NATS_URL` | Job execution | NATS server URL — omit in dev to skip publishing silently |

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
| Adding a GPU or model | `src/lib/catalogue/seed.ts`, `src/lib/catalogue/types.ts` |
| Changing job submission | `src/app/api/jobs/route.ts`, `src/lib/jobs/nats.ts` |
| Changing UI tokens/colours | `src/app/globals.css` |
