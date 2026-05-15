import { NextResponse } from 'next/server'
import { sessionCookieAttributes } from '@/lib/auth/session'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ ...sessionCookieAttributes, value: '', maxAge: 0 })
  return res
}
