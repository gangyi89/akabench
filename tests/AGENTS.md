# Agent Guide — AKAbench Tests (`tests/`)

# AKAbench — E2E Test Runbook

This document describes how to run end-to-end benchmark job tests against the portal API. Follow this guide to reproduce the test in future sessions.

---

## Goal

Submit benchmark jobs for all models compatible with a given GPU, then monitor their status until all reach a terminal state (`complete` or `failed`). Report any issues found.

---

## Prerequisites

- Next.js dev server running at `http://localhost:3000` (run `cd frontend && npm run dev`)
- Job controller running locally (`cd backend && .venv/bin/python -m job_controller.main`)
- Postgres + NATS up via `cd deploy/local && docker compose up -d`
- K8s cluster reachable via `kubectl` with GPU nodes available
- Required K8s secrets in place: `hf-token`, `object-storage` (NGC secret no longer required — TRT-LLM is not in scope)
- Logged-in session — every protected route requires the `aka_session` cookie. Either obtain one via `POST /api/auth/login` first, or run an unauthenticated `curl` against `/api/auth/login` and reuse the `Set-Cookie` value:

```bash
curl -s -c /tmp/aka.cookies -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"akamai","password":"akabench"}'
# Subsequent calls:
curl -s -b /tmp/aka.cookies http://localhost:3000/api/hardware
```

A valid JSON response with GPU entries confirms the server is ready *and* the session is good.

---

## Step 1 — Identify compatible models

The RTX 4000 Ada has 20 GB VRAM and no FP4 tensor cores. Compatible models are those where `vramFp16Gb <= 20` (run at bf16) or `vramFp8Gb <= 20` (run at fp8 when FP16 doesn't fit). NVFP4-only models and anything that doesn't fit at FP8 are excluded.

Use `GET /api/hardware` and `GET /api/models/search?q=` to enumerate, or refer to the Postgres seed at `db/migrations/0001_seed_models.sql` (the in-memory `SEED_MODELS` array has been removed).

For RTX 4000 Ada the compatible set is (14 models):

**FP16-capable (use bf16):** Llama-3.2-3B, Llama-3.1-8B, Qwen2.5-7B, Qwen3-8B, DeepSeek-R1-Distill-Qwen-7B, DeepSeek-R1-Distill-Llama-8B, Gemma-3-4B-IT, Gemma-4-E4B-IT, Phi-4-Mini-Instruct, Nemotron-Mini-4B-Instruct

**FP8-only (vram too large at FP16):** Qwen3-14B, DeepSeek-R1-Distill-Qwen-14B, Gemma-3-12B-IT, Phi-4

---

## Step 2 — Choose engine per model

Use `GET /api/models/derive?id=<hfRepoId>&gpu=rtx-4000-ada` to get the engine recommendation. In practice:

- Most models: use `vllm` (default, fastest cold start)
- Models with `ngcContainerTag` (e.g. Nemotron-Mini): `/derive` still recommends `trt-llm`, but **must be overridden to `vllm`** — the backend renderer has no TRT-LLM template (`_ALLOWED_ENGINES = {"vllm", "sglang"}` in `backend/job_controller/models.py`). A TRT-LLM submission will be rejected by Pydantic and DLQ'd.
- For structured-generation / lower-latency tests, try `sglang` (image `lmsysorg/sglang:v0.5.11-cu129`).

---

## Step 3 — Submit jobs via API

```bash
submit() {
  local model=$1 quant=$2 engine=$3
  echo -n "[$model | $quant | $engine] → "
  curl -s -b /tmp/aka.cookies -X POST http://localhost:3000/api/jobs \
    -H "Content-Type: application/json" \
    -d "{\"modelId\":\"$model\",\"engine\":\"$engine\",\"quantisation\":\"$quant\",\"gpuId\":\"rtx-4000-ada\"}"
  echo
}

# bf16 models (vllm)
submit "meta-llama/Llama-3.2-3B-Instruct"          "bf16" "vllm"
submit "meta-llama/Llama-3.1-8B-Instruct"          "bf16" "vllm"
submit "Qwen/Qwen2.5-7B-Instruct"                  "bf16" "vllm"
submit "Qwen/Qwen3-8B"                             "bf16" "vllm"
submit "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"   "bf16" "vllm"
submit "deepseek-ai/DeepSeek-R1-Distill-Llama-8B"  "bf16" "vllm"
submit "google/gemma-3-4b-it"                      "bf16" "vllm"
submit "google/gemma-4-e4b-it"                     "bf16" "vllm"
submit "microsoft/Phi-4-mini-instruct"             "bf16" "vllm"
submit "nvidia/Nemotron-Mini-4B-Instruct"          "bf16" "vllm"

# fp8 models (vllm)
submit "Qwen/Qwen3-14B"                            "fp8" "vllm"
submit "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B" "fp8" "vllm"
submit "google/gemma-3-12b-it"                     "fp8" "vllm"
submit "microsoft/phi-4"                           "fp8" "vllm"
```

Each successful submission returns `{"jobId": "<uuid>"}`. Collect the job IDs.

---

## Step 4 — Monitor status

Poll `GET /api/jobs` until all submitted jobs reach `complete` or `failed`. With one GPU, jobs run sequentially (~5 min each). For 14 jobs expect ~70 min total.

```bash
# Paste the 8-char prefixes of your job IDs into my_ids
python3 - <<'EOF'
import subprocess, json, time

my_ids = ['<id1_prefix>', '<id2_prefix>', ...]  # first 8 chars of each jobId

def fetch():
    r = subprocess.run(['curl','-s','-b','/tmp/aka.cookies','http://localhost:3000/api/jobs'], capture_output=True, text=True)
    return json.loads(r.stdout)['jobs']

def matches(job):
    return any(job['id'].startswith(x) for x in my_ids)

poll = 0
while True:
    poll += 1
    jobs = [j for j in fetch() if matches(j)]
    counts = {}
    for j in jobs:
        counts[j['status']] = counts.get(j['status'], 0) + 1
    print(f"[poll #{poll}] {counts}")
    if all(j['status'] in ('complete', 'failed') for j in jobs):
        print("\n=== All jobs terminal ===")
        for j in jobs:
            err = j['error'].split('\n')[0][:60] if j['error'] else ''
            print(f"  {j['modelId'].split('/')[-1]:<45} {j['quantisation']:<6} {j['status']:<10} {err}")
        break
    time.sleep(90)
EOF
```

---

## Step 5 — Handle stuck jobs

If a job's K8s pod is stuck (e.g. a TRT-LLM job that never starts), set a timeout instead of deleting:

```bash
# Find the job name
kubectl get jobs -n default | grep <job-id-prefix>

# Force timeout immediately
kubectl patch job <job-name> -n default --type=merge -p '{"spec":{"activeDeadlineSeconds":1}}'
```

This lets K8s mark it `Failed` naturally and the job controller will update the DB accordingly.

---

## Known Issues (as of 2026-04-14)

| # | Issue | Severity |
|---|---|---|
| 1 | **TRT-LLM engine path is removed from the backend** — the renderer and templates were dropped (`_ALLOWED_ENGINES = {"vllm", "sglang"}`). Any TRT-LLM submission is now rejected at Pydantic parse time in the controller and DLQ'd. | High (workflow) |
| 2 | **Engine recommendation still steers NGC models to TRT-LLM** — `/derive` recommends `trt-llm` for Nemotron-Mini-4B-Instruct due to `ngcContainerTag`. Override to `vllm` (or `sglang`) before submitting. | Medium |
| 3 | **Status sync lag causes brief double-running display** — when one job completes at the K8s level and the next pod starts before the collector POST lands, the Jobs page briefly shows two jobs as `running` on a single-GPU cluster. | Low |

---

## Results from first full run (2026-04-14)

13/14 jobs completed successfully on RTX 4000 Ada. The only failure was Nemotron-Mini-4B-Instruct submitted with `trt-llm` (see Issue 1 above). All 13 vllm jobs completed, including both FP8 models and Gemma 4 (which uses a custom container to support the `gemma4` architecture).
