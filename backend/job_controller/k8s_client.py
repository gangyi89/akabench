from __future__ import annotations

import asyncio
import os
from functools import partial
from typing import Literal

from kubernetes import client, config

JobStatus = Literal["pending", "running", "complete", "failed"]

_batch: client.BatchV1Api | None = None
_core:  client.CoreV1Api  | None = None
_NAMESPACE = os.environ.get("K8S_NAMESPACE", "default")

# Engine container name per engine type.
_ENGINE_CONTAINER = {"vllm": "vllm-server", "trtllm": "trtllm-server", "sglang": "sglang-server"}

# Restart count threshold before we declare the job failed.
CRASH_THRESHOLD = 5


def init() -> None:
    global _batch, _core
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    _batch = client.BatchV1Api()
    _core  = client.CoreV1Api()


def _create_job_sync(manifest: dict) -> None:
    _batch.create_namespaced_job(namespace=_NAMESPACE, body=manifest)


def _get_status_sync(k8s_job_name: str) -> JobStatus:
    job = _batch.read_namespaced_job_status(name=k8s_job_name, namespace=_NAMESPACE)
    s = job.status
    if s.succeeded and s.succeeded >= 1:
        return "complete"
    if s.failed and s.failed >= 1:
        return "failed"
    if s.active and s.active >= 1:
        # K8s marks a pod as active even when it's Pending (e.g. waiting for GPU).
        # Check the actual pod phase so the UI shows "pending" until the pod is
        # truly running on the node.
        pods = _core.list_namespaced_pod(
            namespace=_NAMESPACE,
            label_selector=f"job-name={k8s_job_name}",
        )
        if pods.items:
            pod = pods.items[0]
            # A pod waiting for GPU is unscheduled (node_name is None).
            # A pod that has been assigned to a node — even if still in
            # Init:CrashLoopBackOff or initialising — is actively running.
            if pod.spec.node_name:
                return "running"
        return "pending"
    return "pending"


def _get_engine_restart_count_sync(k8s_job_name: str, engine: str) -> tuple[int, str | None]:
    """Return (restart_count, pod_name) for the engine sidecar in this job's pod."""
    container_name = _ENGINE_CONTAINER.get(engine, "vllm-server")
    pods = _core.list_namespaced_pod(
        namespace=_NAMESPACE,
        label_selector=f"job-name={k8s_job_name}",
    )
    if not pods.items:
        return 0, None
    pod = pods.items[0]
    pod_name = pod.metadata.name
    for c in (pod.status.init_container_statuses or []):
        if c.name == container_name:
            return c.restart_count, pod_name
    return 0, None


def _get_pod_logs_sync(pod_name: str, container: str, tail_lines: int | None = 60) -> str:
    """Fetch the last N lines from the engine container.

    Tries the previous terminated instance first (most useful when container
    is in CrashLoopBackOff), falls back to the current running instance.
    """
    for previous in (True, False):
        try:
            logs = _core.read_namespaced_pod_log(
                name=pod_name,
                namespace=_NAMESPACE,
                container=container,
                tail_lines=tail_lines,
                previous=previous,
            )
            if logs and logs.strip():
                return logs
        except Exception:
            continue
    return "[Could not retrieve container logs]"


def _fail_job_sync(k8s_job_name: str) -> None:
    """Force a Job into a Failed state via activeDeadlineSeconds=1.

    K8s rejects 0; 1 means the deadline expires within the next second.
    The Job and its pod are preserved for ttlSecondsAfterFinished (24 h)
    so logs remain available via kubectl.
    """
    _batch.patch_namespaced_job(
        name=k8s_job_name,
        namespace=_NAMESPACE,
        body={"spec": {"activeDeadlineSeconds": 1}},
    )


async def create_job(manifest: dict) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, partial(_create_job_sync, manifest))


async def get_job_status(k8s_job_name: str) -> JobStatus:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(_get_status_sync, k8s_job_name))


async def get_engine_restart_count(k8s_job_name: str, engine: str) -> tuple[int, str | None]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, partial(_get_engine_restart_count_sync, k8s_job_name, engine)
    )


async def get_pod_logs(pod_name: str, engine: str) -> str:
    container = _ENGINE_CONTAINER.get(engine, "vllm-server")
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(_get_pod_logs_sync, pod_name, container))


async def get_container_logs(pod_name: str, container: str, tail_lines: int | None = None) -> str:
    """Fetch logs from any named container (not engine-mapped). Default: all lines."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(_get_pod_logs_sync, pod_name, container, tail_lines))


async def fail_job(k8s_job_name: str) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, partial(_fail_job_sync, k8s_job_name))
