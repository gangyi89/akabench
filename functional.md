# Akamai GPU Benchmark Portal — Functional Design

> **Internal use only — Akamai employees only.**
> This document describes what the portal does, who it is for, and how users interact with it. For implementation details, infrastructure, and code-level specifications see the companion Technical Design document.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Supported Models](#2-supported-models)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [Users & Access](#4-users--access)
5. [Portal Flow — 4-Step Wizard](#5-portal-flow--4-step-wizard)
   - 5.1 [Step 1 — Model & engine](#51-step-1--model--engine)
   - 5.2 [Step 2 — Hardware selection](#52-step-2--hardware-selection)
   - 5.3 [Step 3 — Test parameters](#53-step-3--test-parameters)
   - 5.4 [Step 4 — Run & report](#54-step-4--run--report)
6. [Model Selection Advisor](#6-model-selection-advisor)
7. [Engine Selection Guidance](#7-engine-selection-guidance)
8. [Quantisation Format Compatibility](#8-quantisation-format-compatibility)
9. [Performance Metrics Captured](#9-performance-metrics-captured)
10. [Report Generation](#10-report-generation)
11. [Phase 2 Roadmap](#11-phase-2-roadmap)

---

## 1. Overview

The **Akamai GPU Benchmark Portal** is an internal web application that allows Akamai engineers to run credible, reproducible LLM inference benchmarks on Akamai GPU hardware and generate professional customer-facing reports.

Engineers use this portal during the pre-sales and evaluation process to demonstrate the performance of Akamai GPU instances to prospective customers. Results are produced using NVIDIA AIPerf — the same tooling NVIDIA uses for their official GPU specification sheets — giving customers a direct, credible point of comparison.

---

## 2. Supported Models

The portal ships with a curated catalogue of the most widely used open-weight LLMs. All models in the catalogue have been pre-enriched with accurate VRAM estimates, supported quantisation formats, and NGC container availability — ensuring the engine and hardware recommendation logic works correctly without any live HuggingFace API calls.

### Catalogue

| Model | Family | Params | Active Params | Architecture | Licence | NGC Container | NVFP4 |
|---|---|---|---|---|---|---|---|
| Llama-3.1-Nemotron-70B-Instruct | Nemotron | 70B | — | Dense | LLaMA-3 | ✅ | ✅ |
| Nemotron-Super-49B-v1 | Nemotron | 49B | — | Dense | LLaMA-3 | ✅ | ✅ |
| Nemotron-Mini-4B-Instruct | Nemotron | 4B | — | Dense | LLaMA-3 | ✅ | ✅ |
| Llama-3.3-70B-Instruct | LLaMA-3 | 70B | — | Dense | LLaMA-3 | ✅ | ✅ |
| Llama-3.1-70B-Instruct | LLaMA-3 | 70B | — | Dense | LLaMA-3 | ✅ | — |
| Llama-3.1-405B-Instruct | LLaMA-3 | 405B | — | Dense | LLaMA-3 | ✅ | — |
| Llama-3.1-8B-Instruct | LLaMA-3 | 8B | — | Dense | LLaMA-3 | ✅ | — |
| Llama-3.2-3B-Instruct | LLaMA-3 | 3B | — | Dense | LLaMA-3 | ✅ | — |
| Llama-3.2-1B-Instruct | LLaMA-3 | 1B | — | Dense | LLaMA-3 | ✅ | — |
| Mistral-7B-Instruct-v0.3 | Mistral | 7B | — | Dense | Apache 2.0 | ✅ | — |
| Mixtral-8x7B-Instruct-v0.1 | Mixtral | 46B | 13B | MoE | Apache 2.0 | ✅ | — |
| Mixtral-8x22B-Instruct-v0.1 | Mixtral | 141B | 39B | MoE | Apache 2.0 | — | — |
| Mistral-Small-3.1-24B-Instruct | Mistral | 24B | — | Dense | Apache 2.0 | — | — |
| Qwen2.5-72B-Instruct | Qwen | 72B | — | Dense | Apache 2.0 | — | — |
| Qwen2.5-32B-Instruct | Qwen | 32B | — | Dense | Apache 2.0 | — | — |
| Qwen2.5-14B-Instruct | Qwen | 14B | — | Dense | Apache 2.0 | — | — |
| Qwen2.5-7B-Instruct | Qwen | 7B | — | Dense | Apache 2.0 | — | — |
| QwQ-32B | Qwen | 32B | — | Dense | Apache 2.0 | — | — |
| Gemma-2-27B-IT | Gemma | 27B | — | Dense | Gated | ✅ | — |
| Gemma-2-9B-IT | Gemma | 9B | — | Dense | Gated | ✅ | — |
| Gemma-2-2B-IT | Gemma | 2B | — | Dense | Gated | ✅ | — |
| Phi-4 | Phi | 14B | — | Dense | MIT | — | — |
| Phi-3.5-Mini-Instruct | Phi | 3.8B | — | Dense | MIT | ✅ | — |
| Phi-3.5-MoE-Instruct | Phi | 41.9B | 6.6B | MoE | MIT | — | — |
| DeepSeek-R1-Distill-Llama-70B | DeepSeek-R1 | 70B | — | Dense | MIT | — | — |
| DeepSeek-R1-Distill-Qwen-32B | DeepSeek-R1 | 32B | — | Dense | MIT | — | — |
| DeepSeek-V3 | DeepSeek | 671B | 37B | MoE | MIT | — | — |
| Command R+ (Aug 2024) | Command | 104B | — | Dense | Commercial | — | — |
| Command R7B (Dec 2024) | Command | 7B | — | Dense | Commercial | — | — |

**Notes:**
- *Active Params* applies to MoE models only — the number of parameters active per forward pass.
- *NGC Container* indicates a pre-built NVIDIA NIM container exists, enabling TensorRT-LLM without compilation.
- *NVFP4* requires an NGC container and an RTX Pro 6000 (FP4 tensor cores). TensorRT-LLM only.
- LLaMA-3 licence includes a 700M monthly active user limit. Apache 2.0 and MIT have no usage restrictions.
- DeepSeek-V3 (671B, 1.3 TB FP16) will not fit on either v1 GPU — included for completeness and multi-GPU Phase 2.

---

## 3. Goals & Non-Goals

### Goals

- Produce **credible, reproducible** benchmark results using industry-standard tooling (NVIDIA AIPerf)
- Support the **two most performance-relevant inference engines** for NVIDIA hardware: TensorRT-LLM and vLLM
- Allow benchmarking of **any Hugging Face model**, with automatic GPU compatibility checking
- Surface **NVIDIA-optimised model alternatives** (Nemotron, Minitron) that showcase best-in-class hardware performance
- Enforce **engine and quantisation compatibility rules** before a run is triggered, preventing wasted benchmark runs
- Generate **customer-shareable reports** with standardised, professionally formatted metrics

### Non-Goals

- Not a general-purpose inference serving platform
- Not accessible to external customers — internal Akamai employees only
- Not designed for multi-GPU or tensor-parallel runs in v1
- Not a continuous monitoring system — runs are on-demand only

---

## 4. Users & Access

**Who uses it:** Akamai sales engineers and solutions architects running GPU hardware evaluations with prospective customers.

**Access control:** Restricted to Akamai internal employees via SSO (Single Sign-On) through the Akamai internal identity provider. No external access.

**Typical usage scenario:** An engineer is on a call with a customer evaluating Akamai GPU instances for LLM inference. The engineer opens the portal, selects the customer's GPU tier, searches for the model the customer is interested in, configures a test that reflects the customer's expected workload, runs the benchmark live, and generates a PDF report to share with the customer afterwards.

---

## 5. Portal Flow — 4-Step Wizard

The portal is presented as a single page with four configuration panels visible simultaneously. Engineers can fill them in any order before triggering a run. No steps are gated — an engineer can jump directly to test parameters without completing earlier steps.

```
Step 1: Model & Engine  →  Step 2: Hardware  →  Step 3: Test Parameters  →  Step 4: Run & Report
```

### 5.1 Step 1 — Model & engine

#### Model search

A live search field queries the Hugging Face Hub in real time. Results are sorted by monthly downloads and filtered to text-generation models by default. The engineer can also search by organisation name (e.g. `meta-llama`, `mistralai`, `nvidia`).

When a model is selected the portal immediately shows:

- Parameter count and estimated VRAM requirement
- Monthly download count and licence
- GPU compatibility status for both hardware options — whether the model fits in FP16, requires quantisation, or is too large even with quantisation
- Available quantisation formats, with incompatible options greyed out

#### Model advisor

When a model is selected, a recommendation panel appears suggesting related models worth benchmarking alongside the primary selection. Recommendations are grouped by type:

- **NVIDIA-optimised variants** — Nemotron and Minitron equivalents that demonstrate best-case NVIDIA hardware performance
- **Same family, different size** — smaller and larger siblings to show the performance/quality tradeoff curve
- **Quantised variants** — pre-quantised AWQ/GPTQ versions of the selected model if it is too large for the selected GPU in FP16
- **Licence alternatives** — Apache 2.0 alternatives if the selected model has a restrictive licence (e.g. LLaMA's 700M MAU restriction)

Each suggestion includes a plain-English explanation of why it is worth benchmarking and what customer story it supports.

#### Engine selection

One engine is selected per benchmark run:

| Engine | What it is | Best for |
|---|---|---|
| **TensorRT-LLM** | NVIDIA-native compiled inference runtime | Showcasing minimum TTFT and TPOT — latency story |
| **vLLM** | Open-source PagedAttention serving | Showcasing maximum concurrent throughput — scalability story |

The portal shows a one-line decision guide: choose TensorRT-LLM for latency demonstrations, vLLM for throughput demonstrations.

If an incompatible engine/quantisation combination is selected (e.g. NVFP4 with vLLM), the incompatible engine is automatically disabled and a clear explanation is shown.

### 5.2 Step 2 — Hardware selection

The engineer selects which GPU to benchmark against. Two options are available in v1:

| Option | GPU | VRAM | INT8 Performance | Target workload |
|---|---|---|---|---|
| A | 1× RTX 4000 Ada | 20 GB | 139 TOPS | Smaller models (≤13B FP16), cost-efficient tier |
| B | 1× RTX Pro 6000 | 96 GB | 1457 TOPS | Large models (up to 70B FP16), NVFP4 capable |

Key specs (VRAM, TOPS) are shown inline on each card so engineers can explain the hardware difference without leaving the portal.

### 5.3 Step 3 — Test parameters

Parameters are organised across three tabs to avoid overwhelming the engineer.

#### Tab A — Load profile

Controls the shape of traffic sent to the inference engine during the test.

| Parameter | Range | Default | What it controls |
|---|---|---|---|
| Concurrent users | 1–256 | 16 | Number of simulated parallel clients |
| Request rate | 1–200 req/s | 10 | Requests sent per second |
| Ramp-up duration | 0–120 s | 30 s | Linear ramp before sustained load begins |
| Sustained duration | 30–600 s | 120 s | How long steady-state load is held |
| Input tokens (avg) | 64–8192 | 512 | Average prompt length in tokens |
| Output tokens (max) | 64–4096 | 256 | Maximum generation length |
| Input variance | Fixed / ±10% / ±25% / Zipf | ±25% | Distribution of input lengths |
| Streaming (SSE) | On / Off | On | Whether responses stream token by token |
| Mixed input lengths | On / Off | Off | Randomise input lengths across requests |
| Shared system prompt | On / Off | On | Use a common prefix across all requests (enables prefix caching) |

#### Tab B — Engine tuning

Controls engine-specific performance settings. Defaults are pre-set to optimal values for benchmarking — engineers only need to change these for specific customer scenarios.

TensorRT-LLM parameters: batch scheduler, max batch size, KV cache dtype, GPU memory utilisation, speculative decoding, GEMM autotuning, CUDA graphs.

vLLM parameters: scheduler policy, max batch size, KV cache dtype, GPU memory utilisation, PagedAttention, prefix caching, chunked prefill, Flash Attention 2.

#### Tab C — Advanced

Sampling parameters (temperature, top-p, repetition penalty), compute dtype, and a checklist of which metrics to capture in the results.

### 5.4 Step 4 — Run & report

Once configuration is complete the engineer clicks **Run benchmark**.

During the run:

- A status chip updates: `Ready` → `Running` → `Done` / `Failed`
- A progress bar animates as the benchmark proceeds
- Live metrics stream to the UI in real time as results come in

When complete, the results panel shows:

- 4 headline metrics: Throughput (tok/s), TTFT p50, TPOT p50, GPU utilisation %
- Latency distribution: P50 / P95 / P99 bar chart

The **Generate report** button produces a formatted customer-facing report (see Section 9).

---

## 6. Model Selection Advisor

The advisor panel appears automatically when a model is selected and dismisses if the engineer picks an NVIDIA model directly (no need to recommend NVIDIA alternatives to someone already using one).

### Recommendation dimensions

| Dimension | Trigger | Value |
|---|---|---|
| NVIDIA-optimised variants | Any base model with a Nemotron/Minitron equivalent | Demonstrates best-case NVIDIA hardware performance; NVFP4 models exclusive to RTX Pro 6000 |
| Same family, different size | Any model selection | Shows performance/quality tradeoff curve within a trusted family |
| Quantised variants | Selected model too large for chosen GPU in FP16 | Enables the benchmark to proceed instead of showing an error |
| Licence alternatives | Selected model has a restrictive licence | Surfaces Apache 2.0 alternatives to pre-empt customer legal objections |
| Task-specialised models | Customer use case known (coding, RAG, reasoning, multilingual) | Smaller specialist models often outperform larger general models on specific tasks |
| MoE alternatives | Dense model above 30B selected | Comparable quality at significantly lower inference cost |

Each recommendation card shows: model name, parameter count, licence, download count, tags (Nemotron, NGC, NVFP4), a plain-English description, and a "Why benchmark this" rationale written for the engineer to use in customer conversations. A "Use this model" button swaps it into the active selection.

---

## 7. Engine Selection Guidance

### When to choose TensorRT-LLM

- Customer question is "how fast will a single response be?" (TTFT, TPOT focus)
- Customer is building real-time, interactive applications (chatbots, copilots)
- Benchmarking a Nemotron or NVIDIA-tuned model from NGC — maximum hardware differentiation story
- Customer is interested in NVFP4 quantisation (RTX Pro 6000 only)

### When to choose vLLM

- Customer question is "how many users can this GPU serve simultaneously?" (throughput focus)
- Customer is building batch processing, API serving, or background generation pipelines
- Benchmarking an arbitrary HuggingFace model quickly without compilation overhead
- Customer wants open-source, vendor-neutral tooling

---

## 8. Quantisation Format Compatibility

The portal enforces compatibility rules automatically. Engineers do not need to understand the details — the UI handles it.

### Summary

| Format | TRT-LLM | vLLM | Notes |
|---|---|---|---|
| FP16 / BF16 | ✅ | ✅ | Standard baseline |
| FP8 | ✅ | ✅ | ~2× memory saving |
| INT8 GPTQ / INT4 AWQ / INT4 GPTQ | ✅ | ✅ | Standard quantisation |
| **NVFP4** | ✅ TRT only | ❌ | RTX Pro 6000 only — exclusive NVIDIA format |
| **SmoothQuant / W4A8 / W4A16** | ✅ TRT only | ❌ | NVIDIA proprietary formats |
| GGUF / EXL2 | ❌ | ⚠️ Partial | Not recommended for GPU benchmarking |

### Hard blocks (enforced by the portal)

| Condition | What the portal does |
|---|---|
| NVFP4 selected | Disables vLLM. Shows: *"NVFP4 is TensorRT-LLM exclusive"* |
| NVFP4 + RTX 4000 Ada | Blocks the run. Shows: *"NVFP4 requires FP4 tensor cores. Select RTX Pro 6000."* |
| SmoothQuant / W4A8 / W4A16 selected | Disables vLLM. Shows engine-exclusive notice |
| GGUF or EXL2 selected | Disables TRT-LLM. Shows: *"GGUF/EXL2 not supported by TensorRT-LLM"* |

---

## 9. Performance Metrics Captured

All metrics are produced by NVIDIA AIPerf — the same tool NVIDIA uses for official GPU spec sheets.

| Metric | Unit | Plain-English meaning |
|---|---|---|
| **Throughput** | tok/s | Total tokens generated per second across all users |
| **TTFT p50** | ms | Median time until the first word of a response appears |
| **TTFT p95 / p99** | ms | Worst-case first-token latency for 95% / 99% of requests |
| **TPOT p50** | ms/tok | How fast tokens flow after the first one (decode speed) |
| **TPOT p95** | ms/tok | Worst-case decode speed for 95% of requests |
| **End-to-end latency p50** | ms | Total time for a complete response, median |
| **End-to-end latency p99** | ms | Total time for a complete response, worst case |
| **Request throughput** | req/s | Completed requests per second |
| **GPU utilisation** | % | How hard the GPU was working during the test |
| **GPU VRAM peak** | GB | Maximum memory used — headroom for larger batches |
| **Token error rate** | % | Rate of truncated or malformed responses (optional) |

---

## 10. Report Generation

After a benchmark run completes, clicking **Generate report** produces a formatted document suitable for sharing directly with the customer.

### Report sections

1. **Executive summary** — 2–3 sentence plain-English summary suitable for a customer email or executive briefing
2. **Test configuration** — GPU, model, engine, quantisation format, and all test parameters used
3. **Headline metrics** — Throughput, TTFT p50, TPOT p50, GPU utilisation in a clear summary table
4. **Latency distribution** — P50 / P95 / P99 bar chart for TTFT and end-to-end latency
5. **Concurrency sweep** (if run) — throughput and TTFT plotted against concurrent user count
6. **Methodology note** — states results were produced using NVIDIA AIPerf, the same tooling used in NVIDIA's official GPU performance publications, making results independently verifiable
7. **Recommendations** — suggested engine, quantisation format, and configuration for the customer's production deployment

### Output formats

- **PDF** — primary format for sharing with customers
- **Markdown** — for embedding in proposals or internal documentation
- **JSON** — raw results for customers who want to import into their own tooling or dashboards

---

## 11. Phase 2 Roadmap

Features explicitly deferred from v1, in priority order:

- **Side-by-side engine comparison** — run TRT-LLM and vLLM sequentially on the same hardware and surface results in a single report. Most requested feature for comprehensive customer reports.
- **Concurrency sweep automation** — automatically benchmark at 1, 2, 4, 8, 16, 32, 64 concurrent users and plot the throughput/latency curve, showing customers the scaling behaviour of their chosen GPU.
- **Multi-GPU support** — extend hardware selection to 2× and 4× GPU configurations with tensor parallelism.
- **Historical run comparison** — compare a current run against previous runs for the same model and hardware, showing improvements over time or across configurations.
- **Scheduled runs** — queue benchmark runs to execute overnight, with results available the next morning.
- **Cost modelling** — overlay Akamai Cloud GPU pricing to show estimated cost per 1M tokens alongside performance metrics.
- **Task-specialised model recommendations** — use-case dropdown (coding / RAG / chat / reasoning / multilingual) to filter model advisor suggestions.

---

*Document version: 1.0*
*Audience: Product, engineering leads, sales engineering*
*For implementation details see: `akamai-gpu-benchmark-portal-technical.md`*
*Authors: Akamai GPU Infrastructure Team*
