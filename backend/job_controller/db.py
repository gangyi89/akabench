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

async def insert_job_status(
    job_id: str,
    k8s_job_name: str,
    engine: str,
    engine_image: Optional[str] = None,
    status: str = "pending",
    error: Optional[str] = None,
    completed_at: Optional[datetime] = None,
) -> None:
    await _pool.execute(
        """
        INSERT INTO job_status (job_id, k8s_job_name, engine, engine_image, status, error, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        job_id, k8s_job_name, engine, engine_image, status, error, completed_at,
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

    return BenchmarkRequest(
        job_id=str(row["job_id"]),
        submitted_by=row["submitted_by"],
        gpu_type=row["gpu_type"],
        engine=row["engine"],
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
# reports — job controller is the sole writer
# A successful job is "promoted" to a report by snapshotting its configuration
# (joined from jobs + job_status + models) into the reports table. The report
# row owns the S3 result files under `<job_id>/`; the original jobs row is
# independent from this point on.
# ---------------------------------------------------------------------------

async def insert_report(job_id: str, completed_at: datetime) -> None:
    """Snapshot a completed job into the reports table.

    Idempotent: a job already promoted to a report is skipped. This protects
    against a watcher running the completion path twice (e.g. on controller
    restart with in-flight jobs).
    """
    await _pool.execute(
        """
        INSERT INTO reports (
            job_id, submitted_by, model_id, model_name, engine, engine_image,
            quantisation, dtype, kv_cache_dtype, gpu_type,
            max_model_len, gpu_memory_util, max_batch_size,
            prefix_caching, chunked_prefill, flash_attention,
            batch_scheduler, cuda_graphs,
            concurrency, concurrency_levels,
            input_tokens_mean, output_tokens_mean, request_count,
            streaming, measurement_window, isl_distribution, backend,
            completed_at
        )
        SELECT
            j.job_id, j.submitted_by, j.model_id, m.display_name, j.engine, js.engine_image,
            j.quantisation, j.dtype, j.kv_cache_dtype, j.gpu_type,
            j.max_model_len, j.gpu_memory_util, j.max_batch_size,
            j.prefix_caching, j.chunked_prefill, j.flash_attention,
            j.batch_scheduler, j.cuda_graphs,
            j.concurrency, j.concurrency_levels,
            j.input_tokens_mean, j.output_tokens_mean, j.request_count,
            j.streaming, j.measurement_window, j.isl_distribution, j.backend,
            $2
        FROM jobs j
        LEFT JOIN job_status js ON js.job_id = j.job_id
        LEFT JOIN models     m  ON m.hf_repo_id = j.model_id
        WHERE j.job_id = $1
          AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.job_id = j.job_id)
        """,
        job_id, completed_at,
    )


async def get_report_job_id(report_id: str) -> Optional[str]:
    """Look up the job_id (= S3 prefix) for a report row."""
    row = await _pool.fetchrow(
        "SELECT job_id FROM reports WHERE report_id = $1",
        report_id,
    )
    return str(row["job_id"]) if row and row["job_id"] else None


async def delete_report(report_id: str) -> bool:
    """Remove a reports row. Returns True if a row was deleted."""
    result = await _pool.execute(
        "DELETE FROM reports WHERE report_id = $1",
        report_id,
    )
    # asyncpg returns 'DELETE <count>' — last token is the row count.
    return result.endswith(" 1")


async def delete_job(job_id: str) -> bool:
    """Remove a jobs row (cascades to job_status + job_dlq). Reports untouched."""
    result = await _pool.execute(
        "DELETE FROM jobs WHERE job_id = $1",
        job_id,
    )
    return result.endswith(" 1")


async def get_job_engine(job_id: str) -> Optional[str]:
    """Return the engine string for a job (needed to construct the K8s Job name)."""
    row = await _pool.fetchrow("SELECT engine FROM jobs WHERE job_id = $1", job_id)
    return row["engine"] if row else None


# ---------------------------------------------------------------------------
# job_dlq — job controller is the sole writer
# ---------------------------------------------------------------------------

async def insert_dlq(job_id: str, error: str) -> None:
    """Record a job that could not be submitted or failed during execution."""
    await _pool.execute(
        "INSERT INTO job_dlq (job_id, error) VALUES ($1, $2)",
        job_id, error,
    )
