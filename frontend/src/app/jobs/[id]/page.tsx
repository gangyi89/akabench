'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import TopNav from '@/components/shared/TopNav'
import Spinner from '@/components/shared/Spinner'
import type { JobDetail, JobStatus } from '@/lib/catalogue/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// GPU VRAM lookup — only 2 GPUs in the catalogue
const GPU_VRAM: Record<string, number> = {
  'rtx-pro-6000': 96,
  'rtx-4000-ada': 20,
}

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
      {s.dot && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'currentColor' }} />}
      {s.label}
    </span>
  )
}


function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)  return `${diffHr} hr ago`
  return `${Math.floor(diffHr / 24)} days ago`
}

// ── Download helpers ───────────────────────────────────────────────────────

type DownloadFile = 'aiperf' | 'dcgm'

const DOWNLOAD_FILES: { key: DownloadFile; label: string; description: string }[] = [
  { key: 'aiperf', label: 'AIPerf Results',  description: 'aiperf.json' },
  { key: 'dcgm',   label: 'GPU Metrics',     description: 'dcgm_metrics.json' },
]

function DownloadButton({ jobId, file, label, description }: {
  jobId: string
  file: DownloadFile
  label: string
  description: string
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  async function handleDownload() {
    setState('loading')
    try {
      const res = await fetch(`/api/jobs/${jobId}/report?file=${file}`)
      if (!res.ok) {
        setState('error')
        setTimeout(() => setState('idle'), 3000)
        return
      }
      const { url } = await res.json()
      // Open the presigned URL in the same tab — browser triggers file download
      // because the S3 response sets Content-Disposition: attachment.
      window.location.href = url
      setState('idle')
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={state === 'loading'}
      className="w-full flex items-center justify-between rounded-md px-3 py-2 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: state === 'error' ? '#fee2e2' : 'var(--aka-gray-50)',
        border: `1px solid ${state === 'error' ? '#fca5a5' : 'var(--aka-gray-200)'}`,
      }}
    >
      <div>
        <div className="text-[13px] font-semibold" style={{ color: state === 'error' ? '#991b1b' : 'var(--aka-gray-800)' }}>
          {state === 'error' ? 'Download failed' : label}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--aka-gray-400)' }}>{description}</div>
      </div>
      <div style={{ color: state === 'error' ? '#991b1b' : 'var(--aka-blue)', flexShrink: 0 }}>
        {state === 'loading'
          ? <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
        }
      </div>
    </button>
  )
}

// ── Param display helpers ──────────────────────────────────────────────────

type Param = { key: string; val: string; wide?: boolean; muted?: boolean }

function SectionCard({ title, params }: { title: string; params: Param[] }) {
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
    >
      <div
        className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--aka-gray-500)', borderBottom: '1px solid var(--aka-gray-100)' }}
      >
        {title}
      </div>
      <div className="p-4 grid grid-cols-2 gap-x-6">
        {params.map(p => (
          <div
            key={p.key}
            className={`py-2 ${p.wide ? 'col-span-2' : ''}`}
            style={{ borderBottom: '1px solid var(--aka-gray-50)' }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--aka-gray-400)' }}>
              {p.key}
            </div>
            <div
              className="text-[14px] font-bold leading-snug"
              style={{ color: p.muted ? 'var(--aka-gray-400)' : 'var(--aka-gray-800)', fontStyle: p.muted ? 'italic' : 'normal', fontWeight: p.muted ? 400 : 700 }}
            >
              {p.val}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const ISL_LABELS: Record<string, string> = {
  'fixed':       'Fixed',
  'normal-10':   'Normal ±10%',
  'normal-25':   'Normal ±25%',
  'exponential': 'Exponential',
  'synthetic':   'Synthetic (GenAI-Perf)',
}

function buildSections(job: JobDetail): { title: string; params: Param[] }[] {
  const engineLabel  = job.engine === 'trt-llm' ? 'TensorRT-LLM' : job.engine === 'sglang' ? 'SGLang' : 'vLLM'
  const quantLabel   = job.quantisation?.toUpperCase() ?? '—'
  const vram         = GPU_VRAM[job.gpuId] ?? '?'
  const memUtilPct   = `${Math.round(job.gpuMemoryUtil * 100)}%`
  const islLabel     = ISL_LABELS[job.islDistribution] ?? job.islDistribution

  const modelEngine: Param[] = [
    { key: 'Model',        val: job.modelId,   wide: true },
    { key: 'Engine',       val: engineLabel },
    { key: 'Quantisation', val: quantLabel },
    { key: 'dtype',        val: job.dtype },
  ]

  const hardware: Param[] = [
    { key: 'GPU', val: `${job.gpuName} · ${vram} GB VRAM`, wide: true },
  ]

  const loadProfile: Param[] = [
    {
      key: job.concurrencyLevels && job.concurrencyLevels.length > 0 ? 'Sweep Levels' : 'Virtual Users',
      val: job.concurrencyLevels && job.concurrencyLevels.length > 0
        ? job.concurrencyLevels.join(', ')
        : String(job.concurrency),
    },
    {
      key: 'Request Count',
      val: job.concurrencyLevels && job.concurrencyLevels.length > 0
        ? '10× virtual users per level'
        : String(job.requestCount),
    },
    { key: 'Input Seq. Length',   val: `${job.inputTokensMean} tokens` },
    { key: 'Output Seq. Length',  val: `${job.outputTokensMean} tokens` },
    { key: 'ISL Distribution',    val: islLabel,              wide: true },
  ]

  const engineTuning: Param[] =
    job.engine === 'trt-llm'
      ? [
          { key: 'Batch Scheduler',     val: job.batchScheduler === 'inflight' ? 'In-flight batching' : 'Static batching' },
          { key: 'Max Model Length',    val: `${job.maxModelLen} tokens` },
          { key: 'Max Batch Size',      val: String(job.maxBatchSize) },
          { key: 'KV Cache dtype',      val: job.kvCacheDtype },
          { key: 'GPU Mem Utilisation', val: memUtilPct },
          { key: 'CUDA Graphs',         val: job.cudaGraphs ? 'Enabled' : 'Disabled' },
        ]
      : job.engine === 'sglang'
      ? [
          { key: 'Context Length',         val: `${job.maxModelLen} tokens` },
          { key: 'Max Running Requests',   val: String(job.maxBatchSize) },
          { key: 'KV Cache dtype',         val: job.kvCacheDtype },
          { key: 'Mem Fraction Static',    val: memUtilPct },
          { key: 'Chunked Prefill',        val: job.chunkedPrefill ? 'Enabled (512 tokens)' : 'Disabled' },
        ]
      : [
          { key: 'Max Model Length',    val: `${job.maxModelLen} tokens` },
          { key: 'Max Batch Size',      val: String(job.maxBatchSize) },
          { key: 'KV Cache dtype',      val: job.kvCacheDtype },
          { key: 'GPU Mem Utilisation', val: memUtilPct },
          { key: 'Prefix Caching',      val: job.prefixCaching ? 'Enabled' : 'Disabled' },
          { key: 'Chunked Prefill',     val: job.chunkedPrefill ? 'Enabled' : 'Disabled' },
          { key: 'Flash Attention 2',   val: job.flashAttention ? 'Enabled' : 'Disabled' },
        ]

  return [
    { title: 'Model & Engine',             params: modelEngine },
    { title: 'Hardware',                   params: hardware },
    { title: 'Load Profile',               params: loadProfile },
    { title: `Engine Tuning — ${engineLabel}`, params: engineTuning },
  ]
}

// ── Logs viewer ───────────────────────────────────────────────────────────────

type LogContainer = 'engine' | 'aiperf'

function LogsViewer({ jobId, engineLabel }: { jobId: string; engineLabel: string }) {
  const [tab, setTab] = useState<LogContainer>('engine')
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const { data, isLoading } = useSWR<{ content: string | null; available: boolean; message?: string }>(
    `/api/jobs/${jobId}/logs?container=${tab}`, fetcher,
  )

  useEffect(() => {
    if (preRef.current && data?.content)
      preRef.current.scrollTop = preRef.current.scrollHeight
  }, [data?.content, tab])

  function handleCopy() {
    if (!data?.content) return
    navigator.clipboard.writeText(data.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="overflow-hidden rounded-lg"
         style={{ background: '#2b2f36', border: '1px solid #444c56', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
           style={{ borderBottom: '1px solid #444c56', background: '#323840' }}>
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: '#8b949e' }}>
            Logs
          </span>
          <div className="flex gap-1">
            {(['engine', 'aiperf'] as LogContainer[]).map(c => (
              <button key={c} onClick={() => setTab(c)}
                className="px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer"
                style={{
                  background: tab === c ? 'rgba(0,155,222,0.2)' : 'transparent',
                  color:      tab === c ? 'var(--aka-blue)' : '#8b949e',
                  border:     `1px solid ${tab === c ? 'rgba(0,155,222,0.3)' : 'transparent'}`,
                }}>
                {c === 'engine' ? engineLabel.toLowerCase() : 'aiperf'}
              </button>
            ))}
          </div>
        </div>
        <button onClick={handleCopy}
          className="rounded px-[9px] py-[3px] text-[11px] font-semibold cursor-pointer"
          style={{
            background: copied ? 'rgba(74,222,128,0.1)' : 'transparent',
            border:     `1px solid ${copied ? '#4ade80' : '#444c56'}`,
            color:      copied ? '#4ade80' : '#8b949e',
          }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {/* Log body */}
      <div className="p-4">
        {isLoading && !data ? (
          <p className="text-[12px]" style={{ color: '#8b949e' }}>Loading…</p>
        ) : !data?.available ? (
          <p className="text-[12px]" style={{ color: '#8b949e' }}>{data?.message ?? 'Logs not available.'}</p>
        ) : (
          <pre ref={preRef}
               className="text-[12px] leading-relaxed overflow-x-auto whitespace-pre-wrap"
               style={{ color: '#cdd9e5', fontFamily: "'SFMono-Regular', Consolas, monospace",
                        maxHeight: '500px', overflowY: 'auto' }}>
            {data.content || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromReport = searchParams.get('from') === 'report'
  const { data: job, error, isLoading } = useSWR<JobDetail>(
    id ? `/api/jobs/${id}` : null,
    fetcher,
    { refreshInterval: 5000 },
  )

  const engineLabel = job?.engine === 'trt-llm' ? 'TensorRT-LLM' : job?.engine === 'sglang' ? 'SGLang' : 'vLLM'

  // null = not yet overridden by user; derive from job status automatically
  const [userTab, setUserTab] = useState<'specs' | 'logs' | null>(null)
  const mainTab: 'specs' | 'logs' = userTab ?? (job?.status === 'failed' ? 'logs' : 'specs')

  const [deleting, setDeleting] = useState(false)
  async function handleDelete() {
    if (!job) return
    const label = `${job.modelName} (${job.id.slice(0, 8)})`
    if (!window.confirm(`Delete job "${label}"?\n\nThis will:\n• Cancel the K8s Job if still running\n• Remove job rows from the database\n\nThe report (if any) and S3 result files are kept. This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Delete failed: ${body.error ?? res.statusText}`)
        setDeleting(false)
        return
      }
      router.push('/jobs')
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : 'unknown error'}`)
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--aka-gray-100)' }}>
      <TopNav active="jobs" />

      <main className="flex-1 p-6 max-w-[1400px] mx-auto w-full">
        {/* Back link */}
        <Link
          href={fromReport ? `/reports/${id}` : '/jobs'}
          className="inline-flex items-center gap-1 mb-4 text-[13px] font-semibold"
          style={{ color: 'var(--aka-gray-500)' }}
        >
          {fromReport ? '← Back to Report' : '← Back to Jobs'}
        </Link>

        {/* Loading / error states */}
        {isLoading && <Spinner />}
        {error && (
          <div className="text-[14px] py-12 text-center" style={{ color: '#991b1b' }}>Failed to load job.</div>
        )}

        {job && (
          <>
            {/* Title row */}
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[20px] font-extrabold leading-tight" style={{ color: 'var(--aka-gray-900)' }}>
                    {job.modelName}
                  </h1>
                  {job.concurrencyLevels && job.concurrencyLevels.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                      style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      Sweep
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--aka-gray-500)' }}>
                  {job.modelId} · {engineLabel} · {job.quantisation?.toUpperCase() ?? '—'} · {job.gpuName}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold disabled:opacity-50"
                style={{ border: '1.5px solid #fecaca', background: '#fff', color: '#991b1b', cursor: deleting ? 'wait' : 'pointer' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
                </svg>
                {deleting ? 'Deleting…' : 'Delete Job'}
              </button>
            </div>

            {/* Two-column layout */}
            <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr', alignItems: 'start' }}>

              {/* Sidebar */}
              <div className="flex flex-col gap-3">

                {/* Job Info */}
                <div
                  className="overflow-hidden rounded-lg"
                  style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                  <div
                    className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--aka-gray-500)', borderBottom: '1px solid var(--aka-gray-100)' }}
                  >
                    Job Info
                  </div>
                  <div className="px-4 py-3">
                    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                      <tbody>
                        {[
                          { label: 'Status',       content: <StatusChip status={job.status} /> },
                          { label: 'Job ID',        content: (
                            <span style={{ fontFamily: "'SFMono-Regular', Consolas, monospace", fontSize: '12px', wordBreak: 'break-all', color: 'var(--aka-gray-700)' }}>
                              {job.id}
                            </span>
                          )},
                          { label: 'Submitted by',  content: job.submittedBy },
                          { label: 'Submitted',     content: formatRelative(job.submittedAt) },
                          ...(job.completedAt ? [{ label: 'Completed', content: formatRelative(job.completedAt) }] : []),
                        ].map(row => (
                          <tr key={row.label} style={{ borderTop: '1px solid var(--aka-gray-50)' }}>
                            <td className="py-2 text-[12px] pr-3 align-top" style={{ color: 'var(--aka-gray-400)', width: '88px' }}>
                              {row.label}
                            </td>
                            <td className="py-2 text-[13px] font-semibold align-top" style={{ color: 'var(--aka-gray-800)' }}>
                              {row.content}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Artifacts */}
                <div
                  className="overflow-hidden rounded-lg"
                  style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                  <div
                    className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--aka-gray-500)', borderBottom: '1px solid var(--aka-gray-100)' }}
                  >
                    Artifacts
                  </div>
                  {job.status === 'complete' ? (
                    <div className="px-3 py-3 flex flex-col gap-2">
                      {DOWNLOAD_FILES.map(f => (
                        <DownloadButton
                          key={f.key}
                          jobId={job.id}
                          file={f.key}
                          label={f.label}
                          description={f.description}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 flex flex-col gap-2">
                      {DOWNLOAD_FILES.map(f => (
                        <div
                          key={f.key}
                          className="flex items-center justify-between rounded-md px-3 py-2"
                          style={{ background: 'var(--aka-gray-50)', border: '1px solid var(--aka-gray-200)' }}
                        >
                          <div>
                            <div className="text-[13px] font-semibold" style={{ color: 'var(--aka-gray-400)' }}>{f.label}</div>
                            <div className="text-[11px]" style={{ color: 'var(--aka-gray-300)' }}>{f.description}</div>
                          </div>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--aka-gray-300)', flexShrink: 0 }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </div>
                      ))}
                      <p className="text-[11px] text-center pt-1" style={{ color: 'var(--aka-gray-300)' }}>
                        Available once the benchmark completes
                      </p>
                    </div>
                  )}
                </div>

                {/* View Report — only for completed jobs */}
                {job.status === 'complete' && (
                  <Link
                    href={`/reports/${job.id}?from=jobs`}
                    className="w-full rounded-lg py-2.5 text-[13px] font-bold flex items-center justify-center"
                    style={{
                      border: '1.5px solid var(--aka-blue)',
                      background: 'var(--aka-light)',
                      color: 'var(--aka-blue)',
                    }}
                  >
                    View Report
                  </Link>
                )}

              </div>

              {/* Main — 2-tab layout */}
              <div className="flex flex-col" style={{ minWidth: 0 }}>
                {/* Tab bar */}
                <div className="flex mb-[14px]" style={{ borderBottom: '1px solid var(--aka-gray-200)' }}>
                  {(['specs', 'logs'] as const).map(t => {
                    const logsEnabled = job.status === 'complete' || job.status === 'failed'
                    const disabled = t === 'logs' && !logsEnabled
                    const active = mainTab === t
                    return (
                      <div key={t}
                        onClick={() => !disabled && setUserTab(t)}
                        className="px-[18px] py-2 text-[12px]"
                        style={{
                          cursor:       disabled ? 'default' : 'pointer',
                          fontWeight:   active ? 600 : 500,
                          color:        disabled ? 'var(--aka-gray-300)' : active ? 'var(--aka-blue)' : 'var(--aka-gray-500)',
                          borderBottom: `2px solid ${active ? 'var(--aka-blue)' : 'transparent'}`,
                          marginBottom: '-1px',
                        }}>
                        {t === 'specs' ? 'Specifications' : 'Logs'}
                      </div>
                    )
                  })}
                </div>

                {/* Specifications panel */}
                {mainTab === 'specs' && (
                  <div className="flex flex-col gap-3">
                    {buildSections(job).map(section => (
                      <SectionCard key={section.title} title={section.title} params={section.params} />
                    ))}
                  </div>
                )}

                {/* Logs panel */}
                {mainTab === 'logs' && (
                  <LogsViewer jobId={job.id} engineLabel={engineLabel} />
                )}
              </div>

            </div>
          </>
        )}
      </main>
    </div>
  )
}
