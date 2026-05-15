import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session'
import { getUser } from '@/lib/auth/users'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySessionToken(token)
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  const user = getUser(session.username)
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  return NextResponse.json({
    user: { username: user.username, displayName: user.displayName },
  })
}
