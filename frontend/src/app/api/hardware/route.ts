import { type NextRequest, NextResponse } from 'next/server'
import { getAllGpus } from '@/lib/catalogue/db'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  return NextResponse.json({ gpus: getAllGpus() })
}
