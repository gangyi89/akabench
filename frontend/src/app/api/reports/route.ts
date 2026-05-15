import { NextResponse } from 'next/server'
import { listCompletedJobs } from '@/lib/jobs/store'

export async function GET(): Promise<NextResponse> {
  const reports = await listCompletedJobs()
  return NextResponse.json({ reports })
}
