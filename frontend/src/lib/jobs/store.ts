import { sql } from '@/lib/db'
import { getGpu } from '@/lib/catalogue/db'
import type { Job, JobDetail, JobSubmitRequest, ReportListItem, EngineType, QuantType } from '@/lib/catalogue/types'

export async function insertJob(job: Job, params: JobSubmitRequest, dtype: string): Promise<void> {
  // concurrency_levels stored as space-separated string (easy bash loop in K8s template)
  const concurrencyLevels = params.concurrencyLevels && params.concurrencyLevels.length > 0
    ? params.concurrencyLevels.join(' ')
    : null
  // For sweep jobs use the first (lowest) level as the scalar concurrency value
  const concurrency = params.concurrencyLevels && params.concurrencyLevels.length > 0
    ? params.concurrencyLevels[0]
    : (params.concurrency ?? 16)

  await sql`
    INSERT INTO jobs (
      job_id, submitted_by, gpu_type, engine, model_id, quantisation,
      dtype, kv_cache_dtype,
      concurrency, concurrency_levels, input_tokens_mean, output_tokens_mean, request_count, streaming,
      measurement_window, isl_distribution, backend,
      max_model_len, gpu_memory_util, max_batch_size,
      prefix_caching, chunked_prefill, flash_attention,
      batch_scheduler, cuda_graphs
    ) VALUES (
      ${job.id}, ${job.submittedBy}, ${job.gpuId}, ${job.engine}, ${job.modelId},
      ${job.quantisation ?? null},
      ${dtype},
      ${params.kvCacheDtype     ?? 'auto'},
      ${concurrency}, ${concurrencyLevels},
      ${params.inputTokensMean  ?? 512},
      ${params.outputTokensMean ?? 256}, ${params.requestCount     ?? 100},
      ${params.streaming        ?? true},
      ${params.measurementWindow ?? 300}, ${params.islDistribution ?? 'normal-25'}, ${params.backend ?? 'openai'},
      ${params.maxModelLen       ?? 2048}, ${params.gpuMemoryUtil  ?? 0.90},
      ${params.maxBatchSize      ?? 64},
      ${params.prefixCaching     ?? true}, ${params.chunkedPrefill ?? true},
      ${params.flashAttention    ?? true},
      ${params.batchScheduler    ?? 'inflight'}, ${params.cudaGraphs ?? true}
    )
  `
}

type JobRow = {
  id: string
  modelId: string
  modelName: string | null
  engine: string
  quantisation: string | null
  gpuId: string
  submittedBy: string
  submittedAt: Date
  status: string
  error: string | null
  completedAt: Date | null
  concurrencyLevels: string | null
}

function rowToJob(row: JobRow): Job {
  const gpu = getGpu(row.gpuId)
  return {
    id:                row.id,
    modelId:           row.modelId,
    modelName:         row.modelName ?? row.modelId.split('/').pop() ?? row.modelId,
    engine:            row.engine as Job['engine'],
    quantisation:      row.quantisation as Job['quantisation'],
    gpuId:             row.gpuId,
    gpuName:           gpu?.name ?? row.gpuId,
    submittedBy:       row.submittedBy,
    submittedAt:       row.submittedAt.toISOString(),
    status:            row.status as Job['status'],
    error:             row.error,
    completedAt:       row.completedAt?.toISOString() ?? null,
    concurrencyLevels: row.concurrencyLevels ? row.concurrencyLevels.split(' ').map(Number) : null,
  }
}

// Built lazily — invoking sql`...` at module scope eagerly resolves the DB
// proxy in lib/db.ts, which throws during `next build` when DATABASE_URL
// isn't set.
const jobSelect = () => sql`
  SELECT
    j.job_id              AS id,
    j.model_id            AS "modelId",
    m.display_name        AS "modelName",
    j.engine,
    j.quantisation,
    j.gpu_type            AS "gpuId",
    j.submitted_by        AS "submittedBy",
    j.created_at          AS "submittedAt",
    j.concurrency_levels  AS "concurrencyLevels",
    COALESCE(js.status, 'queued') AS status,
    js.error,
    js.completed_at       AS "completedAt"
  FROM jobs j
  LEFT JOIN job_status js ON js.job_id = j.job_id
  LEFT JOIN models     m  ON m.hf_repo_id = j.model_id
`

export async function getJob(id: string): Promise<Job | null> {
  const rows = await sql<JobRow[]>`
    ${jobSelect()} WHERE j.job_id = ${id}
  `
  return rows[0] ? rowToJob(rows[0]) : null
}

export async function listJobs(): Promise<Job[]> {
  const rows = await sql<JobRow[]>`
    ${jobSelect()} ORDER BY j.created_at DESC
  `
  return rows.map(rowToJob)
}

type JobDetailRow = JobRow & {
  engineImage: string | null
  dtype: string
  kvCacheDtype: string
  maxModelLen: number
  gpuMemoryUtil: number
  maxBatchSize: number
  prefixCaching: boolean
  chunkedPrefill: boolean
  flashAttention: boolean
  batchScheduler: string
  cudaGraphs: boolean
  concurrency: number
  concurrencyLevels: string | null
  inputTokensMean: number
  outputTokensMean: number
  requestCount: number
  streaming: boolean
  measurementWindow: number
  islDistribution: string
  backend: string
}

function rowToJobDetail(row: JobDetailRow): JobDetail {
  // concurrency_levels stored as space-separated string, parse back to number[]
  const concurrencyLevels = row.concurrencyLevels
    ? row.concurrencyLevels.split(' ').map(Number)
    : null
  return {
    ...rowToJob(row),
    engineImage: row.engineImage,
    dtype: row.dtype,
    kvCacheDtype: row.kvCacheDtype,
    maxModelLen: row.maxModelLen,
    gpuMemoryUtil: row.gpuMemoryUtil,
    maxBatchSize: row.maxBatchSize,
    prefixCaching: row.prefixCaching,
    chunkedPrefill: row.chunkedPrefill,
    flashAttention: row.flashAttention,
    batchScheduler: row.batchScheduler,
    cudaGraphs: row.cudaGraphs,
    concurrency: row.concurrency,
    concurrencyLevels,
    inputTokensMean: row.inputTokensMean,
    outputTokensMean: row.outputTokensMean,
    requestCount: row.requestCount,
    streaming: row.streaming,
    measurementWindow: row.measurementWindow,
    islDistribution: row.islDistribution as JobDetail['islDistribution'],
    backend: (row.backend ?? 'openai') as JobDetail['backend'],
  }
}

type ReportListRow = {
  reportId:         string
  jobId:            string
  modelId:          string
  modelName:        string | null
  engine:           string
  quantisation:     string | null
  gpuId:            string
  submittedBy:      string
  completedAt:      Date
  concurrency:      number
  concurrencyLevels: string | null
  requestCount:     number
}

export async function listReports(): Promise<ReportListItem[]> {
  const rows = await sql<ReportListRow[]>`
    SELECT
      report_id           AS "reportId",
      job_id              AS "jobId",
      model_id            AS "modelId",
      model_name          AS "modelName",
      engine,
      quantisation,
      gpu_type            AS "gpuId",
      submitted_by        AS "submittedBy",
      completed_at        AS "completedAt",
      concurrency,
      concurrency_levels  AS "concurrencyLevels",
      request_count       AS "requestCount"
    FROM reports
    ORDER BY completed_at DESC
  `
  return rows.map(row => {
    const gpu = getGpu(row.gpuId)
    return {
      reportId:          row.reportId,
      jobId:             row.jobId,
      modelId:           row.modelId,
      modelName:         row.modelName ?? row.modelId.split('/').pop() ?? row.modelId,
      engine:            row.engine as EngineType,
      quantisation:      row.quantisation as QuantType | null,
      gpuId:             row.gpuId,
      gpuName:           gpu?.name ?? row.gpuId,
      concurrency:       row.concurrency,
      concurrencyLevels: row.concurrencyLevels ? row.concurrencyLevels.split(' ').map(Number) : null,
      requestCount:      row.requestCount,
      submittedBy:       row.submittedBy,
      completedAt:       row.completedAt.toISOString(),
    }
  })
}

type ReportDetailRow = JobDetailRow & {
  reportId: string
}

/** Hydrate the report detail page from the `reports` snapshot.
 *  Lookup key is job_id (matches the URL pattern `/reports/<job_id>`). */
export async function getReportDetail(jobId: string): Promise<(JobDetail & { reportId: string }) | null> {
  const rows = await sql<ReportDetailRow[]>`
    SELECT
      report_id           AS "reportId",
      job_id              AS id,
      job_id              AS "jobId",
      model_id            AS "modelId",
      model_name          AS "modelName",
      engine,
      quantisation,
      gpu_type            AS "gpuId",
      submitted_by        AS "submittedBy",
      created_at          AS "submittedAt",
      'complete'          AS status,
      NULL::text          AS error,
      completed_at        AS "completedAt",
      engine_image        AS "engineImage",
      dtype,
      kv_cache_dtype      AS "kvCacheDtype",
      max_model_len       AS "maxModelLen",
      gpu_memory_util     AS "gpuMemoryUtil",
      max_batch_size      AS "maxBatchSize",
      prefix_caching      AS "prefixCaching",
      chunked_prefill     AS "chunkedPrefill",
      flash_attention     AS "flashAttention",
      batch_scheduler     AS "batchScheduler",
      cuda_graphs         AS "cudaGraphs",
      concurrency,
      concurrency_levels  AS "concurrencyLevels",
      input_tokens_mean   AS "inputTokensMean",
      output_tokens_mean  AS "outputTokensMean",
      request_count       AS "requestCount",
      streaming,
      measurement_window  AS "measurementWindow",
      isl_distribution    AS "islDistribution",
      backend
    FROM reports
    WHERE job_id = ${jobId}
    LIMIT 1
  `
  if (!rows[0]) return null
  const detail = rowToJobDetail(rows[0])
  return { ...detail, reportId: rows[0].reportId }
}

export async function getJobDetail(id: string): Promise<JobDetail | null> {
  const rows = await sql<JobDetailRow[]>`
    SELECT
      j.job_id                AS id,
      j.model_id              AS "modelId",
      m.display_name          AS "modelName",
      j.engine,
      j.quantisation,
      j.gpu_type              AS "gpuId",
      j.submitted_by          AS "submittedBy",
      j.created_at            AS "submittedAt",
      COALESCE(js.status, 'queued') AS status,
      js.error,
      js.completed_at         AS "completedAt",
      js.engine_image         AS "engineImage",
      j.dtype,
      j.kv_cache_dtype        AS "kvCacheDtype",
      j.max_model_len         AS "maxModelLen",
      j.gpu_memory_util       AS "gpuMemoryUtil",
      j.max_batch_size        AS "maxBatchSize",
      j.prefix_caching        AS "prefixCaching",
      j.chunked_prefill       AS "chunkedPrefill",
      j.flash_attention       AS "flashAttention",
      j.batch_scheduler       AS "batchScheduler",
      j.cuda_graphs           AS "cudaGraphs",
      j.concurrency,
      j.concurrency_levels    AS "concurrencyLevels",
      j.input_tokens_mean     AS "inputTokensMean",
      j.output_tokens_mean    AS "outputTokensMean",
      j.request_count         AS "requestCount",
      j.streaming,
      j.measurement_window    AS "measurementWindow",
      j.isl_distribution      AS "islDistribution",
      j.backend
    FROM jobs j
    LEFT JOIN job_status js ON js.job_id = j.job_id
    LEFT JOIN models     m  ON m.hf_repo_id = j.model_id
    WHERE j.job_id = ${id}
  `
  return rows[0] ? rowToJobDetail(rows[0]) : null
}
