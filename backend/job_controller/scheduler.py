from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from . import db, k8s_client, nats_client, s3_client
from .models import BenchmarkRequest
from .renderer import render_manifest, engine_image_for

log = logging.getLogger(__name__)

POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "15"))

# In-memory map of job_id → BenchmarkRequest for jobs currently being watched.
# Repopulated from DB on startup.
_active: dict[str, BenchmarkRequest] = {}

# Holds a reference to each watch task so they aren't garbage-collected.
_tasks: dict[str, asyncio.Task] = {}


async def recover() -> None:
    """On startup, re-spawn watch tasks for any jobs that were in-flight."""
    rows = await db.get_active_jobs()
    if not rows:
        return
    log.info("Recovering %d in-flight job(s) from DB.", len(rows))
    for row in rows:
        # job_status has enough to watch the K8s job and publish a result.
        # Full job definition (model_id, gpu_type, etc.) lives in jobs — owned by Next.js.
        req = BenchmarkRequest(
            job_id=str(row["job_id"]),
            engine=row["engine"],
        )
        _spawn_watcher(req, row["k8s_job_name"])


async def handle_request(msg) -> None:
    """NATS message handler — called for each message on the 'jobs' subject.

    NATS carries only the job_id. All benchmark parameters are read from
    Postgres, which is the single source of truth.
    """
    try:
        data = json.loads(msg.data.decode())
        job_id = data["job_id"]
    except Exception as exc:
        log.error("Failed to parse NATS message: %s", exc)
        await msg.ack()
        return

    try:
        req = await db.get_job(job_id)
    except Exception as exc:
        error_msg = f"Failed to load job from DB: {exc}"
        log.error("Failed to load job %s from DB: %s", job_id, exc)
        await db.insert_dlq(job_id, error_msg)
        await nats_client.publish_dlq(job_id, error_msg)
        await msg.ack()
        return

    log.info("Received benchmark request job_id=%s model=%s gpu=%s",
             req.job_id, req.model_id, req.gpu_type)

    k8s_job_name = f"benchmark-{req.job_id}-{req.engine}"

    try:
        manifest = render_manifest(req, engine=req.engine)
        log.info(
            "Rendering manifest job_id=%s | "
            "model=%s engine=%s gpu=%s quant=%s dtype=%s | "
            "concurrency=%s isl=%s osl=%s requests=%s streaming=%s | "
            "max_model_len=%s max_batch=%s gpu_mem_util=%s kv_cache_dtype=%s | "
            "prefix_caching=%s chunked_prefill=%s flash_attn=%s | "
            "isl_distribution=%s measurement_window=%s",
            req.job_id,
            req.model_id, req.engine, req.gpu_type, req.quantisation, req.dtype,
            req.concurrency, req.input_tokens_mean, req.output_tokens_mean,
            req.request_count, req.streaming,
            req.max_model_len, req.max_batch_size, req.gpu_memory_util, req.kv_cache_dtype,
            req.prefix_caching, req.chunked_prefill, req.flash_attention,
            req.isl_distribution, req.measurement_window,
        )
        await k8s_client.create_job(manifest)
        await db.insert_job_status(
            job_id=req.job_id,
            k8s_job_name=k8s_job_name,
            engine=req.engine,
            engine_image=engine_image_for(req.engine),
        )
        log.info("Submitted K8s Job %s", k8s_job_name)
    except Exception as exc:
        error_msg = f"Failed to submit K8s job: {exc}"
        log.error("Failed to submit job %s: %s", req.job_id, exc)
        await db.insert_job_status(
            job_id=req.job_id,
            k8s_job_name=k8s_job_name,
            engine=req.engine,
            engine_image=engine_image_for(req.engine),
            status="failed",
            error=error_msg,
            completed_at=datetime.now(tz=timezone.utc),
        )
        await db.insert_dlq(req.job_id, error_msg)
        await nats_client.publish_dlq(req.job_id, error_msg)
        await msg.ack()
        return

    _spawn_watcher(req, k8s_job_name)
    await msg.ack()


async def _upload_job_logs(job_id: str, engine: str, pod_name: str) -> None:
    """Fetch full logs from the engine and aiperf containers and upload to S3."""
    engine_container = k8s_client._ENGINE_CONTAINER.get(engine, "vllm-server")
    for container, key in [
        (engine_container, f"{job_id}/engine.log"),
        ("aiperf", f"{job_id}/aiperf.log"),
    ]:
        try:
            logs = await k8s_client.get_container_logs(pod_name, container)
        except Exception as exc:
            logs = f"[Log fetch failed: {exc}]"
        await s3_client.upload_text(logs, key)


def _spawn_watcher(req: BenchmarkRequest, k8s_job_name: str) -> None:
    _active[req.job_id] = req
    task = asyncio.create_task(_watch_job(req, k8s_job_name))
    _tasks[req.job_id] = task
    task.add_done_callback(lambda _: _tasks.pop(req.job_id, None))


async def _watch_job(req: BenchmarkRequest, k8s_job_name: str) -> None:
    """Poll K8s until the job reaches a terminal state, then publish to NATS."""
    log.info("Watching job %s (K8s: %s)", req.job_id, k8s_job_name)

    while True:
        await asyncio.sleep(POLL_INTERVAL)

        # ── Crash detection ──────────────────────────────────────────────────
        # Check engine container restart count independently of Job-level status.
        # CrashLoopBackOff keeps the pod in Running state (from the Job's view)
        # indefinitely — the Job-level failed state is never reached on its own.
        try:
            restart_count, pod_name = await k8s_client.get_engine_restart_count(
                k8s_job_name, req.engine
            )
        except Exception as exc:
            log.warning("Could not check restart count for %s: %s", k8s_job_name, exc)
            restart_count, pod_name = 0, None

        if restart_count >= k8s_client.CRASH_THRESHOLD:
            log.error(
                "Job %s engine container crashed %d times — fetching logs and terminating.",
                req.job_id, restart_count,
            )
            # Fetch logs before patching so they're preserved even if the pod
            # is evicted shortly after activeDeadlineSeconds kicks in.
            logs = ""
            if pod_name:
                try:
                    logs = await k8s_client.get_pod_logs(pod_name, req.engine)
                except Exception as exc:
                    logs = f"[Log fetch failed: {exc}]"

            error_msg = (
                f"Engine container crashed {restart_count} times (CrashLoopBackOff).\n\n"
                f"Last 60 lines of {req.engine}-server logs:\n\n{logs}"
            )

            completed_at = datetime.now(tz=timezone.utc)
            await db.update_status(req.job_id, "failed", error=error_msg, completed_at=completed_at)
            await db.insert_dlq(req.job_id, error_msg)
            await nats_client.publish_dlq(req.job_id, error_msg)
            if pod_name:
                await _upload_job_logs(req.job_id, req.engine, pod_name)

            try:
                await k8s_client.fail_job(k8s_job_name)
                log.info("Patched Job %s with activeDeadlineSeconds=1.", k8s_job_name)
            except Exception as exc:
                log.warning("Could not patch Job %s to fail: %s", k8s_job_name, exc)

            _active.pop(req.job_id, None)
            return

        # ── Normal Job-level status poll ─────────────────────────────────────
        try:
            status = await k8s_client.get_job_status(k8s_job_name)
        except Exception as exc:
            log.warning("Could not poll K8s status for %s: %s — retrying", k8s_job_name, exc)
            continue

        if status == "running":
            await db.update_status(req.job_id, "running")
            continue

        if status == "pending":
            continue

        # Terminal — complete or failed
        completed_at = datetime.now(tz=timezone.utc)

        if status == "complete":
            await db.update_status(req.job_id, "complete", completed_at=completed_at)
            if pod_name:
                await _upload_job_logs(req.job_id, req.engine, pod_name)
            log.info("Job %s complete.", req.job_id)
        else:
            # Job failed for a reason other than CrashLoopBackOff — try to
            # capture logs anyway for diagnosis.
            logs = ""
            if pod_name:
                try:
                    logs = await k8s_client.get_pod_logs(pod_name, req.engine)
                except Exception:
                    pass
            error_msg = (
                "K8s Job failed.\n\n"
                + (f"Last 60 lines of {req.engine}-server logs:\n\n{logs}" if logs
                   else "No logs available.")
            )
            await db.update_status(req.job_id, "failed", error=error_msg, completed_at=completed_at)
            await db.insert_dlq(req.job_id, error_msg)
            await nats_client.publish_dlq(req.job_id, error_msg)
            if pod_name:
                await _upload_job_logs(req.job_id, req.engine, pod_name)
            log.error("Job %s failed.", req.job_id)

        _active.pop(req.job_id, None)
        return


async def subscribe() -> None:
    """Subscribe to NATS 'jobs' as a push consumer with a durable name."""
    js = nats_client.js()
    await js.subscribe(
        nats_client.SUBJECT_JOBS,
        durable="job-controller",
        cb=handle_request,
        manual_ack=True,
    )
    log.info("Subscribed to NATS subject '%s'.", nats_client.SUBJECT_JOBS)
