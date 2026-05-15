-- Capture the engine container image (e.g. vllm/vllm-openai:v0.21.0-cu129) used
-- to run each job, so reports can show the exact engine version even after the
-- pinned default in renderer.py is bumped.
--
-- Nullable: rows written before this migration won't have a value.

ALTER TABLE job_status
    ADD COLUMN IF NOT EXISTS engine_image TEXT;
