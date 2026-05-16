-- Introduce a `reports` table that owns successful benchmark artefacts
-- independently of the `jobs` row that produced them.
--
-- Lifecycle:
--   * On job completion, the controller inserts a row into `reports`
--     containing a denormalised snapshot of the job's configuration plus the
--     `engine_image` it ran with. The S3 result files continue to live under
--     the `<job_id>/` prefix.
--   * `delete_job(job_id)` removes the `jobs` row (cascading job_status and
--     job_dlq) but does NOT touch `reports` or S3.
--   * `delete_report(report_id)` removes the `reports` row and the matching
--     S3 prefix but leaves the `jobs` row alone.
--
-- `job_id` is intentionally NOT a foreign key — a deleted job must not
-- cascade into reports, and a deleted report must not cascade into jobs.

CREATE TABLE IF NOT EXISTS reports (
    report_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID,                                -- snapshot, no FK
    submitted_by        TEXT         NOT NULL,
    model_id            TEXT         NOT NULL,
    model_name          TEXT,                                -- snapshot of models.display_name
    engine              TEXT         NOT NULL,
    engine_image        TEXT,                                -- full image tag actually used
    quantisation        TEXT,
    dtype               TEXT,
    kv_cache_dtype      TEXT,
    gpu_type            TEXT         NOT NULL,
    -- Engine config snapshot
    max_model_len       INT,
    gpu_memory_util     NUMERIC(4,3),
    max_batch_size      INT,
    prefix_caching      BOOLEAN,
    chunked_prefill     BOOLEAN,
    flash_attention     BOOLEAN,
    batch_scheduler     TEXT,
    cuda_graphs         BOOLEAN,
    -- Load profile snapshot
    concurrency         INT,
    concurrency_levels  TEXT,
    input_tokens_mean   INT,
    output_tokens_mean  INT,
    request_count       INT,
    streaming           BOOLEAN,
    measurement_window  INT,
    isl_distribution    TEXT,
    backend             TEXT,
    -- Timing
    completed_at        TIMESTAMPTZ  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_completed_at_idx ON reports (completed_at DESC);
CREATE INDEX IF NOT EXISTS reports_job_id_idx       ON reports (job_id);

-- Backfill from existing completed jobs so the Reports page has data after
-- the cutover. Idempotent: skip jobs that already have a report row.
INSERT INTO reports (
    job_id, submitted_by, model_id, model_name, engine, engine_image,
    quantisation, dtype, kv_cache_dtype, gpu_type,
    max_model_len, gpu_memory_util, max_batch_size,
    prefix_caching, chunked_prefill, flash_attention,
    batch_scheduler, cuda_graphs,
    concurrency, concurrency_levels,
    input_tokens_mean, output_tokens_mean, request_count,
    streaming, measurement_window, isl_distribution, backend,
    completed_at
)
SELECT
    j.job_id, j.submitted_by, j.model_id, m.display_name, j.engine, js.engine_image,
    j.quantisation, j.dtype, j.kv_cache_dtype, j.gpu_type,
    j.max_model_len, j.gpu_memory_util, j.max_batch_size,
    j.prefix_caching, j.chunked_prefill, j.flash_attention,
    j.batch_scheduler, j.cuda_graphs,
    j.concurrency, j.concurrency_levels,
    j.input_tokens_mean, j.output_tokens_mean, j.request_count,
    j.streaming, j.measurement_window, j.isl_distribution, j.backend,
    js.completed_at
FROM jobs j
JOIN job_status js ON js.job_id = j.job_id
LEFT JOIN models   m ON m.hf_repo_id = j.model_id
WHERE js.status = 'complete'
  AND js.completed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.job_id = j.job_id);
