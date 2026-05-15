import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getJobDetail } from '@/lib/jobs/store'

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/jobs/[id]'>,
): Promise<NextResponse> {
  const { id } = await ctx.params

  const job = await getJobDetail(id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json(job)
}
