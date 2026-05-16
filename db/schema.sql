-- AKAbench — database schema
-- Run once against the akabench database.
-- Owner annotations reflect which service is the sole writer of each table.

-- ---------------------------------------------------------------------------
-- models — owned by Next.js
-- Catalogue of inference-ready LLMs. Derived fields (VRAM, arch_type, tags)
-- live in the application layer.
-- See db/migrations/0001_seed_models.sql for the initial data seed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS models (
    hf_repo_id            TEXT         PRIMARY KEY,
    display_name          TEXT         NOT NULL,
    vendor                TEXT         NOT NULL,
    family                TEXT         NOT NULL,
    param_count_b         NUMERIC(6,2) NOT NULL,
    active_param_count_b  NUMERIC(6,2),                       -- NULL = dense, set = MoE
    quality_tier          TEXT         NOT NULL,              -- 7b-class | 13b-class | 70b-class
    supported_quants      TEXT[]       NOT NULL,              -- what we can serve as (native + on-the-fly)
    native_quant          TEXT         NOT NULL,              -- what the weight files actually are: bf16 | fp16 | fp8 | nvfp4 | ...
    ngc_container_tag     TEXT,                               -- NULL = no NGC NIM image
    gated                 BOOLEAN      NOT NULL DEFAULT FALSE, -- TRUE = HuggingFace approval required
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS models_vendor_idx ON models (vendor);
CREATE INDEX IF NOT EXISTS models_family_idx ON models (family);

-- ---------------------------------------------------------------------------
-- jobs — owned by Next.js
-- Full benchmark request as submitted by the user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    job_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_by        TEXT        NOT NULL,
    -- Hardware
    gpu_type            TEXT        NOT NULL,   -- rtx-4000-ada | rtx-pro-6000
    -- Engine
    engine              TEXT        NOT NULL,   -- vllm | trtllm | sglang
    -- Model
    model_id            TEXT        NOT NULL,
    quantisation        TEXT,                   -- fp16 | fp8 | awq | gptq | nvfp4 | NULL
    dtype               TEXT        NOT NULL DEFAULT 'auto',
    kv_cache_dtype      TEXT        NOT NULL DEFAULT 'auto',
    -- vLLM / TRT-LLM server params
    max_model_len       INT         NOT NULL DEFAULT 2048,
    gpu_memory_util     NUMERIC(4,3) NOT NULL DEFAULT 0.900,
    max_batch_size      INT         NOT NULL DEFAULT 64,
    prefix_caching      BOOLEAN     NOT NULL DEFAULT TRUE,
    chunked_prefill     BOOLEAN     NOT NULL DEFAULT TRUE,
    flash_attention     BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Benchmark parameters
    concurrency         INT         NOT NULL DEFAULT 16,
    input_tokens_mean   INT         NOT NULL DEFAULT 512,
    output_tokens_mean  INT         NOT NULL DEFAULT 256,
    request_count       INT         NOT NULL DEFAULT 100,
    streaming           BOOLEAN     NOT NULL DEFAULT TRUE,
    measurement_window  INT         NOT NULL DEFAULT 1800,  -- seconds; aiperf --benchmark-duration (30 min safety cap)
    isl_distribution    TEXT        NOT NULL DEFAULT 'normal-25', -- fixed|normal-10|normal-25|exponential|synthetic
    backend             TEXT        NOT NULL DEFAULT 'openai',    -- openai | triton-grpc
    -- TRT-LLM tuning
    batch_scheduler     TEXT        NOT NULL DEFAULT 'inflight', -- inflight|static
    cuda_graphs         BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Concurrency sweep (NULL = single-run, space-separated list = sweep e.g. "1 2 5 10 50 100")
    concurrency_levels  TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_submitted_by_idx ON jobs (submitted_by);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx   ON jobs (created_at DESC);

-- ---------------------------------------------------------------------------
-- job_dlq — owned by job controller
-- Populated when a job cannot be submitted to K8s or the K8s job itself fails.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_dlq (
    id          BIGSERIAL   PRIMARY KEY,
    job_id      UUID        NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    error       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_dlq_job_id_idx ON job_dlq (job_id);

-- ---------------------------------------------------------------------------
-- job_status — owned by job controller
-- Execution state written by the job controller as the K8s job progresses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_status (
    job_id          UUID        PRIMARY KEY REFERENCES jobs (job_id) ON DELETE CASCADE,
    k8s_job_name    TEXT        NOT NULL,
    engine          TEXT        NOT NULL,   -- vllm | sglang
    engine_image    TEXT,                   -- full image tag actually used (e.g. vllm/vllm-openai:v0.21.0-cu129)
    status          TEXT        NOT NULL DEFAULT 'pending',  -- pending | running | complete | failed
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS job_status_status_idx ON job_status (status);

-- ---------------------------------------------------------------------------
-- reports — owned by job controller
-- A denormalised snapshot of a successful benchmark run. Lives independently
-- of `jobs` so the two can be deleted on their own schedules:
--   delete_job  → wipes jobs + cascades to job_status/job_dlq; leaves reports
--   delete_rpt  → wipes reports row + S3 prefix; leaves jobs
-- job_id is intentionally NOT a foreign key — no cascade across the boundary.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    report_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID,                                -- snapshot, no FK
    submitted_by        TEXT         NOT NULL,
    model_id            TEXT         NOT NULL,
    model_name          TEXT,                                -- snapshot of models.display_name
    engine              TEXT         NOT NULL,
    engine_image        TEXT,
    quantisation        TEXT,
    dtype               TEXT,
    kv_cache_dtype      TEXT,
    gpu_type            TEXT         NOT NULL,
    max_model_len       INT,
    gpu_memory_util     NUMERIC(4,3),
    max_batch_size      INT,
    prefix_caching      BOOLEAN,
    chunked_prefill     BOOLEAN,
    flash_attention     BOOLEAN,
    batch_scheduler     TEXT,
    cuda_graphs         BOOLEAN,
    concurrency         INT,
    concurrency_levels  TEXT,
    input_tokens_mean   INT,
    output_tokens_mean  INT,
    request_count       INT,
    streaming           BOOLEAN,
    measurement_window  INT,
    isl_distribution    TEXT,
    backend             TEXT,
    completed_at        TIMESTAMPTZ  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_completed_at_idx ON reports (completed_at DESC);
CREATE INDEX IF NOT EXISTS reports_job_id_idx       ON reports (job_id);
