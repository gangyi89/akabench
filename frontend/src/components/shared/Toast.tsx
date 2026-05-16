'use client'

import { useEffect, useState, type ReactNode } from 'react'

type Variant = 'success' | 'error' | 'info'

const VARIANT_STYLES: Record<Variant, { bg: string; border: string; text: string; iconColor: string }> = {
  success: { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46', iconColor: '#10b981' },
  error:   { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', iconColor: '#dc2626' },
  info:    { bg: 'var(--aka-light)', border: 'rgba(0,155,222,0.3)', text: 'var(--aka-navy)', iconColor: 'var(--aka-blue)' },
}

const ICONS: Record<Variant, ReactNode> = {
  success: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8"  x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8"  x2="12.01" y2="8" />
    </svg>
  ),
}

export default function Toast({
  message,
  variant = 'success',
  durationMs = 3500,
  onDismiss,
}: {
  message: string | null
  variant?: Variant
  durationMs?: number
  onDismiss: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) {
      setVisible(false)
      return
    }
    // Two-phase mount so the fade-in transition can play.
    setVisible(true)
    const fadeTimer = setTimeout(() => setVisible(false), durationMs)
    const dismissTimer = setTimeout(onDismiss, durationMs + 200)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(dismissTimer)
    }
  }, [message, durationMs, onDismiss])

  if (!message) return null
  const palette = VARIANT_STYLES[variant]

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[68px] left-1/2 z-[998] rounded-lg px-4 py-3 flex items-center gap-3 text-[13px] font-semibold"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        minWidth: '260px',
        maxWidth: '420px',
        opacity: visible ? 1 : 0,
        // Combine horizontal centering with the slide-in transition.
        transform: visible ? 'translate(-50%, 0)' : 'translate(-50%, -6px)',
        transition: 'opacity 180ms ease, transform 180ms ease',
      }}
    >
      <span style={{ color: palette.iconColor, flexShrink: 0 }}>{ICONS[variant]}</span>
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={() => { setVisible(false); setTimeout(onDismiss, 180) }}
        aria-label="Dismiss"
        className="rounded p-0.5 transition-colors"
        style={{ color: palette.text, opacity: 0.6, background: 'transparent', cursor: 'pointer' }}
        onMouseEnter={ev => { ev.currentTarget.style.opacity = '1' }}
        onMouseLeave={ev => { ev.currentTarget.style.opacity = '0.6' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6"  x2="6"  y2="18" />
          <line x1="6"  y1="6"  x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
