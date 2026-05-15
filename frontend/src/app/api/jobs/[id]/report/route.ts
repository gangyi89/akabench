import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getJob } from '@/lib/jobs/store'

// Presigned URLs expire after 60 seconds — effectively one-time use.
const EXPIRES_IN = 60

const FILE_KEYS: Record<string, { s3Key: (jobId: string) => string; filename: string }> = {
  aiperf: {
    s3Key:    jobId => `${jobId}/aiperf.json`,
    filename: 'aiperf.json',
  },
  dcgm: {
    s3Key:    jobId => `${jobId}/dcgm_metrics.json`,
    filename: 'dcgm_metrics.json',
  },
}

function getS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT_URL
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const region = process.env.S3_REGION ?? 'us-east-1'

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 credentials not configured (S3_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)')
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,   // required for Linode Object Storage
  })
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const file = req.nextUrl.searchParams.get('file') ?? ''

  if (!FILE_KEYS[file]) {
    return NextResponse.json(
      { error: 'Invalid file parameter. Use: aiperf | dcgm', code: 'INVALID_FILE' },
      { status: 400 },
    )
  }

  // Verify job exists and is complete before issuing a URL.
  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 })
  }
  if (job.status !== 'complete') {
    return NextResponse.json(
      { error: 'Reports are only available for completed jobs', code: 'JOB_NOT_COMPLETE' },
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

  const { s3Key, filename } = FILE_KEYS[file]
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key(id),
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  })

  const url = await getSignedUrl(s3, command, { expiresIn: EXPIRES_IN })

  return NextResponse.json({ url, expiresIn: EXPIRES_IN })
}
