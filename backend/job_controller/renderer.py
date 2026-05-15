from __future__ import annotations

import os
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader

from .models import BenchmarkRequest

_TEMPLATE_DIR = Path(os.environ.get("TEMPLATE_DIR", "/app/templates"))

_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)))

TEMPLATE_MAP = {
    "vllm":   "benchmark-job-vllm.yaml",
    "sglang": "benchmark-job-sglang.yaml",
}

# ── Engine images ────────────────────────────────────────────────────────────
# v0.21.0 ships a recent enough transformers to handle Gemma 4 and Qwen 3.5
# natively — the previous per-model gemma4 override is no longer needed.
_VLLM_IMAGE_DEFAULT = "vllm/vllm-openai:v0.21.0-cu129"
_SGLANG_IMAGE_DEFAULT = "lmsysorg/sglang:v0.5.11-cu129"

_ENGINE_IMAGES: dict[str, str] = {
    "vllm":   _VLLM_IMAGE_DEFAULT,
    "sglang": _SGLANG_IMAGE_DEFAULT,
}


def engine_image_for(engine: str) -> str | None:
    """Return the image tag the renderer will inject for the given engine."""
    return _ENGINE_IMAGES.get(engine)


# ── Quant name translation ────────────────────────────────────────────────────
# Internal catalogue names → vLLM --quantization values.
# fp16/bf16 are omitted intentionally — the template skips --quantization for those.
_VLLM_QUANT_MAP: dict[str, str] = {
    "fp8":        "fp8",
    "nvfp4":      "fp8",        # blocked by compat rules; fallback is a no-op
}

# ── Backend-derived values ────────────────────────────────────────────────────

# model_cache_pvc: None = emptyDir (dev), set to PVC name in prod.
_MODEL_CACHE_PVC: str | None = os.environ.get("MODEL_CACHE_PVC")

# Namespace where benchmark Jobs are submitted. Must match k8s_client._NAMESPACE
# or the API server rejects the request with HTTP 400.
_NAMESPACE: str = os.environ.get("K8S_NAMESPACE", "default")

# K8s memory budgets per GPU type (engine container request/limit).
_GPU_MEMORY: dict[str, dict[str, str]] = {
    "rtx-4000-ada":  {"request": "8Gi",  "limit": "24Gi"},
    "rtx-pro-6000":  {"request": "24Gi", "limit": "104Gi"},
}
_MEMORY_DEFAULT = {"request": "8Gi", "limit": "24Gi"}

# ISL distribution → input_tokens_stddev as a fraction of input_tokens_mean.
_ISL_STDDEV_FRACTION: dict[str, float] = {
    "fixed":       0.00,
    "normal-10":   0.10,
    "normal-25":   0.25,
    "exponential": 0.50,
    "synthetic":   0.00,   # genai-perf uses its own synthetic dataset
}


def _derive_memory(gpu_type: str) -> dict[str, str]:
    return _GPU_MEMORY.get(gpu_type, _MEMORY_DEFAULT)


def render_manifest(req: BenchmarkRequest, engine: str = "vllm") -> dict:
    """Render the Jinja2 Job template and return a parsed dict ready for the K8s API."""
    template = _env.get_template(TEMPLATE_MAP[engine])

    mem = _derive_memory(req.gpu_type)

    # input_tokens_stddev: derived from isl_distribution + input_tokens_mean.
    stddev_fraction = _ISL_STDDEV_FRACTION.get(req.isl_distribution, 0.25)
    input_tokens_stddev = int(req.input_tokens_mean * stddev_fraction)

    # max_seq_len: total context window needed during engine build.
    max_seq_len = req.max_model_len + req.output_tokens_mean

    vllm_quantisation = _VLLM_QUANT_MAP.get(req.quantisation or "", req.quantisation)

    rendered = template.render(
        # Container images
        vllm_image=_VLLM_IMAGE_DEFAULT,
        sglang_image=_SGLANG_IMAGE_DEFAULT,
        # Identity
        job_id=req.job_id,
        submitted_by=req.submitted_by,
        gpu_type=req.gpu_type,
        engine=req.engine,
        model_id=req.model_id,
        quantisation=vllm_quantisation,      # translated for vLLM --quantization flag
        raw_quantisation=req.quantisation,   # original catalogue value (used in annotations)
        # Model dtype (derived by Next.js from quantisation)
        dtype=req.dtype,
        # Engine server params
        kv_cache_dtype=req.kv_cache_dtype,
        max_model_len=req.max_model_len,
        gpu_memory_util=req.gpu_memory_util,
        max_batch_size=req.max_batch_size,
        prefix_caching=req.prefix_caching,
        chunked_prefill=req.chunked_prefill,
        flash_attention=req.flash_attention,
        # Benchmark params
        concurrency=req.concurrency,
        is_sweep=bool(req.concurrency_levels),
        sweep_levels=" ".join(str(c) for c in req.concurrency_levels) if req.concurrency_levels else "",
        input_tokens_mean=req.input_tokens_mean,
        output_tokens_mean=req.output_tokens_mean,
        request_count=req.request_count,
        streaming=req.streaming,
        backend=req.backend,
        duration_seconds=req.measurement_window,
        # Derived in renderer — not user-submitted
        input_tokens_stddev=input_tokens_stddev,
        num_prompts=req.request_count,
        max_seq_len=max_seq_len,
        memory_request=mem["request"],
        memory_limit=mem["limit"],
        model_cache_pvc=_MODEL_CACHE_PVC,
        namespace=_NAMESPACE,
    )
    return yaml.safe_load(rendered)
