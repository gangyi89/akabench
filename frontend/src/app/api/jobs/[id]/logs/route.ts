import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getJob } from '@/lib/jobs/store'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'

const VALID = ['engine', 'aiperf'] as const
type Container = typeof VALID[number]

const S3_KEY: Record<Container, (id: string) => string> = {
  engine: id => `${id}/engine.log`,
  aiperf: id => `${id}/aiperf.log`,
}

function makeS3(): S3Client {
  const ep = process.env.S3_ENDPOINT_URL
  const ak = process.env.AWS_ACCESS_KEY_ID
  const sk = process.env.AWS_SECRET_ACCESS_KEY
  if (!ep || !ak || !sk) throw new Error('S3 not configured')
  return new S3Client({
    endpoint: ep,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    forcePathStyle: true,
  })
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const { id } = await ctx.params
  const container = (req.nextUrl.searchParams.get('container') ?? 'engine') as Container

  if (!VALID.includes(container))
    return NextResponse.json({ error: 'invalid container' }, { status: 400 })

  const job = await getJob(id)
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (job.status !== 'complete' && job.status !== 'failed')
    return NextResponse.json({
      content: null,
      available: false,
      message: 'Logs will be available once the run completes.',
    })

  const bucket = process.env.S3_BUCKET
  if (!bucket) return NextResponse.json({ error: 'S3_BUCKET not configured' }, { status: 500 })

  try {
    const s3 = makeS3()
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: S3_KEY[container](id) }))
    const content = await res.Body?.transformToString() ?? ''
    return NextResponse.json({ content, available: true })
  } catch (err: unknown) {
    if ((err as { Code?: string }).Code === 'NoSuchKey')
      return NextResponse.json({
        content: null,
        available: false,
        message: 'Logs not yet available.',
      })
    return NextResponse.json({ error: 'failed to fetch logs' }, { status: 500 })
  }
}
