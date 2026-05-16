import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getJobDetail } from '@/lib/jobs/store'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'

const CONTROLLER_URL = process.env.JOB_CONTROLLER_URL ?? 'http://job-controller:8080'

export async function GET(
  req: NextRequest,
  ctx: RouteContext<'/api/jobs/[id]'>,
): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const { id } = await ctx.params

  const job = await getJobDetail(id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json(job)
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<'/api/jobs/[id]'>,
): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const { id } = await ctx.params

  // Controller does the actual cleanup (DB cascade + K8s Job delete + watcher
  // cancel). Reports and S3 are deliberately untouched.
  let res: Response
  try {
    res = await fetch(`${CONTROLLER_URL}/jobs/${id}`, { method: 'DELETE' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return NextResponse.json(
      { error: `Could not reach job controller at ${CONTROLLER_URL}: ${message}`, code: 'CONTROLLER_UNREACHABLE' },
      { status: 502 },
    )
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `Controller delete failed: ${res.status} ${detail}`, code: 'CONTROLLER_ERROR' },
      { status: 502 },
    )
  }
  return new NextResponse(null, { status: 204 })
}
