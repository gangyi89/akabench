'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import useSWR from 'swr'
import TopNav from '@/components/shared/TopNav'
import EngineBadge from '@/components/shared/EngineBadge'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Toast from '@/components/shared/Toast'
import type { Job, JobStatus } from '@/lib/catalogue/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const STATUS_STYLES: Record<JobStatus, { bg: string; color: string; label: string; dot?: boolean }> = {
  running:  { bg: 'rgba(0,155,222,0.1)', color: 'var(--aka-blue)', label: 'Running', dot: true },
  complete: { bg: '#dcfce7', color: '#166534', label: '✓ Complete' },
  failed:   { bg: '#fee2e2', color: '#991b1b', label: '✕ Failed' },
  queued:   { bg: 'var(--aka-gray-100)', color: 'var(--aka-gray-600)', label: 'Queued' },
  pending:  { bg: 'var(--aka-gray-100)', color: 'var(--aka-gray-600)', label: 'Pending' },
}

function StatusChip({ status }: { status: JobStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.queued
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.dot && (
        <span
          className="status-pulse inline-flex h-2 w-2 rounded-full"
          style={{ background: 'currentColor' }}
          aria-hidden="true"
        />
      )}
      {s.label}
    </span>
  )
}

function formatRelative(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)  return `${diffHr} hr ago`
  return `${Math.floor(diffHr / 24)} days ago`
}

const HEADERS = ['Job ID', 'Model', 'Engine', 'Quant', 'Hardware', 'Status', 'Submitted by', 'Submitted', '']

function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} style={{ borderBottom: '1px solid var(--aka-gray-100)' }}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div
                className="animate-pulse rounded"
                style={{
                  height: '12px',
                  width: j === 0 ? '60px' : j === 1 ? '140px' : j === cols - 1 ? '48px' : '80px',
                  background: 'var(--aka-gray-200)',
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function JobsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data, error, mutate } = useSWR<{ jobs: Job[] }>('/api/jobs', fetcher, {
    refreshInterval: 5000,
    keepPreviousData: true,
  })
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Pick up a redirect from the detail page (e.g. /jobs?deleted=1).
  useEffect(() => {
    if (searchParams.get('deleted') === '1') {
      setToast('Job deleted successfully.')
      router.replace('/jobs', { scroll: false })
    }
  }, [searchParams, router])

  async function performDelete() {
    if (!pendingDelete) return
    const job = pendingDelete
    const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? res.statusText)
    }
    setPendingDelete(null)
    setToast('Job deleted successfully.')
    await mutate()
  }

  const jobs    = data?.jobs ?? []
  const running  = jobs.filter(j => j.status === 'running').length
  const complete = jobs.filter(j => j.status === 'complete').length
  const failed   = jobs.filter(j => j.status === 'failed').length

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--aka-gray-100)' }}>
      <TopNav active="jobs" />

      <main className="flex-1 p-6 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[16px] font-bold" style={{ color: 'var(--aka-gray-800)' }}>Benchmark Jobs</h1>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--aka-gray-400)' }}>
              {!data
                ? '\u00A0'
                : `${jobs.length} jobs · ${running} running · ${complete} completed · ${failed} failed`
              }
            </p>
          </div>
          <Link
            href="/configure"
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-bold text-white"
            style={{ background: 'var(--aka-blue)', boxShadow: '0 2px 8px rgba(0,155,222,0.3)' }}
          >
            + New Benchmark
          </Link>
        </div>

        <div
          className="overflow-hidden rounded-lg"
          style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
        >
          {error ? (
            <div className="px-4 py-12 text-center text-[14px]" style={{ color: '#991b1b' }}>
              Failed to load jobs.
            </div>
          ) : (
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--aka-gray-50)', borderBottom: '1px solid var(--aka-gray-200)' }}>
                  {HEADERS.map(h => (
                    <th
                      key={h}
                      className={`${h === 'Engine' ? 'pl-4 pr-2' : 'px-4'} py-2.5 text-left text-[12px] font-semibold uppercase tracking-wider`}
                      style={{ color: 'var(--aka-gray-500)' }}
                    >{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!data ? (
                  <SkeletonRows cols={HEADERS.length} />
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan={HEADERS.length} className="px-4 py-12 text-center text-[14px]" style={{ color: 'var(--aka-gray-400)' }}>
                      No benchmark jobs yet.{' '}
                      <Link href="/configure" style={{ color: 'var(--aka-blue)' }}>Run your first benchmark →</Link>
                    </td>
                  </tr>
                ) : (
                  jobs.map((job, i) => (
                    <tr
                      key={job.id}
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      style={{ borderBottom: i < jobs.length - 1 ? '1px solid var(--aka-gray-100)' : 'none', cursor: 'pointer' }}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span style={{ fontFamily: "'SFMono-Regular',Consolas,monospace", fontSize: '12px', color: 'var(--aka-gray-500)' }}>
                          {job.id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold" style={{ color: 'var(--aka-gray-800)' }}>{job.modelName}</span>
                          {job.concurrencyLevels && (
                            <span style={{
                              fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
                              background: 'rgba(124,58,237,0.1)', color: '#7c3aed',
                              border: '1px solid rgba(124,58,237,0.25)', whiteSpace: 'nowrap',
                            }}>
                              Sweep
                            </span>
                          )}
                        </div>
                        <div className="text-[12px]" style={{ color: 'var(--aka-gray-400)' }}>{job.modelId}</div>
                      </td>
                      <td className="pl-4 pr-2 py-3">
                        <EngineBadge engine={job.engine} />
                      </td>
                      <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-600)' }}>
                        {job.quantisation?.toUpperCase() ?? 'FP16'}
                      </td>
                      <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-700)' }}>{job.gpuName}</td>
                      <td className="px-4 py-3"><StatusChip status={job.status} /></td>
                      <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-600)' }}>{job.submittedBy}</td>
                      <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-400)' }}>{formatRelative(job.submittedAt)}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 justify-end">
                          <Link
                            href={`/jobs/${job.id}`}
                            className="rounded px-3 py-1 text-[12px] font-semibold"
                            style={{ border: '1px solid var(--aka-gray-200)', color: 'var(--aka-gray-600)', background: '#fff' }}
                          >
                            View →
                          </Link>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(job)}
                            title="Delete job"
                            aria-label={`Delete job ${job.id.slice(0, 8)}`}
                            className="rounded px-2 py-1 text-[12px] font-semibold"
                            style={{ border: '1px solid var(--aka-gray-200)', color: '#991b1b', background: '#fff', cursor: 'pointer' }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={pendingDelete !== null}
        variant="destructive"
        title="Delete this job?"
        description={pendingDelete && (
          <>Deleting <strong>{pendingDelete.modelName}</strong> ({pendingDelete.id.slice(0, 8)}…). This cannot be undone.</>
        )}
        consequences={[
          'Cancels the K8s Job if it is still running.',
          'Removes the job rows from the database.',
          'The report (if any) and S3 result files are kept.',
        ]}
        confirmLabel="Delete job"
        onConfirm={performDelete}
        onCancel={() => setPendingDelete(null)}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsContent />
    </Suspense>
  )
}
