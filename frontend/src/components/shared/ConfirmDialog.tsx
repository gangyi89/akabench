'use client'

import { useEffect, useState, type ReactNode } from 'react'

type Variant = 'default' | 'destructive'

type Props = {
  open: boolean
  title: string
  description?: ReactNode
  /** Bullet list rendered between the description and the buttons. */
  consequences?: ReactNode[]
  confirmLabel?: string
  cancelLabel?: string
  variant?: Variant
  onConfirm: () => Promise<void> | void
  onCancel: () => void
}

const VARIANT_STYLES: Record<Variant, {
  iconBg: string
  iconColor: string
  confirmBg: string
  confirmShadow: string
}> = {
  default: {
    iconBg:        'var(--aka-light)',
    iconColor:     'var(--aka-blue)',
    confirmBg:     'var(--aka-blue)',
    confirmShadow: '0 4px 14px rgba(0,155,222,0.35)',
  },
  destructive: {
    iconBg:        '#fef2f2',
    iconColor:     '#dc2626',
    confirmBg:     '#dc2626',
    confirmShadow: '0 4px 14px rgba(220,38,38,0.35)',
  },
}

const TRASH_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
  </svg>
)

export default function ConfirmDialog({
  open,
  title,
  description,
  consequences,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const palette = VARIANT_STYLES[variant]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, submitting])

  // Reset transient state whenever the dialog reopens.
  useEffect(() => {
    if (open) {
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  if (!open) return null

  async function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm()
      // On success the parent typically closes the dialog (open=false).
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.')
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={ev => { if (ev.target === ev.currentTarget && !submitting) onCancel() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="w-[440px] max-w-[92vw] rounded-2xl bg-white"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <div className="px-8 pt-8 pb-2 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: palette.iconBg, color: palette.iconColor }}
          >
            {TRASH_ICON}
          </div>
          <h3 id="confirm-dialog-title" className="text-[20px] font-extrabold" style={{ color: 'var(--aka-navy)' }}>
            {title}
          </h3>
          {description && (
            <p className="mt-2 text-[13px]" style={{ color: 'var(--aka-gray-600)' }}>
              {description}
            </p>
          )}
        </div>

        {consequences && consequences.length > 0 && (
          <div className="px-8 py-3">
            <ul
              className="rounded-md p-4 text-[12px] flex flex-col gap-1.5"
              style={{
                background: variant === 'destructive' ? '#fef2f2' : 'var(--aka-gray-50)',
                color: 'var(--aka-gray-700)',
                border: `1px solid ${variant === 'destructive' ? '#fecaca' : 'var(--aka-gray-200)'}`,
              }}
            >
              {consequences.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span style={{ color: variant === 'destructive' ? '#dc2626' : 'var(--aka-blue)', flexShrink: 0 }}>•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="px-8 pb-1">
            <div
              role="alert"
              className="rounded-md px-3 py-2 text-[12px]"
              style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}
            >
              {error}
            </div>
          </div>
        )}

        <div className="px-8 pb-7 pt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[14px] font-bold text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: palette.confirmBg,
              boxShadow: palette.confirmShadow,
            }}
          >
            {submitting && (
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {submitting ? `${confirmLabel}…` : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: 'var(--aka-gray-500)' }}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
