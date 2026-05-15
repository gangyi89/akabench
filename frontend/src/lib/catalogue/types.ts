export type QuantType =
  | 'fp16'
  | 'bf16'
  | 'fp8'
  | 'nvfp4'
  | 'smoothquant'
  | 'w4a8'
  | 'w4a16'

export type EngineType = 'trt-llm' | 'vllm' | 'sglang'

export type ArchType = 'dense' | 'moe'

export type LicenceType = 'apache2' | 'mit' | 'llama3' | 'llama2' | 'gated' | 'commercial' | 'other'

export type QualityTier = '70b-class' | '13b-class' | '7b-class'

export interface EnrichedModel {
  hfRepoId: string
  displayName: string
  vendor: string
  family: string
  archType: ArchType
  paramCountB: number
  activeParamCountB: number | null  // MoE only
  qualityTier: QualityTier
  vramFp16Gb: number
  vramFp8Gb: number
  vramNvfp4Gb: number
  supportedQuants: QuantType[]
  ngcContainerTag: string | null
  licenceType: LicenceType
  mauLimit: number | null
  downloadsMonthly: number
  tags: string[]
}

export interface GPU {
  id: string
  name: string
  vramGb: number
  bf16Tflops: number     // BF16 tensor core performance in TFLOPS
  tensorCoreCaps: Array<'fp16' | 'fp8' | 'fp4' | 'int8'>
  trtLlmSupported: boolean
  vllmSupported: boolean
  optionLabel: string    // "Option A", "Option B"
  targetWorkload: string // short description for UI
}

export interface CompatResult {
  gpuId: string
  fitsFp16: boolean
  fitsFp8: boolean
  fitsNvfp4: boolean
  warning: string | null
}

export interface DeriveResult {
  model: EnrichedModel
  engineRecommendation: EngineType
  engineNote: string
  supportedQuants: QuantType[]
  quantNotice: string | null
  compatWarning: string | null
  compat: CompatResult[]
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'pending' | 'running' | 'complete' | 'failed'

export type IslDistribution = 'fixed' | 'normal-10' | 'normal-25' | 'exponential' | 'synthetic'
export type Backend = 'openai' | 'triton-grpc'

export type JobSubmitRequest = {
  modelId: string
  engine: EngineType
  quantisation: QuantType | null
  gpuId: string
  // Load profile (all optional — defaults applied server-side)
  concurrency?: number
  concurrencyLevels?: number[]  // sweep mode — overrides concurrency when set
  inputTokensMean?: number
  outputTokensMean?: number
  requestCount?: number
  streaming?: boolean
  measurementWindow?: number   // seconds — aiperf --benchmark-duration
  islDistribution?: IslDistribution
  backend?: Backend
  // Engine tuning — shared
  kvCacheDtype?: string        // auto | fp8 | int8 (vLLM) | fp16 (TRT-LLM)
  maxModelLen?: number
  gpuMemoryUtil?: number
  maxBatchSize?: number
  // Engine tuning — vLLM
  prefixCaching?: boolean
  chunkedPrefill?: boolean
  flashAttention?: boolean
  // Engine tuning — TRT-LLM
  batchScheduler?: 'inflight' | 'static'
  cudaGraphs?: boolean
}

export type Job = {
  id: string
  modelId: string
  modelName: string
  engine: EngineType
  quantisation: QuantType | null
  gpuId: string
  gpuName: string
  status: JobStatus
  submittedBy: string
  submittedAt: string   // ISO string
  completedAt: string | null
  error: string | null
  concurrencyLevels: number[] | null
}

export type JobSubmitResponse = {
  jobId: string
  /** Present when concurrencyLevels was set — same jobId, signals sweep mode */
  isSweep?: boolean
}

/**
 * The payload published to NATS. Carries only the job_id — the job controller
 * reads all benchmark parameters directly from Postgres, which is the single
 * source of truth. NATS is used purely for ordering and delivery guarantees.
 */
export type NatsPayload = {
  job_id: string
}

export type JobDetail = Job & {
  // Engine config
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
  // AIPerf / load profile config
  concurrency: number
  concurrencyLevels: number[] | null  // null = single-run, array = sweep
  inputTokensMean: number
  outputTokensMean: number
  requestCount: number
  streaming: boolean
  measurementWindow: number
  islDistribution: IslDistribution
  backend: Backend
}

// ── Reports ─────────────────────────────────────────────────────────────────

/** A single metric entry from aiperf.json — scalar fields only have `avg` */
export type AiperfMetric = {
  unit: string
  avg: number
  min?: number
  max?: number
  p50?: number
  p90?: number
  p99?: number
  std?: number
  [key: string]: number | string | undefined
}

export type AiperfResults = {
  schema_version: string
  aiperf_version: string
  akabench_job_id: string
  benchmark_duration:                     AiperfMetric
  time_to_first_token:                    AiperfMetric
  time_to_second_token:                   AiperfMetric
  request_latency:                        AiperfMetric
  inter_token_latency:                    AiperfMetric
  output_token_throughput:                AiperfMetric
  output_token_throughput_per_user:       AiperfMetric
  output_sequence_length:                 AiperfMetric
  input_sequence_length:                  AiperfMetric
  request_throughput:                     AiperfMetric
  request_count:                          AiperfMetric
}

export type DcgmMetricStats = {
  avg: number
  p50: number
  p95: number
  peak: number
}

export type DcgmSummary = {
  gpu_util_pct:      DcgmMetricStats
  vram_used_gb:      DcgmMetricStats
  vram_total_mb:     number
  vram_headroom_pct: number
  sm_clock_mhz:      DcgmMetricStats
  mem_clock_mhz:     DcgmMetricStats
  dram_active:       DcgmMetricStats
  tensor_active:     DcgmMetricStats
  gr_engine_active:  DcgmMetricStats
  throttle_detected: boolean
  energy_delta_j:    number
  sample_count:      number
}

export type DcgmResults = {
  schema_version:     string
  gpu_name:           string
  benchmark_duration_s: number
  summary:            DcgmSummary
}

/** Returned by GET /api/reports/[id] — job details + presigned S3 URLs */
export type ReportMeta = {
  job:       JobDetail
  aiperfUrl: string
  dcgmUrl:   string
}

/** Assembled client-side after fetching both presigned URLs */
export type ReportData = {
  job:          JobDetail
  aiperf:       AiperfResults | null  // null for sweep jobs (use sweepPoints instead)
  dcgm:         DcgmResults
  sweepPoints:  SweepPoint[] | null   // non-null for sweep jobs
}

/** A single point on the latency-throughput sweep curve */
export type SweepPoint = {
  concurrency:   number
  ttftAvg:       number  // ms
  itlAvg:        number  // ms  — inter-token latency
  e2eLatencyAvg: number  // ms  — end-to-end request latency
  tpsPerUserAvg: number  // tok/s/user
  throughputAvg: number  // tok/s total
}

/** Row in the reports listing — derived from completed jobs, no S3 needed */
export type ReportListItem = {
  jobId:            string
  modelId:          string
  modelName:        string
  engine:           EngineType
  quantisation:     QuantType | null
  gpuId:            string
  gpuName:          string
  concurrency:      number
  concurrencyLevels: number[] | null
  requestCount:     number
  submittedBy:      string
  completedAt:      string  // ISO string
}

// ────────────────────────────────────────────────────────────────────────────

export interface SearchResultItem {
  hfRepoId: string
  displayName: string
  paramCountB: number
  vramFp16Gb: number
  downloadsMonthly: number
  tags: string[]
  licenceType: LicenceType
  licenceWarning: string | null
  compatSummary: string | null  // "✓ Fits RTX Pro 6000" or "⚠ Needs INT4"
}
