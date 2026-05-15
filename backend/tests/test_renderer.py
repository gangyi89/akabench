"""
Renderer parameter propagation tests.

Each test submits a BenchmarkRequest with distinctive, non-default values for
every user-controlled parameter and asserts that value appears verbatim in the
rendered K8s Job manifest.  A failure here means the renderer silently dropped
or mis-mapped a field — which would produce a benchmark run with wrong settings.
"""
from __future__ import annotations

import os
import pytest

# Point at the real template directory so tests use the actual Jinja2 files.
os.environ.setdefault("TEMPLATE_DIR", str(
    ((__import__("pathlib").Path(__file__).parent.parent) / "templates").resolve()
))
os.environ.setdefault("MODEL_CACHE_PVC", "")   # emptyDir in tests — no PVC needed

from job_controller.models import BenchmarkRequest
from job_controller.renderer import render_manifest


# ---------------------------------------------------------------------------
# Shared fixture — every field set to a distinctive non-default value so a
# missed substitution is immediately obvious.
# ---------------------------------------------------------------------------

def _req(**overrides) -> BenchmarkRequest:
    base = dict(
        job_id="test-job-123",
        submitted_by="tester",
        gpu_type="rtx-4000-ada",
        engine="vllm",
        model_id="meta-llama/Llama-3-8B-Instruct",
        quantisation="fp8",
        dtype="float16",
        kv_cache_dtype="fp8",
        max_model_len=4096,
        gpu_memory_util=0.85,
        max_batch_size=48,
        prefix_caching=True,
        chunked_prefill=True,
        flash_attention=True,
        batch_scheduler="inflight",
        cuda_graphs=True,
        concurrency=32,
        input_tokens_mean=1024,
        output_tokens_mean=512,
        request_count=200,
        streaming=True,
        measurement_window=180,
        isl_distribution="normal-25",
    )
    base.update(overrides)
    return BenchmarkRequest(**base)


# ---------------------------------------------------------------------------
# vLLM
# ---------------------------------------------------------------------------

class TestVllmRenderer:

    def _manifest(self, **overrides) -> dict:
        return render_manifest(_req(**overrides), engine="vllm")

    def _server_args(self, **overrides) -> list[str]:
        m = self._manifest(**overrides)
        init_containers = m["spec"]["template"]["spec"]["initContainers"]
        server = next(c for c in init_containers if c["name"] == "vllm-server")
        return server.get("args", [])

    def _aiperf_args(self, **overrides) -> list[str]:
        m = self._manifest(**overrides)
        containers = m["spec"]["template"]["spec"]["containers"]
        aiperf = next(c for c in containers if c["name"] == "aiperf")
        return aiperf.get("args", [])

    # --- server params ---

    def test_model_id(self):
        args = self._server_args()
        assert any("meta-llama/Llama-3-8B-Instruct" in a for a in args)

    def test_dtype(self):
        args = self._server_args()
        assert any("float16" in a for a in args)

    def test_kv_cache_dtype(self):
        args = self._server_args()
        assert any("fp8" in a for a in args)

    def test_max_model_len(self):
        args = self._server_args()
        assert any("4096" in a for a in args)

    def test_gpu_memory_utilization(self):
        args = self._server_args()
        assert any("0.85" in a for a in args)

    def test_max_num_seqs(self):
        args = self._server_args()
        assert any("48" in a for a in args)

    def test_quantization_flag_passed(self):
        # fp8 is a real quant format — --quantization should be present
        args = self._server_args(quantisation="fp8", dtype="float16")
        combined = " ".join(args)
        assert "--quantization" in combined

    def test_quantization_flag_skipped_for_fp16(self):
        # fp16/bf16 are dtype flags, not quant formats — --quantization must be absent
        args = self._server_args(quantisation="fp16", dtype="float16")
        combined = " ".join(args)
        assert "--quantization" not in combined

    def test_prefix_caching_enabled(self):
        args = self._server_args(prefix_caching=True)
        assert any("--enable-prefix-caching" in a for a in args)

    def test_prefix_caching_disabled(self):
        args = self._server_args(prefix_caching=False)
        combined = " ".join(args)
        assert "--no-enable-prefix-caching" in combined
        assert "--enable-prefix-caching" not in combined.replace("--no-enable-prefix-caching", "")

    def test_chunked_prefill_enabled(self):
        args = self._server_args(chunked_prefill=True)
        assert any("--enable-chunked-prefill" in a for a in args)

    def test_chunked_prefill_disabled(self):
        args = self._server_args(chunked_prefill=False)
        assert not any("--enable-chunked-prefill" in a for a in args)

    def test_flash_attention_disabled_sets_enforce_eager(self):
        args = self._server_args(flash_attention=False)
        assert any("--enforce-eager" in a for a in args)

    def test_flash_attention_enabled_no_enforce_eager(self):
        args = self._server_args(flash_attention=True)
        assert not any("--enforce-eager" in a for a in args)

    def test_download_dir(self):
        args = self._server_args()
        assert any("--download-dir=/models/hf-cache" in a for a in args)

    # --- load profile (aiperf container) ---

    def test_concurrency(self):
        args = self._aiperf_args()
        combined = " ".join(args)
        assert "--concurrency" in combined and "32" in combined

    def test_input_tokens_mean(self):
        args = self._aiperf_args()
        combined = " ".join(args)
        assert "--isl" in combined and "1024" in combined

    def test_output_tokens_mean(self):
        args = self._aiperf_args()
        combined = " ".join(args)
        assert "--osl" in combined and "512" in combined

    def test_request_count(self):
        args = self._aiperf_args()
        combined = " ".join(args)
        assert "--request-count" in combined and "200" in combined

    def test_streaming_enabled(self):
        args = self._aiperf_args(streaming=True)
        assert any("--streaming" in a for a in args)

    def test_streaming_disabled(self):
        args = self._aiperf_args(streaming=False)
        assert not any("--streaming" in a for a in args)

    # --- model cache volume ---

    def test_pvc_volume_when_set(self, monkeypatch):
        monkeypatch.setenv("MODEL_CACHE_PVC", "model-cache-pvc")
        import job_controller.renderer as r
        r._MODEL_CACHE_PVC = "model-cache-pvc"
        m = render_manifest(_req(), engine="vllm")
        volumes = m["spec"]["template"]["spec"]["volumes"]
        mc = next(v for v in volumes if v["name"] == "model-cache")
        assert mc["persistentVolumeClaim"]["claimName"] == "model-cache-pvc"

    def test_emptydir_volume_when_unset(self, monkeypatch):
        import job_controller.renderer as r
        r._MODEL_CACHE_PVC = None
        m = render_manifest(_req(), engine="vllm")
        volumes = m["spec"]["template"]["spec"]["volumes"]
        mc = next(v for v in volumes if v["name"] == "model-cache")
        assert "emptyDir" in mc

    # --- node selector ---

    def test_gpu_node_selector_rtx4000(self):
        m = self._manifest(gpu_type="rtx-4000-ada")
        selector = m["spec"]["template"]["spec"]["nodeSelector"]
        assert selector["nvidia.com/gpu.product"] == "NVIDIA-RTX-4000-Ada-Generation"

    def test_gpu_node_selector_rtxpro6000(self):
        m = self._manifest(gpu_type="rtx-pro-6000")
        selector = m["spec"]["template"]["spec"]["nodeSelector"]
        assert selector["nvidia.com/gpu.product"] == "NVIDIA-RTX-PRO-6000"


# ---------------------------------------------------------------------------
# TRT-LLM
# ---------------------------------------------------------------------------

class TestTrtllmRenderer:

    def _manifest(self, **overrides) -> dict:
        req = _req(engine="trtllm", **overrides)
        return render_manifest(req, engine="trtllm")

    def _build_args(self, **overrides) -> list[str]:
        m = self._manifest(**overrides)
        init_containers = m["spec"]["template"]["spec"]["initContainers"]
        build = next(c for c in init_containers if c["name"] == "trtllm-build")
        return build.get("args", [])

    def _server_args(self, **overrides) -> list[str]:
        m = self._manifest(**overrides)
        init_containers = m["spec"]["template"]["spec"]["initContainers"]
        server = next(c for c in init_containers if c["name"] == "trtllm-server")
        return server.get("args", [])

    def test_model_id_in_build(self):
        # The build script uses replace('/', '--') for filesystem paths.
        args = self._build_args()
        combined = " ".join(args)
        assert "meta-llama--Llama-3-8B-Instruct" in combined

    def test_dtype_in_build(self):
        args = self._build_args()
        combined = " ".join(args)
        assert "float16" in combined

    def test_max_batch_size_in_build(self):
        args = self._build_args()
        combined = " ".join(args)
        assert "48" in combined

    def test_max_model_len_in_build(self):
        args = self._build_args()
        combined = " ".join(args)
        assert "4096" in combined

    def test_model_id_in_server(self):
        args = self._server_args()
        combined = " ".join(args)
        assert "meta-llama/Llama-3-8B-Instruct" in combined

    def test_gpu_memory_util_in_server(self):
        args = self._server_args()
        combined = " ".join(args)
        assert "0.85" in combined

    def test_max_batch_size_in_server(self):
        args = self._server_args()
        combined = " ".join(args)
        assert "48" in combined

    def test_engine_cache_key_contains_model_quant_gpu(self):
        m = self._manifest()
        init_containers = m["spec"]["template"]["spec"]["initContainers"]
        build = next(c for c in init_containers if c["name"] == "trtllm-build")
        combined = " ".join(build.get("args", []))
        # engine_cache_key = slug__quant__dtype__gpu_type
        assert "meta-llama--Llama-3-8B-Instruct" in combined
        assert "fp8" in combined
        assert "rtx-4000-ada" in combined

    def test_pvc_volume_when_set(self, monkeypatch):
        import job_controller.renderer as r
        r._MODEL_CACHE_PVC = "model-cache-pvc"
        m = render_manifest(_req(engine="trtllm"), engine="trtllm")
        volumes = m["spec"]["template"]["spec"]["volumes"]
        mc = next(v for v in volumes if v["name"] == "model-cache")
        assert mc["persistentVolumeClaim"]["claimName"] == "model-cache-pvc"

    def test_emptydir_volume_when_unset(self, monkeypatch):
        import job_controller.renderer as r
        r._MODEL_CACHE_PVC = None
        m = render_manifest(_req(engine="trtllm"), engine="trtllm")
        volumes = m["spec"]["template"]["spec"]["volumes"]
        mc = next(v for v in volumes if v["name"] == "model-cache")
        assert "emptyDir" in mc
