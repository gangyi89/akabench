import { type NextRequest, NextResponse } from 'next/server'
import { listCompletedJobs } from '@/lib/jobs/store'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const reports = await listCompletedJobs()
  return NextResponse.json({ reports })
}
