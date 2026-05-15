from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


_ALLOWED_GPU_TYPES      = {"rtx-4000-ada", "rtx-pro-6000"}
_ALLOWED_QUANT_TYPES    = {"fp16", "bf16", "fp8", "nvfp4", "int4_awq", "smoothquant", "w4a8", "w4a16", None}
_ALLOWED_ENGINES        = {"vllm", "sglang"}
_ALLOWED_DTYPES         = {"auto", "float16", "bfloat16"}
_ALLOWED_KV_DTYPES      = {"auto", "fp8", "int8", "fp16"}
_ALLOWED_ISL_DIST       = {"fixed", "normal-10", "normal-25", "exponential", "synthetic"}
_ALLOWED_BACKENDS       = {"openai", "triton-grpc"}


class BenchmarkRequest(BaseModel):
    """Consumed from NATS subject: jobs"""
    job_id: str
    submitted_by: str = ""
    # Hardware
    gpu_type: str = ""                          # rtx-4000-ada | rtx-pro-6000
    # Engine
    engine: Literal["vllm", "sglang"] = "vllm"
    # Model
    model_id: str = ""
    quantisation: Optional[str] = None         # fp16 | fp8 | awq | gptq | nvfp4 | None
    dtype: str = "auto"                         # derived from quantisation by Next.js
    # Engine server params
    kv_cache_dtype: str = "auto"               # auto | fp8 | int8
    max_model_len: int = Field(default=2048, ge=512, le=131072)
    gpu_memory_util: float = Field(default=0.90, ge=0.1, le=1.0)
    max_batch_size: int = Field(default=64, ge=1, le=1024)
    prefix_caching: bool = True
    chunked_prefill: bool = True
    flash_attention: bool = True
    # Benchmark parameters
    concurrency: int = Field(default=16, ge=1, le=1000)
    concurrency_levels: list[int] = []         # empty = single-run; non-empty = sweep
    input_tokens_mean: int = Field(default=512, ge=1, le=32768)
    output_tokens_mean: int = Field(default=256, ge=1, le=32768)
    request_count: int = Field(default=100, ge=1, le=100000)
    streaming: bool = True
    measurement_window: int = Field(default=1800, ge=10, le=3600)  # seconds
    isl_distribution: str = "normal-25"        # fixed|normal-10|normal-25|exponential|synthetic
    backend: str = "openai"                    # openai | triton-grpc

    @field_validator("gpu_type")
    @classmethod
    def _check_gpu_type(cls, v: str) -> str:
        if v not in _ALLOWED_GPU_TYPES:
            raise ValueError(f"gpu_type must be one of {_ALLOWED_GPU_TYPES}")
        return v

    @field_validator("quantisation")
    @classmethod
    def _check_quantisation(cls, v: Optional[str]) -> Optional[str]:
        if v not in _ALLOWED_QUANT_TYPES:
            raise ValueError(f"quantisation must be one of {_ALLOWED_QUANT_TYPES}")
        return v

    @field_validator("dtype")
    @classmethod
    def _check_dtype(cls, v: str) -> str:
        if v not in _ALLOWED_DTYPES:
            raise ValueError(f"dtype must be one of {_ALLOWED_DTYPES}")
        return v

    @field_validator("kv_cache_dtype")
    @classmethod
    def _check_kv_cache_dtype(cls, v: str) -> str:
        if v not in _ALLOWED_KV_DTYPES:
            raise ValueError(f"kv_cache_dtype must be one of {_ALLOWED_KV_DTYPES}")
        return v

    @field_validator("isl_distribution")
    @classmethod
    def _check_isl_distribution(cls, v: str) -> str:
        if v not in _ALLOWED_ISL_DIST:
            raise ValueError(f"isl_distribution must be one of {_ALLOWED_ISL_DIST}")
        return v

    @field_validator("backend")
    @classmethod
    def _check_backend(cls, v: str) -> str:
        if v not in _ALLOWED_BACKENDS:
            raise ValueError(f"backend must be one of {_ALLOWED_BACKENDS}")
        return v

    @field_validator("concurrency_levels")
    @classmethod
    def _check_concurrency_levels(cls, v: list[int]) -> list[int]:
        if len(v) > 20:
            raise ValueError("concurrency_levels may not have more than 20 entries")
        for level in v:
            if not (1 <= level <= 1000):
                raise ValueError("each concurrency level must be between 1 and 1000")
        return v

    @field_validator("submitted_by")
    @classmethod
    def _sanitize_submitted_by(cls, v: str) -> str:
        return v.strip()[:128]


class CollectorPayload(BaseModel):
    """POSTed by the results-collector container to /jobs/{job_id}/results"""
    job_id: str
    metrics: dict                               # aiperf output.json
    raw_results_path: str = ""                  # path on PVC, best-effort


class BenchmarkResult(BaseModel):
    """Published to NATS subject: results"""
    job_id: str
    model_id: str
    gpu_type: str
    engine: str = "vllm"
    status: str                                 # complete | failed
    error: Optional[str] = None
    metrics: Optional[dict] = None
    completed_at: datetime = Field(default_factory=datetime.utcnow)
