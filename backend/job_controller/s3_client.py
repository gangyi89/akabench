from __future__ import annotations

import asyncio
import logging
import os
from functools import partial

log = logging.getLogger(__name__)

_client = None


def _init() -> None:
    global _client
    import boto3  # imported lazily so the module loads even if boto3 is absent in dev
    from botocore.config import Config

    ep, ak, sk, bucket = (
        os.environ.get(k)
        for k in ("S3_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET")
    )
    if not all([ep, ak, sk, bucket]):
        log.warning("S3 not fully configured — log uploads will be skipped")
        return
    _client = boto3.client(
        "s3",
        endpoint_url=ep,
        aws_access_key_id=ak,
        aws_secret_access_key=sk,
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            # Linode Object Storage does not support the aws-chunked
            # Transfer-Encoding + CRC32 trailer that newer botocore sends
            # by default — disable it so plain PutObject requests are used.
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


_init()


def _put(content: str, key: str) -> None:
    _client.put_object(
        Bucket=os.environ["S3_BUCKET"],
        Key=key,
        Body=content.encode("utf-8"),
        ContentType="text/plain",
    )
    log.info("Uploaded s3://%s/%s", os.environ["S3_BUCKET"], key)


async def upload_text(content: str, key: str) -> None:
    """Upload plain text to S3. Silently skips if S3 is not configured."""
    if not _client:
        return
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, partial(_put, content, key))
    except Exception as exc:
        log.warning("Log upload failed for %s: %s", key, exc)
