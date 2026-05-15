from __future__ import annotations

import os
import asyncpg
from datetime import datetime
from typing import Optional

_pool: asyncpg.Pool | None = None


async def init(dsn: str | None = None) -> None:
    global _pool
    _pool = await asyncpg.create_pool(dsn or os.environ["DATABASE_URL"], min_size=2, max_size=5)


async def close() -> None:
    if _pool:
        await _pool.close()


# ---------------------------------------------------------------------------
# job_status — job controller is the sole writer
# ---------------------------------------------------------------------------

async def insert_job_status(job_id: str, k8s_job_name: str, engine: str) -> None:
    await _pool.execute(
        """
        INSERT INTO job_status (job_id, k8s_job_name, engine, status)
        VALUES ($1, $2, $3, 'pending')
        """,
        job_id, k8s_job_name, engine,
    )


async def update_status(
    job_id: str,
    status: str,
    error: Optional[str] = None,
    completed_at: Optional[datetime] = None,
) -> None:
    await _pool.execute(
        """
        UPDATE job_status
        SET status = $2,
            error = $3,
            completed_at = $4
        WHERE job_id = $1
        """,
        job_id, status, error, completed_at,
    )


async def get_active_jobs() -> list[asyncpg.Record]:
    """Return all rows not yet in a terminal state — used for restart recovery."""
    return await _pool.fetch(
        "SELECT * FROM job_status WHERE status IN ('pending', 'running') ORDER BY created_at"
    )


# ---------------------------------------------------------------------------
# jobs — job controller is a reader only
# ---------------------------------------------------------------------------

async def get_job(job_id: str) -> "BenchmarkRequest":
    """Read the full job definition from Postgres and return a BenchmarkRequest.

    Postgres is the single source of truth for all benchmark parameters.
    The NATS message carries only the job_id — this is how the controller
    retrieves everything it needs to render the K8s manifest.
    """
    from .models import BenchmarkRequest  # local import avoids circular dep

    row = await _pool.fetchrow("SELECT * FROM jobs WHERE job_id = $1", job_id)
    if row is None:
        raise ValueError(f"Job {job_id!r} not found in jobs table")

    # The jobs table stores the frontend engine string ('trt-llm').
    # BenchmarkRequest expects the backend normalised form ('trtllm').
    engine = "trtllm" if row["engine"] == "trt-llm" else row["engine"]

    return BenchmarkRequest(
        job_id=str(row["job_id"]),
        submitted_by=row["submitted_by"],
        gpu_type=row["gpu_type"],
        engine=engine,
        model_id=row["model_id"],
        quantisation=row["quantisation"],
        dtype=row["dtype"],
        kv_cache_dtype=row["kv_cache_dtype"],
        max_model_len=row["max_model_len"],
        gpu_memory_util=float(row["gpu_memory_util"]),
        max_batch_size=row["max_batch_size"],
        prefix_caching=row["prefix_caching"],
        chunked_prefill=row["chunked_prefill"],
        flash_attention=row["flash_attention"],
        batch_scheduler=row["batch_scheduler"],
        cuda_graphs=row["cuda_graphs"],
        concurrency=row["concurrency"],
        concurrency_levels=[int(v) for v in row["concurrency_levels"].split()] if row["concurrency_levels"] else [],
        input_tokens_mean=row["input_tokens_mean"],
        output_tokens_mean=row["output_tokens_mean"],
        request_count=row["request_count"],
        streaming=row["streaming"],
        measurement_window=row["measurement_window"],
        isl_distribution=row["isl_distribution"],
        backend=row.get("backend", "openai"),
    )


# ---------------------------------------------------------------------------
# job_dlq — job controller is the sole writer
# ---------------------------------------------------------------------------

async def insert_dlq(job_id: str, error: str) -> None:
    """Record a job that could not be submitted or failed during execution."""
    await _pool.execute(
        "INSERT INTO job_dlq (job_id, error) VALUES ($1, $2)",
        job_id, error,
    )
