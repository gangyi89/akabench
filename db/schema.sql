-- AKAbench — database schema
-- Run once against the akabench database.
-- Owner annotations reflect which service is the sole writer of each table.

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
    measurement_window  INT         NOT NULL DEFAULT 120,   -- seconds; aiperf --benchmark-duration
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
    engine          TEXT        NOT NULL,   -- vllm | trtllm
    status          TEXT        NOT NULL DEFAULT 'pending',  -- pending | running | complete | failed
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS job_status_status_idx ON job_status (status);
