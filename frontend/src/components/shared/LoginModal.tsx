'use client'

import { useEffect, useState } from 'react'

type Props = {
  onClose: () => void
  onSuccess: (user: { username: string; displayName: string }) => void
  onRequestAccess?: () => void
}

export default function LoginModal({ onClose, onSuccess, onRequestAccess }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        setError(data?.error ?? 'Login failed')
        setSubmitting(false)
        return
      }
      const data = (await res.json()) as { user: { username: string; displayName: string } }
      onSuccess(data.user)
    } catch {
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-[420px] max-w-[92vw] rounded-2xl bg-white"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <div className="px-8 pt-8 pb-2 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'var(--aka-light)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--aka-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h3 id="login-modal-title" className="text-[20px] font-extrabold" style={{ color: 'var(--aka-navy)' }}>
            Sign in to AKAbench
          </h3>
          <p className="mt-1 text-[14px]" style={{ color: 'var(--aka-gray-500)' }}>
            Internal Akamai access only.
          </p>
        </div>

        <div className="px-8 py-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--aka-gray-600)' }}>Username</span>
            <input
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              disabled={submitting}
              className="rounded-md px-3 py-2 text-[14px] outline-none"
              style={{
                border: '1px solid var(--aka-gray-300)',
                background: submitting ? 'var(--aka-gray-50)' : '#fff',
              }}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--aka-gray-600)' }}>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={submitting}
              className="rounded-md px-3 py-2 text-[14px] outline-none"
              style={{
                border: '1px solid var(--aka-gray-300)',
                background: submitting ? 'var(--aka-gray-50)' : '#fff',
              }}
            />
          </label>

          {error && (
            <div
              className="rounded-md px-3 py-2 text-[12px]"
              style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}
              role="alert"
            >
              {error}
            </div>
          )}
        </div>

        <div className="px-8 pb-7 pt-1 flex flex-col gap-2">
          <button
            type="submit"
            disabled={submitting || !username || !password}
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: 'var(--aka-blue)',
              boxShadow: '0 4px 14px rgba(0,155,222,0.35)',
            }}
          >
            {submitting && (
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
            style={{ color: 'var(--aka-gray-500)' }}
          >
            Cancel
          </button>
          {onRequestAccess && (
            <div
              className="mt-2 pt-3 text-center text-[13px]"
              style={{ borderTop: '1px solid var(--aka-gray-100)', color: 'var(--aka-gray-500)' }}
            >
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={onRequestAccess}
                disabled={submitting}
                className="font-semibold disabled:opacity-50"
                style={{ color: 'var(--aka-blue)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                Request access →
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  )
}
