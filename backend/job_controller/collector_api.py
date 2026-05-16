from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

from . import scheduler
from .models import CollectorPayload

log = logging.getLogger(__name__)

app = FastAPI(title="AKAbench Job Controller", docs_url=None, redoc_url=None)


@app.post("/jobs/{job_id}/results")
async def receive_results(job_id: str, payload: CollectorPayload) -> Response:
    """
    Called by the results-collector container inside the benchmark Pod once
    GenAI-Perf finishes. Stashes the metrics so the watch_job coroutine can
    include them when it publishes to NATS.
    """
    if payload.job_id != job_id:
        raise HTTPException(status_code=400, detail="job_id mismatch")

    log.info("Received results from collector for job %s", job_id)
    scheduler.pending_metrics[job_id] = payload.metrics
    return Response(status_code=204)


@app.delete("/jobs/{job_id}", status_code=200)
async def delete_job(job_id: str) -> dict:
    """Delete a job everywhere it lives — DB rows, K8s Job, watcher state.
    Reports + S3 are untouched. Idempotent."""
    return await scheduler.delete_job_cascade(job_id)


@app.delete("/reports/{report_id}", status_code=200)
async def delete_report(report_id: str) -> dict:
    """Delete a report row and its S3 artefacts. Jobs row is untouched."""
    return await scheduler.delete_report_cascade(report_id)


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}
