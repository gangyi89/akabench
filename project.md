# Akamai GPU Benchmark Portal — Functional Design & Architecture

> **Internal use only.** This document describes the design, architecture, and implementation plan for the Akamai GPU Benchmark Portal — an internal tool for Akamai engineers to benchmark GPU inference performance and generate customer-facing reports.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [User Experience & Portal Flow](#3-user-experience--portal-flow)
   - 3.1 [Step 1 — Hardware selection](#31-step-1--hardware-selection)
   - 3.2 [Step 2 — Model & engine](#32-step-2--model--engine)
   - 3.3 [Step 3 — Test parameters](#33-step-3--test-parameters)
   - 3.4 [Step 4 — Run & report](#34-step-4--run--report)
4. [Inference Engines](#4-inference-engines)
5. [Quantisation Format Compatibility Matrix](#5-quantisation-format-compatibility-matrix)
6. [Benchmark Tooling](#6-benchmark-tooling)
7. [System Architecture](#7-system-architecture)
   - 7.1 [Component overview](#71-component-overview)
   - 7.2 [Kubernetes job lifecycle](#72-kubernetes-job-lifecycle)
   - 7.3 [GPU node isolation](#73-gpu-node-isolation)
   - 7.4 [Real-time result streaming](#74-real-time-result-streaming)
8. [Kubernetes Manifests](#8-kubernetes-manifests)
   - 8.1 [Node labels & taints](#81-node-labels--taints)
   - 8.2 [Benchmark Job manifest](#82-benchmark-job-manifest)
9. [API Design](#9-api-design)
10. [Performance Metrics Captured](#10-performance-metrics-captured)
11. [Engine Tuning Parameters](#11-engine-tuning-parameters)
12. [Report Generation](#12-report-generation)
13. [Tech Stack Summary](#13-tech-stack-summary)
14. [Open Questions & Next Steps](#14-open-questions--next-steps)

---

## 1. Overview

The **Akamai GPU Benchmark Portal** is an internal web application that allows Akamai engineers to:

- Select GPU hardware (RTX 4000 Ada or RTX Pro 6000)
- Search and select any model from the Hugging Face Hub
- Configure inference engine settings (TensorRT-LLM or vLLM)
- Define load profile and test parameters
- Trigger a benchmark run on a live Kubernetes GPU cluster
- View real-time results streamed back to the browser
- Generate a formatted, customer-facing benchmark report

Access is restricted to Akamai internal employees via SSO.

---

## 2. Goals & Non-Goals

### Goals

- Produce **credible, reproducible** benchmark results using industry-standard tooling (AIPerf)
- Support the **two most performance-relevant inference engines** for NVIDIA hardware: TensorRT-LLM and vLLM
- Allow benchmarking of **any Hugging Face model**, with automatic GPU compatibility checking
- Enforce **engine/quantisation compatibility rules** at the UI layer before a run is triggered
- Generate **customer-shareable reports** with standardised metrics

### Non-Goals

- Not a general-purpose inference serving platform
- Not accessible to external customers (internal only)
- Not designed for multi-GPU or tensor-parallel runs in v1
- Not a continuous monitoring system — runs are on-demand only

---

## 3. User Experience & Portal Flow

The portal is a 4-step wizard. Steps are presented simultaneously (not gated) so engineers can configure everything before running.

```
Hardware → Model & Engine → Test Parameters → Run & Report
```

### 3.1 Step 1 — Hardware selection

Users select one of two GPU configurations:

| Option | GPU | VRAM | INT8 Performance | Bus |
|---|---|---|---|---|
| Option A | 1× RTX 4000 Ada | 20 GB | 139 TOPS | PCIe |
| Option B | 1× RTX Pro 6000 | 96 GB | 1457 TOPS | PCIe |

Specs are shown inline on the selection card so engineers can explain the hardware difference to customers without leaving the portal.

### 3.2 Step 2 — Model & engine

#### Model selection

A live search field queries the **Hugging Face Hub API** (`huggingface.co/api/models`) in real time, returning results sorted by monthly downloads. Default filter is `pipeline_tag=text-generation`.

On model selection, the portal immediately displays:

- Parameter count (extracted from safetensors metadata or model ID)
- Monthly downloads and likes
- License
- **GPU compatibility check** — calculates estimated VRAM requirement (params × 2 bytes for FP16) and shows fit status for both GPUs
- Available **quantisation options**, with options disabled if they do not fit the selected GPU's VRAM

#### Engine selection

One engine is selected per benchmark run:

| Option | Description | Best for |
|---|---|---|
| **TensorRT-LLM** | NVIDIA-native, AOT-compiled kernels | Lowest TTFT, lowest TPOT |
| **vLLM** | PagedAttention, open source | Highest concurrent throughput |

Choose **TensorRT-LLM** when the goal is showcasing minimum latency. Choose **vLLM** when the goal is demonstrating maximum concurrent request throughput.

### 3.3 Step 3 — Test parameters

Parameters are organised across three tabs.

#### Tab A — Load profile

| Parameter | Range | Default | Notes |
|---|---|---|---|
| Concurrent users | 1–256 | 16 | Simulated parallel clients |
| Request rate (req/s) | 1–200 | 10 | Requests per second |
| Ramp-up duration (s) | 0–120 | 30 | Linear ramp before sustained load |
| Sustained duration (s) | 30–600 | 120 | Duration of steady-state test |
| Input tokens (avg) | 64–8192 | 512 | Average prompt length |
| Output tokens (max) | 64–4096 | 256 | Maximum generation length |
| Input variance | Fixed / ±10% / ±25% / Zipf | ±25% | Token length distribution |
| Streaming (SSE) | Toggle | On | Whether responses are streamed |
| Mixed input lengths | Toggle | Off | Randomise input lengths |
| Shared prefix / system prompt | Toggle | On | Enables prefix caching benefit |

#### Tab B — Engine tuning

**TensorRT-LLM specific:**

| Parameter | Options | Default |
|---|---|---|
| Batch scheduler | In-flight batching / Static | In-flight batching |
| Max batch size | 1–256 | 64 |
| KV cache dtype | FP8 / FP16 / INT8 | FP8 |
| GPU memory utilisation % | 50–98 | 95 |
| Speculative decoding | Toggle | Off |
| GEMM autotuning | Toggle | On |
| CUDA graphs | Toggle | On |

**vLLM specific:**

| Parameter | Options | Default |
|---|---|---|
| Scheduler policy | Continuous batching / Dynamic | Continuous batching |
| Max batch size | 1–256 | 32 |
| KV cache dtype | Auto (FP16) / FP8 / INT8 | Auto |
| GPU memory utilisation % | 50–98 | 90 |
| PagedAttention | Toggle | On |
| Prefix caching | Toggle | On |
| Chunked prefill | Toggle | Off |
| Flash Attention 2 | Toggle | On |

#### Tab C — Advanced

| Parameter | Options | Default |
|---|---|---|
| Temperature | 0.0–2.0 | 0.7 |
| Top-p | 0.01–1.0 | 0.90 |
| Repetition penalty | 1.0–1.3 | 1.10 |
| Compute dtype | auto / float16 / bfloat16 | auto |
| torch.compile (vLLM) | Toggle | Off |
| TTFT capture | Toggle | On |
| TPOT capture | Toggle | On |
| Throughput (tok/s) | Toggle | On |
| GPU util & VRAM peak | Toggle | On |
| P50/P95/P99 latency | Toggle | On |
| Token error rate | Toggle | Off |

### 3.4 Step 4 — Run & report

- A status chip shows current state: `Ready` → `Running` → `Done` / `Failed`
- A progress bar animates during the run (polled from the API via SSE)
- **Live results** are streamed back as the benchmark progresses:
  - 4 headline metrics: Throughput (tok/s), TTFT p50, TPOT p50, GPU util %
  - Latency bar chart: P50 / P95 / P99
- **Generate report** button triggers report generation (see Section 12)

---

## 4. Inference Engines

### TensorRT-LLM

- **Maintained by:** NVIDIA
- **Key mechanism:** Ahead-of-time compilation of model weights into a CUDA engine binary using NVIDIA's `modelopt` + `trtllm-build` toolchain. At inference time, no Python or framework overhead — pure compiled CUDA kernels.
- **Strength:** Lowest possible TTFT and TPOT on NVIDIA hardware. GEMM autotuning adapts kernel shapes to the exact GPU architecture.
- **Setup requirement:** Model must be compiled into a TRT-LLM engine before first run. This compilation step takes minutes to hours depending on model size and is cached in the pod's persistent volume.
- **Supported quantisation (native):** FP16, BF16, FP8, INT8 (SmoothQuant), INT4 (AWQ, GPTQ), NVFP4, W4A8, W4A16

### vLLM

- **Maintained by:** vLLM project (UC Berkeley origin), Apache 2.0
- **Key mechanism:** PagedAttention — manages the KV cache using virtual memory paging, eliminating memory fragmentation and enabling much higher GPU memory utilisation at high concurrency.
- **Strength:** Highest sustained throughput under concurrent load. Continuous batching means new requests join in-flight batches without waiting for a batch boundary.
- **Setup requirement:** Loads directly from Hugging Face or local model directory — no compilation step.
- **Supported quantisation:** FP16, BF16, FP8, INT8 (GPTQ), INT4 (AWQ, GPTQ), partial GGUF/EXL2

---

## 5. Quantisation Format Compatibility Matrix

> ⚠️ When a TRT-LLM exclusive format is selected, the vLLM engine option must be automatically disabled in the UI. "Run both" collapses to "TensorRT-LLM only".

| Format | TensorRT-LLM | vLLM | Notes |
|---|---|---|---|
| FP16 | ✅ | ✅ | Baseline, highest quality |
| BF16 | ✅ | ✅ | Better dynamic range than FP16 |
| FP8 (E4M3/E5M2) | ✅ | ✅ | ~2× memory saving, minimal quality loss |
| INT8 — GPTQ | ✅ | ✅ | Post-training quantisation |
| INT4 — AWQ | ✅ | ✅ | Activation-aware, good quality/size tradeoff |
| INT4 — GPTQ | ✅ | ✅ | 4-bit compressed weights |
| **NVFP4** | ✅ TRT only | ❌ | NVIDIA 4-bit float. ~4× memory saving. **RTX Pro 6000 only** — requires Blackwell/Ada FP4 tensor cores not present on RTX 4000 Ada |
| **INT8 — SmoothQuant** | ✅ TRT only | ❌ | NVIDIA W8A8 with activation smoothing calibration |
| **W4A8 (TRT native)** | ✅ TRT only | ❌ | 4-bit weights, 8-bit activations |
| **W4A16 (TRT native)** | ✅ TRT only | ❌ | 4-bit weights, 16-bit activations |
| **FP8 KV cache (TRT)** | ✅ TRT only | ⚠️ Partial | Custom TRT kernel; vLLM has limited support |
| GGUF (Q4_K_M, Q5_K_S…) | ❌ | ⚠️ Partial | llama.cpp format; not recommended for GPU benchmarking |
| EXL2 / ExLlamaV2 | ❌ | ⚠️ Partial | Variable bit-rate; not well supported |

### Hard blocks enforced by the portal

| Condition | Action |
|---|---|
| NVFP4 selected | Disable vLLM. Show: *"NVFP4 is TensorRT-LLM exclusive"* |
| NVFP4 + RTX 4000 Ada selected | Block run. Show: *"NVFP4 requires FP4 tensor cores. Use RTX Pro 6000."* |
| SmoothQuant / W4A8 / W4A16 selected | Disable vLLM. Show engine-exclusive notice |
| GGUF or EXL2 selected | Disable TRT-LLM. Show: *"GGUF/EXL2 not supported by TensorRT-LLM"* |

---

## 6. Benchmark Tooling

### Primary: AIPerf (NVIDIA)

**Why:** AIPerf is the tool NVIDIA uses internally to produce the performance numbers on their official GPU spec sheets. Results produced by AIPerf are directly comparable to published NVIDIA benchmarks, giving customers an immediate credibility anchor.

- Ships as part of the Triton client library (`tritonclient` package)
- Communicates with inference engines via their OpenAI-compatible `/v1/completions` endpoint
- Outputs structured JSON with all key metrics
- Supports concurrency sweeps (running the same test at 1, 2, 4, 8, 16, 32, 64 concurrent users)

**Installation:**
```bash
pip install tritonclient[all] aiperf
```

**Example invocation:**
```bash
aiperf profile \
  --model meta-llama/Meta-Llama-3.1-8B-Instruct \
  --tokenizer meta-llama/Meta-Llama-3.1-8B-Instruct \
  --url localhost:8000 \
  --concurrency 16 \
  --input-tokens-mean 512 \
  --output-tokens-mean 256 \
  --num-prompts 200 \
  --streaming \
  --output-format json \
  --artifact-dir /results
```

### Secondary: vLLM benchmark_serving.py

Used as a cross-validator specifically for vLLM runs. Since it ships inside the vLLM repo and is used in virtually every published vLLM performance paper, customers can independently reproduce results.

```bash
python benchmarks/benchmark_serving.py \
  --backend openai \
  --model meta-llama/Meta-Llama-3.1-8B-Instruct \
  --host localhost \
  --port 8000 \
  --num-prompts 500 \
  --request-rate 10 \
  --dataset-name sharegpt
```

### Reference: MLCommons MLPerf Inference

Not run as part of the portal. However, if the GPU hardware has existing MLPerf Inference submissions (as the RTX Pro 6000 does), those certified results should be referenced in the customer report as independent third-party validation.

---

## 7. System Architecture

### 7.1 Component overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  Portal UI (React / Next.js)  ◄──── SSE stream (live metrics)│
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP POST /jobs
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  API Server (FastAPI / Node.js)                             │
│  - Validates job config                                     │
│  - Enforces engine/quant compatibility rules                │
│  - Authenticates via Akamai internal SSO                    │
│  - Writes job to queue                                      │
│  - Streams results back via SSE                             │
└──────────┬────────────────────────┬────────────────────────┘
           │                        │
           ▼                        ▼
┌──────────────────┐    ┌───────────────────────┐
│  Job Queue       │    │  Results Store         │
│  (Redis /        │    │  (PostgreSQL + S3)     │
│   RabbitMQ)      │    │  Stores raw JSON,      │
└──────────┬───────┘    │  report PDFs           │
           │            └───────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster (Akamai Cloud / on-prem GPU node pool)  │
│                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │  GPU Node — RTX 4000 Ada│  │ GPU Node — RTX Pro 6000 │  │
│  │  label: gpu-type=rtx4000│  │ label: gpu-type=rtxpro6k│  │
│  │  taint: gpu-benchmark   │  │ taint: gpu-benchmark    │  │
│  │                         │  │                         │  │
│  │  [TRT-LLM pod]          │  │  [TRT-LLM pod]          │  │
│  │  [vLLM pod]             │  │  [vLLM pod]             │  │
│  │  [AIPerf sidecar]   │  │  [AIPerf sidecar]   │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
│                                                             │
│  Job controller (watches queue, creates K8s Jobs)           │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Kubernetes job lifecycle

When a user clicks **Run**, the following sequence executes:

1. **Portal** POSTs a job config payload to the API server:
   ```json
   {
     "gpu": "rtx4000ada",
     "engine": "both",
     "model": "meta-llama/Meta-Llama-3.1-8B-Instruct",
     "quantisation": "fp16",
     "concurrency": 16,
     "input_tokens": 512,
     "output_tokens": 256,
     "duration_seconds": 120,
     "streaming": true
   }
   ```

2. **API server** validates the config (compatibility rules, auth), generates a `job_id`, and writes the job to the Redis queue.

3. **Job controller** (a small Python service running in the cluster) watches the queue. On dequeue, it renders a Kubernetes `Job` manifest and applies it via `kubectl apply`.

4. **Kubernetes schedules the Job** onto the correct GPU node using `nodeSelector` and `tolerations` (see Section 7.3).

5. **Phase 1 — Engine container** starts, loads the model weights (from a shared PVC or HF Hub pull), launches the OpenAI-compatible inference server, and exposes `/v1/completions` on port 8000.

6. **Phase 2 — AIPerf sidecar** (init container pattern) polls the engine's `/health` endpoint. Once healthy, it runs the configured benchmark sweep and writes results JSON to a shared volume.

7. **Results collector** reads the JSON from the shared volume, writes structured metrics to PostgreSQL and raw JSON to S3, then publishes a `job_complete` event.

8. **API server** picks up the completion event and pushes final metrics via SSE to the portal.

9. **Kubernetes Job** is retained for log inspection (TTL: 24h), then auto-deleted.

### 7.3 GPU node isolation

Each physical GPU node is labelled and tainted to ensure benchmark Jobs get exclusive access:

```bash
# Label the node
kubectl label node <node-name> gpu-type=rtx4000ada
kubectl label node <node-name> benchmark-node=true

# Taint the node (prevents non-benchmark workloads landing here)
kubectl taint node <node-name> gpu-benchmark=true:NoSchedule
```

Benchmark Job manifests include the matching `nodeSelector` and `toleration` so only benchmark Jobs can schedule onto these nodes, and benchmark Jobs will only schedule onto these nodes.

### 7.4 Real-time result streaming

The portal uses **Server-Sent Events (SSE)** for live progress. The API server exposes a streaming endpoint:

```
GET /jobs/{job_id}/stream
```

Events emitted during a run:

| Event | Payload |
|---|---|
| `job.queued` | `{ job_id, position_in_queue }` |
| `job.scheduled` | `{ node, gpu }` |
| `job.engine_ready` | `{ engine, warmup_ms }` |
| `job.progress` | `{ percent, current_rps, live_ttft_p50 }` |
| `job.result` | `{ throughput, ttft_p50, tpot_p50, gpu_util, p50, p95, p99 }` |
| `job.complete` | `{ report_id }` |
| `job.failed` | `{ error, logs_url }` |

---

## 8. Kubernetes Manifests

### 8.1 Node labels & taints

```bash
# RTX 4000 Ada node
kubectl label node gpu-node-01 \
  gpu-type=rtx4000ada \
  nvidia.com/gpu.product=RTX-4000-Ada \
  benchmark-node=true

kubectl taint node gpu-node-01 \
  gpu-benchmark=true:NoSchedule

# RTX Pro 6000 node
kubectl label node gpu-node-02 \
  gpu-type=rtxpro6000 \
  nvidia.com/gpu.product=RTX-Pro-6000 \
  benchmark-node=true

kubectl taint node gpu-node-02 \
  gpu-benchmark=true:NoSchedule
```

### 8.2 Benchmark Job manifest

The following is a template rendered by the job controller. Fields in `{{ }}` are substituted at runtime.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: benchmark-{{ job_id }}
  namespace: gpu-benchmarks
  labels:
    app: gpu-benchmark
    job-id: "{{ job_id }}"
    engine: "{{ engine }}"
    gpu: "{{ gpu_type }}"
spec:
  ttlSecondsAfterFinished: 86400   # retain logs for 24h
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never

      # Ensure exclusive GPU node access
      nodeSelector:
        gpu-type: "{{ gpu_type }}"           # e.g. rtx4000ada
        benchmark-node: "true"
      tolerations:
        - key: gpu-benchmark
          operator: Equal
          value: "true"
          effect: NoSchedule

      # Model weights shared volume (pre-pulled or HF cache)
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: model-cache-pvc
        - name: results
          emptyDir: {}

      initContainers:
        # Phase 1: Start inference engine, wait for ready
        - name: engine
          image: "{{ engine_image }}"
          # e.g. nvcr.io/nvidia/tensorrtllm-backend:latest
          #      vllm/vllm-openai:latest
          args:
            - "--model={{ model_id }}"
            - "--dtype={{ dtype }}"
            - "--quantisation={{ quantisation }}"
            - "--max-model-len={{ max_model_len }}"
            - "--gpu-memory-utilization={{ gpu_memory_util }}"
            - "--port=8000"
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: "{{ memory_limit }}"
            requests:
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: model-cache
              mountPath: /models
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 5
            failureThreshold: 60     # allow up to 5min for large model load

      containers:
        # Phase 2: AIPerf benchmark sidecar
        - name: aiperf
          image: nvcr.io/nvidia/tritonserver:latest-py3-sdk
          command: ["/bin/sh", "-c"]
          args:
            - |
              # Wait for engine readiness
              until curl -sf http://localhost:8000/health; do
                echo "Waiting for engine..."; sleep 5;
              done

              # Run AIPerf benchmark
              aiperf profile \
                --model {{ model_id }} \
                --tokenizer {{ model_id }} \
                --url localhost:8000 \
                --concurrency {{ concurrency }} \
                --input-tokens-mean {{ input_tokens }} \
                --output-tokens-mean {{ output_tokens }} \
                --num-prompts {{ num_prompts }} \
                --warmup-request-count 20 \
                {{ "--streaming" if streaming else "" }} \
                --output-format json \
                --artifact-dir /results

              echo "BENCHMARK_COMPLETE"
          volumeMounts:
            - name: results
              mountPath: /results

        # Phase 3: Results collector — pushes JSON to API
        - name: results-collector
          image: akamai-internal/benchmark-collector:latest
          env:
            - name: JOB_ID
              value: "{{ job_id }}"
            - name: API_ENDPOINT
              value: "http://benchmark-api.internal/jobs/{{ job_id }}/results"
            - name: RESULTS_DIR
              value: /results
          volumeMounts:
            - name: results
              mountPath: /results
```

---

## 9. API Design

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/jobs` | Submit a new benchmark job |
| `GET` | `/jobs/{job_id}` | Get job status and config |
| `GET` | `/jobs/{job_id}/stream` | SSE stream of live job events |
| `GET` | `/jobs/{job_id}/results` | Get completed benchmark results |
| `POST` | `/jobs/{job_id}/results` | Internal — collector posts results |
| `POST` | `/reports` | Generate customer report from job results |
| `GET` | `/reports/{report_id}` | Get generated report (PDF / Markdown) |
| `GET` | `/models/search` | Proxy to HF Hub API with compatibility metadata |

### Job payload schema

```typescript
interface BenchmarkJobRequest {
  // Hardware
  gpu: "rtx4000ada" | "rtxpro6000";

  // Engine
  engine: "trt-llm" | "vllm";

  // Model
  model_id: string;              // HuggingFace model ID, e.g. "meta-llama/Meta-Llama-3.1-8B-Instruct"
  quantisation: QuantFormat;     // see compatibility matrix

  // Load profile
  concurrency: number;           // 1–256
  request_rate: number;          // req/s
  ramp_up_seconds: number;
  duration_seconds: number;
  input_tokens_mean: number;
  output_tokens_max: number;
  input_variance: "fixed" | "p10" | "p25" | "zipf";
  streaming: boolean;

  // Engine tuning — TRT-LLM
  trt?: {
    batch_scheduler: "inflight" | "static";
    max_batch_size: number;
    kv_cache_dtype: "fp8" | "fp16" | "int8";
    gpu_memory_util: number;      // 0.5–0.98
    speculative_decoding: boolean;
    gemm_autotuning: boolean;
    cuda_graphs: boolean;
  };

  // Engine tuning — vLLM
  vllm?: {
    scheduler: "continuous" | "dynamic";
    max_batch_size: number;
    kv_cache_dtype: "auto" | "fp8" | "int8";
    gpu_memory_util: number;
    paged_attention: boolean;
    prefix_caching: boolean;
    chunked_prefill: boolean;
    flash_attention: boolean;
  };

  // Sampling
  temperature: number;
  top_p: number;
  repetition_penalty: number;

  // Metrics to capture
  metrics: ("ttft" | "tpot" | "throughput" | "gpu_util" | "latency_percentiles" | "token_error_rate")[];
}
```

---

## 10. Performance Metrics Captured

All metrics are captured by AIPerf and stored in the results database.

| Metric | Unit | Description |
|---|---|---|
| **Throughput** | tokens/s | Total output tokens generated per second across all concurrent users |
| **TTFT p50** | ms | Median time to first token — latency from request sent to first token received |
| **TTFT p95** | ms | 95th percentile TTFT |
| **TTFT p99** | ms | 99th percentile TTFT — worst-case interactive latency |
| **TPOT p50** | ms/token | Median time per output token during decode phase |
| **TPOT p95** | ms/token | 95th percentile TPOT |
| **End-to-end latency p50** | ms | Full request latency (prefill + decode) |
| **End-to-end latency p99** | ms | 99th percentile full request latency |
| **Request throughput** | req/s | Completed requests per second |
| **GPU utilisation** | % | Average GPU compute utilisation during test |
| **GPU VRAM peak** | GB | Peak GPU memory used during test |
| **Token error rate** | % | Rate of truncated or malformed responses (optional) |

---

## 11. Engine Tuning Parameters

### Why these parameters matter for benchmark results

**GPU memory utilisation** directly controls how large the KV cache can grow. Higher values allow more concurrent requests to be held in memory simultaneously, improving throughput but increasing OOM risk.

**Batch size** caps how many requests are processed in a single forward pass. TRT-LLM with in-flight batching fills batches dynamically; static batching waits for a full batch.

**Prefix caching** (vLLM) caches the KV state of the system prompt. If your benchmark uses a shared system prompt (recommended), prefix caching dramatically reduces TTFT for all requests after the first.

**GEMM autotuning** (TRT-LLM) runs a calibration step at engine build time that selects the optimal matrix multiplication kernel for each layer shape on the target GPU. This can reduce TPOT by 10–30% compared to default kernel selection.

**Speculative decoding** uses a small draft model to predict several tokens ahead, then verifies them in a single forward pass of the full model. Reduces TPOT significantly for predictable outputs but requires a compatible draft model.

---

## 12. Report Generation

After a benchmark run completes, the engineer clicks **Generate report**. The portal calls `POST /reports` with the `job_id`.

### Report sections

1. **Executive summary** — 2-3 sentence plain-English summary of results suitable for a customer email
2. **Test configuration** — GPU, model, engine, quantisation, test parameters
3. **Headline metrics table** — Throughput, TTFT p50, TPOT p50, GPU util
4. **Latency distribution** — P50 / P95 / P99 bar chart for TTFT and end-to-end latency
5. **Concurrency sweep** (if run) — throughput and TTFT plotted against concurrent user count
6. **Methodology note** — states that results were produced using NVIDIA AIPerf, the same tooling used in NVIDIA's official GPU performance publications
7. **Recommendations** — suggested engine, quantisation, and configuration for the customer's use case

### Output formats

- **PDF** — for sharing with customers
- **Markdown** — for internal documentation or embedding in proposals
- **JSON** — raw results for customers who want to import into their own tooling

---

## 13. Tech Stack Summary

| Layer | Technology | Notes |
|---|---|---|
| **Portal frontend** | React + Next.js | Internal SSO via Akamai IdP |
| **API server** | FastAPI (Python) or Node.js | Handles job orchestration, SSE streaming |
| **Job queue** | Redis (with BullMQ) or RabbitMQ | Serialises concurrent benchmark requests |
| **Job controller** | Python (kubernetes client library) | Watches queue, renders and applies K8s Job manifests |
| **Inference — TRT-LLM** | `nvcr.io/nvidia/tensorrtllm-backend` | NVIDIA NGC image, pinned version |
| **Inference — vLLM** | `vllm/vllm-openai` | Official Docker image, pinned version |
| **Benchmark tool** | AIPerf (NVIDIA) + vLLM benchmark_serving.py | Primary + secondary |
| **Results store** | PostgreSQL (structured metrics) + S3 (raw JSON, PDFs) | |
| **Kubernetes** | K8s ≥ 1.28 | NVIDIA device plugin required on GPU nodes |
| **GPU driver** | NVIDIA driver ≥ 535 + CUDA 12.x | Required for FP8 / TRT-LLM support |
| **Container runtime** | containerd + NVIDIA container toolkit | `nvidia-container-runtime` required |
| **Model cache** | PersistentVolumeClaim (ReadWriteMany) | Shared across nodes to avoid re-pulling large models |

---

## 14. Open Questions & Next Steps

### Immediate (before build)

- [ ] Confirm Kubernetes cluster availability and GPU node provisioning on Akamai Cloud
- [ ] Decide on API server language — FastAPI (Python, easier HF integration) vs Node.js (existing team preference)
- [ ] Confirm SSO integration method — OIDC / SAML with Akamai internal IdP
- [ ] Decide on model weight caching strategy — pre-pull popular models to PVC, or pull on demand from HF Hub per run
- [ ] Confirm TRT-LLM engine compilation strategy — compile at job time (slow first run, cached) or pre-compile a model library

### Phase 2 features (post-v1)

- [ ] Multi-GPU support (2×, 4× GPU tensor parallelism)
- [ ] **Side-by-side engine comparison** — run TRT-LLM and vLLM sequentially on the same node and surface results in a single report (deferred from v1)
- [ ] Concurrency sweep automation — automatically benchmark at 1, 2, 4, 8, 16, 32, 64 users and plot the curve
- [ ] Historical run comparison — compare current run against previous runs for the same model/hardware
- [ ] Scheduled runs — allow engineers to queue overnight benchmark runs
- [ ] Cost modelling — estimate $ per 1M tokens based on Akamai Cloud GPU pricing

---

*Document version: 1.1 — Side-by-side engine comparison removed (deferred to Phase 2)*
*Authors: Akamai GPU Infrastructure Team*
