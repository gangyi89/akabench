// HMAC-signed session token, edge-runtime compatible (Web Crypto only).
// Cookie name: `aka_session`.

const SECRET = process.env.AUTH_SECRET ?? 'akabench-dev-secret-do-not-use-in-prod'
const DEFAULT_TTL_SEC = 60 * 60 * 12 // 12 hours

export const SESSION_COOKIE = 'aka_session'

export type Session = {
  username: string
  exp: number
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4
  const padded = s + '='.repeat(pad ? 4 - pad : 0)
  const std = padded.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(std)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacSign(input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))
  return base64urlEncode(new Uint8Array(sig))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export async function createSessionToken(username: string, ttlSec = DEFAULT_TTL_SEC): Promise<string> {
  const payload: Session = { username, exp: Math.floor(Date.now() / 1000) + ttlSec }
  const encoded = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSign(encoded)
  return `${encoded}.${sig}`
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null
  const [encoded, sig] = token.split('.')
  if (!encoded || !sig) return null
  const expected = await hmacSign(encoded)
  if (!constantTimeEqual(sig, expected)) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded))) as Session
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    if (typeof payload.username !== 'string' || !payload.username) return null
    return payload
  } catch {
    return null
  }
}

export const sessionCookieAttributes = {
  name: SESSION_COOKIE,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: DEFAULT_TTL_SEC,
}

// Helpers for route handlers — defence in depth alongside the proxy gate.
// Handlers must verify the session themselves so they (a) never trust
// client-supplied identity headers and (b) stay protected even if the
// proxy matcher is misconfigured.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export async function getSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return verifySessionToken(token)
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Authentication required', code: 'unauthenticated' },
    { status: 401 },
  )
}
