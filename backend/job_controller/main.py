from __future__ import annotations

import asyncio
import logging
import os
import signal
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import uvicorn

from . import db, k8s_client, nats_client, scheduler
from .collector_api import app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
log = logging.getLogger(__name__)

HTTP_HOST = os.environ.get("HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))


async def main() -> None:
    # Initialise all dependencies
    k8s_client.init()
    await db.init()
    await nats_client.connect()

    # Recover any jobs that were in-flight before a restart
    await scheduler.recover()

    # Subscribe to the requests subject
    await scheduler.subscribe()

    # Run the FastAPI HTTP server in the background (for results-collector callbacks)
    config = uvicorn.Config(app=app, host=HTTP_HOST, port=HTTP_PORT, log_level="warning")
    server = uvicorn.Server(config)

    loop = asyncio.get_running_loop()

    def _shutdown(*_):
        log.info("Shutdown signal received.")
        server.should_exit = True

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _shutdown)

    log.info("Job controller running — HTTP on %s:%d", HTTP_HOST, HTTP_PORT)
    await server.serve()

    # Cleanup
    await nats_client.close()
    await db.close()
    log.info("Job controller stopped.")


if __name__ == "__main__":
    asyncio.run(main())
