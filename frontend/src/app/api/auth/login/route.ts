import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials } from '@/lib/auth/users'
import { createSessionToken, sessionCookieAttributes } from '@/lib/auth/session'

export async function POST(req: NextRequest) {
  let body: { username?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'bad_request' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) {
    return NextResponse.json(
      { error: 'Username and password are required', code: 'missing_fields' },
      { status: 400 },
    )
  }

  const user = verifyCredentials(username, password)
  if (!user) {
    return NextResponse.json(
      { error: 'Invalid username or password', code: 'invalid_credentials' },
      { status: 401 },
    )
  }

  const token = await createSessionToken(user.username)
  const res = NextResponse.json({
    user: { username: user.username, displayName: user.displayName },
  })
  res.cookies.set({ ...sessionCookieAttributes, value: token })
  return res
}
