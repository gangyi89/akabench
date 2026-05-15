import { type NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getModel, getGpu } from '@/lib/catalogue/db'
import { insertJob, listJobs } from '@/lib/jobs/store'
import { validateJobRequest } from '@/lib/jobs/validation'
import { publishBenchmarkRequest } from '@/lib/jobs/nats'
import type { Job, JobSubmitRequest, JobSubmitResponse } from '@/lib/catalogue/types'

export async function GET(): Promise<NextResponse> {
  const jobs = await listJobs()
  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: JobSubmitRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, { status: 400 })
  }

  // Basic presence checks
  if (!body.modelId || !body.engine || !body.gpuId) {
    return NextResponse.json(
      { error: 'modelId, engine, and gpuId are required', code: 'MISSING_FIELDS' },
      { status: 400 },
    )
  }

  // Resolve display names from catalogue
  const model = getModel(body.modelId)
  if (!model) {
    return NextResponse.json({ error: 'Model not found', code: 'MODEL_NOT_FOUND' }, { status: 404 })
  }

  const gpu = getGpu(body.gpuId)
  if (!gpu) {
    return NextResponse.json({ error: 'GPU not found', code: 'GPU_NOT_FOUND' }, { status: 404 })
  }

  // Compatibility validation — authoritative gate
  const validationError = validateJobRequest(body)
  if (validationError) {
    return NextResponse.json(validationError, { status: 422 })
  }

  const jobId = randomUUID()
  const rawSubmittedBy = req.headers.get('x-submitted-by') ?? ''
  // Sanitize: strip whitespace, cap length, fall back to 'anonymous'.
  const submittedBy = rawSubmittedBy.trim().slice(0, 128) || 'anonymous'
  const submittedAt = new Date().toISOString()

  // Derive dtype from quantisation — not user-submitted.
  const dtype =
    body.quantisation === 'fp16' ? 'float16' :
    body.quantisation === 'bf16' ? 'bfloat16' :
    'auto'

  // Job row — display fields for the UI.
  const job: Job = {
    id:           jobId,
    modelId:      body.modelId,
    modelName:    model.displayName,
    engine:       body.engine,
    quantisation: body.quantisation ?? null,
    gpuId:        body.gpuId,
    gpuName:      gpu.name,
    status:       'queued',
    submittedBy,
    submittedAt,
    completedAt:       null,
    error:             null,
    concurrencyLevels: body.concurrencyLevels ?? null,
  }

  // 1. Persist all params to Postgres — this is the single source of truth.
  await insertJob(job, body, dtype)

  // 2. Notify the job controller via NATS — job_id only.
  //    The controller reads all params from Postgres.
  await publishBenchmarkRequest({ job_id: jobId })

  const isSweep = Array.isArray(body.concurrencyLevels) && body.concurrencyLevels.length > 0
  const response: JobSubmitResponse = { jobId, ...(isSweep ? { isSweep: true } : {}) }
  return NextResponse.json(response, { status: 201 })
}
