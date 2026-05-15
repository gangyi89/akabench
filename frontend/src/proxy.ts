import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session'

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySessionToken(token)
  if (session) return NextResponse.next()

  const { pathname, search } = req.nextUrl

  // API routes get a 401 JSON response instead of an HTML redirect.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'unauthenticated' },
      { status: 401 },
    )
  }

  const loginUrl = new URL('/', req.url)
  loginUrl.searchParams.set('login', '1')
  const from = pathname + (search || '')
  if (from && from !== '/') loginUrl.searchParams.set('from', from)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/portal/:path*',
    '/jobs/:path*',
    '/reports/:path*',
    '/api/jobs/:path*',
    '/api/reports/:path*',
    '/api/hardware/:path*',
    '/api/models/:path*',
  ],
}
