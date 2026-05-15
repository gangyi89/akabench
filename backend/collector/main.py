#!/usr/bin/env python3
"""
Results collector — runs inside the benchmark Pod as the results-collector container.

Waits for the coordination signal written by genai-perf, reads the profile_export.json,
and POSTs the metrics to the job controller's HTTP endpoint.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
log = logging.getLogger(__name__)

JOB_ID            = os.environ["JOB_ID"]
API_ENDPOINT      = os.environ["API_ENDPOINT"]   # http://job-controller:8080/jobs/{job_id}/results
RESULTS_DIR       = Path(os.environ.get("RESULTS_DIR", "/results/genai-perf"))
COORDINATION_FILE = Path(os.environ.get("COORDINATION_FILE", "/coordination/benchmark_complete"))
POLL_INTERVAL     = int(os.environ.get("POLL_INTERVAL_SECONDS", "3"))


def wait_for_signal() -> None:
    log.info("Waiting for benchmark_complete signal at %s ...", COORDINATION_FILE)
    while not COORDINATION_FILE.exists():
        time.sleep(POLL_INTERVAL)
    log.info("Signal received.")


def read_metrics() -> dict:
    # aiperf writes to a subdirectory named after the model + concurrency,
    # e.g. artifacts/TinyLlama_TinyLlama-1.1B-Chat-v1.0-openai-chat-concurrency10/output.json
    matches = list(RESULTS_DIR.glob("*/output.json"))
    if not matches:
        log.warning("output.json not found under %s — uploading empty metrics.", RESULTS_DIR)
        return {}
    profile = matches[0]
    log.info("Reading results from %s", profile)
    with profile.open() as f:
        return json.load(f)


def post_results(metrics: dict) -> None:
    payload = {
        "job_id": JOB_ID,
        "metrics": metrics,
        "raw_results_path": str(RESULTS_DIR / "profile_export.json"),
    }
    log.info("Posting results to %s ...", API_ENDPOINT)
    with httpx.Client(timeout=30) as client:
        resp = client.post(API_ENDPOINT, json=payload)
        resp.raise_for_status()
    log.info("Results uploaded successfully.")


def main() -> None:
    wait_for_signal()
    metrics = read_metrics()
    post_results(metrics)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log.error("Collector failed: %s", exc)
        sys.exit(1)
