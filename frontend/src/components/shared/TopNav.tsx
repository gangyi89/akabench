'use client'

import Link from 'next/link'

type ActivePage = 'configure' | 'jobs' | 'reports'

const NAV_LINKS: { href: string; label: string; key: ActivePage }[] = [
  { href: '/',        label: 'Configure', key: 'configure' },
  { href: '/jobs',    label: 'Jobs',      key: 'jobs'      },
  { href: '/reports', label: 'Reports',   key: 'reports'   },
]

export default function TopNav({ active }: { active: ActivePage }) {
  return (
    <header
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
        <div
          className="flex items-center gap-2 rounded-full px-3 py-1 text-white text-xs"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <div
            className="h-6 w-6 rounded-full flex items-center justify-center text-white font-bold"
            style={{ background: 'var(--aka-blue)', fontSize: '11px' }}
          >JD</div>
          <span className="hidden sm:block">Jane Doe</span>
        </div>
      </div>
    </header>
  )
}
