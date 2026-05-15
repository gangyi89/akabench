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


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}
