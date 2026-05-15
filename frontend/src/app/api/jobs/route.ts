import { type NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getModel, getGpu } from '@/lib/catalogue/db'
import { insertJob, listJobs } from '@/lib/jobs/store'
import { validateJobRequest } from '@/lib/jobs/validation'
import { publishBenchmarkRequest } from '@/lib/jobs/nats'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'
import type { Job, JobSubmitRequest, JobSubmitResponse } from '@/lib/catalogue/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const jobs = await listJobs()
  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

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
  const model = await getModel(body.modelId)
  if (!model) {
    return NextResponse.json({ error: 'Model not found', code: 'MODEL_NOT_FOUND' }, { status: 404 })
  }

  const gpu = getGpu(body.gpuId)
  if (!gpu) {
    return NextResponse.json({ error: 'GPU not found', code: 'GPU_NOT_FOUND' }, { status: 404 })
  }
  if (!gpu.available) {
    return NextResponse.json(
      { error: `${gpu.name} is not currently provisioned`, code: 'GPU_UNAVAILABLE' },
      { status: 422 },
    )
  }

  // Compatibility validation — authoritative gate
  const validationError = validateJobRequest(body)
  if (validationError) {
    return NextResponse.json(validationError, { status: 422 })
  }

  const jobId = randomUUID()
  // Identity is taken from the HMAC-verified session cookie, never from a
  // client-supplied header — so the recorded submitter cannot be spoofed.
  const submittedBy = session.username
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
