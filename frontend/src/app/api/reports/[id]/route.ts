import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getJobDetail } from '@/lib/jobs/store'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'
import type { AiperfResults, SweepPoint } from '@/lib/catalogue/types'

// S3 credentials live in server-side env vars only — never exposed to the browser.
// This route handler runs server-side and proxies the S3 content.

function getS3Client(): S3Client {
  const endpoint        = process.env.S3_ENDPOINT_URL
  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const region          = process.env.S3_REGION ?? 'us-east-1'

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 credentials not configured (S3_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)')
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
}

async function fetchS3Json(s3: S3Client, bucket: string, key: string): Promise<unknown> {
  const res  = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = await res.Body?.transformToString()
  if (!body) throw new Error(`Empty S3 response for key: ${key}`)
  return JSON.parse(body)
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const { id } = await ctx.params

  const job = await getJobDetail(id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 })
  }
  if (job.status !== 'complete') {
    return NextResponse.json(
      { error: 'Report only available for completed jobs', code: 'JOB_NOT_COMPLETE' },
      { status: 409 },
    )
  }

  const bucket = process.env.S3_BUCKET
  if (!bucket) {
    return NextResponse.json({ error: 'S3_BUCKET not configured', code: 'CONFIG_ERROR' }, { status: 500 })
  }

  let s3: S3Client
  try {
    s3 = getS3Client()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'S3 configuration error'
    return NextResponse.json({ error: message, code: 'CONFIG_ERROR' }, { status: 500 })
  }

  try {
    if (job.concurrencyLevels && job.concurrencyLevels.length > 0) {
      // Sweep job — try per-concurrency files first, fall back to aiperf.json if missing
      // (jobs submitted before the sweep template was deployed only have aiperf.json)
      const dcgm = await fetchS3Json(s3, bucket, `${id}/dcgm_metrics.json`)

      const perLevelResults = await Promise.all(
        job.concurrencyLevels.map(c =>
          fetchS3Json(s3, bucket, `${id}/aiperf_c${c}.json`).catch(() => null)
        )
      )

      const missing = job.concurrencyLevels.filter((_, i) => !perLevelResults[i])
      if (missing.length > 0) {
        // All files missing → job ran against an older single-run template.
        // Fall back to aiperf.json and return the single-run view.
        if (missing.length === job.concurrencyLevels.length) {
          try {
            const aiperf = await fetchS3Json(s3, bucket, `${id}/aiperf.json`)
            return NextResponse.json({ job, aiperf, dcgm, sweepPoints: null })
          } catch {
            // aiperf.json also missing — nothing to show
          }
        }
        return NextResponse.json(
          { error: `Concurrency benchmark results missing for levels: ${missing.join(', ')}. The job may have run with an older template — resubmit to generate sweep data.`, code: 'SWEEP_FILES_MISSING' },
          { status: 404 },
        )
      }

      const sweepPoints: SweepPoint[] = job.concurrencyLevels.map((c, i) => {
        const a = perLevelResults[i] as AiperfResults
        return {
          concurrency:   c,
          ttftAvg:       a.time_to_first_token?.avg ?? 0,
          itlAvg:        a.inter_token_latency?.avg ?? 0,
          e2eLatencyAvg: a.request_latency?.avg ?? 0,
          tpsPerUserAvg: a.output_token_throughput_per_user?.avg ?? 0,
          throughputAvg: a.output_token_throughput?.avg ?? 0,
        }
      })
      return NextResponse.json({ job, aiperf: null, dcgm, sweepPoints })
    }

    // Single-run job — existing behaviour
    const [aiperf, dcgm] = await Promise.all([
      fetchS3Json(s3, bucket, `${id}/aiperf.json`),
      fetchS3Json(s3, bucket, `${id}/dcgm_metrics.json`),
    ])
    return NextResponse.json({ job, aiperf, dcgm, sweepPoints: null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch results from storage'
    return NextResponse.json({ error: message, code: 'S3_FETCH_ERROR' }, { status: 502 })
  }
}
