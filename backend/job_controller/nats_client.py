from __future__ import annotations

import json
import os
import nats
from nats.js import JetStreamContext

_nc: nats.NATS | None = None
_js: JetStreamContext | None = None

SUBJECT_JOBS = "jobs"
SUBJECT_DLQ  = "jobs.dlq"


async def connect(url: str | None = None) -> None:
    global _nc, _js
    _nc = await nats.connect(url or os.environ["NATS_URL"])
    _js = _nc.jetstream()

    # Ensure streams exist — idempotent, no-op if already created.
    for subject, stream in [
        (SUBJECT_JOBS, "JOBS"),
        (SUBJECT_DLQ,  "JOBS_DLQ"),
    ]:
        try:
            await _js.add_stream(name=stream, subjects=[subject])
        except Exception:
            pass  # stream already exists


async def close() -> None:
    if _nc:
        await _nc.drain()


def js() -> JetStreamContext:
    assert _js is not None, "NATS not connected"
    return _js


async def publish_dlq(job_id: str, error: str) -> None:
    payload = json.dumps({"job_id": job_id, "error": error}).encode()
    await js().publish(SUBJECT_DLQ, payload)
