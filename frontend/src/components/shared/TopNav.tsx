'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type ActivePage = 'configure' | 'jobs' | 'reports'

const NAV_LINKS: { href: string; label: string; key: ActivePage }[] = [
  { href: '/portal',  label: 'Configure', key: 'configure' },
  { href: '/jobs',    label: 'Jobs',      key: 'jobs'      },
  { href: '/reports', label: 'Reports',   key: 'reports'   },
]

type SessionUser = { username: string; displayName: string }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function TopNav({ active }: { active: ActivePage }) {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((data: { user: SessionUser | null }) => { if (!cancelled) setUser(data.user) })
      .catch(() => { /* leave as null */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore — middleware will catch unauthenticated state on the next request
    }
    router.replace('/')
    router.refresh()
  }

  const display = user?.displayName ?? '—'

  return (
    <header
      data-print-hide
      className="flex items-center justify-between px-6 sticky top-0 z-50 shadow-md"
      style={{ background: 'var(--aka-navy)', height: '52px' }}
    >
      <div className="flex items-center gap-4">
        <span className="text-[14px] font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>GPU Benchmark Portal</span>
        <div className="h-6 w-px" style={{ background: 'rgba(255,255,255,0.2)' }} />
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.key}
              href={link.href}
              className="rounded px-3 py-1.5 text-[13px]"
              style={
                active === link.key
                  ? { background: 'rgba(0,155,222,0.25)', color: '#fff', fontWeight: 600 }
                  : { color: 'rgba(255,255,255,0.6)', fontWeight: 500 }
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider rounded px-2 py-0.5"
          style={{ background: 'rgba(0,155,222,0.2)', color: 'var(--aka-blue)', border: '1px solid rgba(0,155,222,0.4)' }}
        >
          Internal Only
        </span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-2 rounded-full px-3 py-1 text-white text-xs cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-white font-bold"
              style={{ background: 'var(--aka-blue)', fontSize: '11px' }}
            >
              {user ? initials(user.displayName) : '·'}
            </div>
            <span className="hidden sm:block">{display}</span>
            <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.4a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-44 rounded-md py-1 z-50"
              style={{
                background: '#fff',
                border: '1px solid var(--aka-gray-200)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
              }}
            >
              <div className="px-3 py-2 text-[12px]" style={{ color: 'var(--aka-gray-500)' }}>
                Signed in as<br />
                <span className="font-semibold" style={{ color: 'var(--aka-gray-800)' }}>{user?.username ?? '—'}</span>
              </div>
              <div className="h-px mx-1 my-1" style={{ background: 'var(--aka-gray-100)' }} />
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full text-left px-3 py-2 text-[13px] cursor-pointer disabled:opacity-50"
                style={{ color: 'var(--aka-gray-700)' }}
              >
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
