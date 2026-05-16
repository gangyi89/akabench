'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

export type ActionItem =
  | {
      type: 'item'
      label: string
      icon?: ReactNode
      onClick: () => void
      variant?: 'default' | 'destructive'
      disabled?: boolean
    }
  | { type: 'divider' }

/**
 * Lightweight dropdown menu used for "Actions" overflows.
 * Opens on click, closes on outside click, Esc, or item activation.
 */
export default function ActionsMenu({
  label = 'Actions',
  items,
  disabled = false,
}: {
  label?: string
  items: ActionItem[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointer(ev: MouseEvent) {
      if (!containerRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    function handleKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
        style={{
          border: '1.5px solid var(--aka-gray-200)',
          background: open ? 'var(--aka-gray-50)' : '#fff',
          color: 'var(--aka-gray-700)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {label}
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 rounded-lg overflow-hidden z-50"
          style={{
            minWidth: '220px',
            background: '#fff',
            border: '1px solid var(--aka-gray-200)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05)',
          }}
        >
          {items.map((item, i) => {
            if (item.type === 'divider') {
              return <div key={`div-${i}`} style={{ height: 1, background: 'var(--aka-gray-100)' }} />
            }
            const destructive = item.variant === 'destructive'
            return (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return
                  item.onClick()
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] disabled:opacity-50"
                style={{
                  color: destructive ? '#991b1b' : 'var(--aka-gray-800)',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  background: 'transparent',
                }}
                onMouseEnter={ev => {
                  if (!item.disabled) ev.currentTarget.style.background = destructive ? '#fef2f2' : 'var(--aka-gray-50)'
                }}
                onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
              >
                {item.icon && <span style={{ flexShrink: 0, display: 'inline-flex', color: destructive ? '#991b1b' : 'var(--aka-gray-500)' }}>{item.icon}</span>}
                <span className="font-medium">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
