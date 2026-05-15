import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getJobDetail } from '@/lib/jobs/store'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'

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
