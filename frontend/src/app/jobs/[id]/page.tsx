'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import TopNav from '@/components/shared/TopNav'
import Spinner from '@/components/shared/Spinner'
import ActionsMenu, { type ActionItem } from '@/components/shared/ActionsMenu'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
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
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)  return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr  = Math.floor(min / 60)
  return min % 60 === 0 ? `${hr}h` : `${hr}h ${min % 60}m`
}

// ── Download helpers ───────────────────────────────────────────────────────

type DownloadFile = 'aiperf' | 'dcgm'

const DOWNLOAD_FILES: { key: DownloadFile; label: string; description: string }[] = [
  { key: 'aiperf', label: 'AIPerf Results',  description: 'aiperf.json' },
  { key: 'dcgm',   label: 'GPU Metrics',     description: 'dcgm_metrics.json' },
]

async function triggerDownload(jobId: string, file: DownloadFile, label: string) {
  try {
    const res = await fetch(`/api/jobs/${jobId}/report?file=${file}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(`Download failed for ${label}: ${body.error ?? res.statusText}`)
      return
    }
    const { url } = await res.json()
    // Open the presigned URL in the same tab — browser triggers file download
    // because the S3 response sets Content-Disposition: attachment.
    window.location.href = url
  } catch (err) {
    alert(`Download failed for ${label}: ${err instanceof Error ? err.message : 'unknown error'}`)
  }
}

const DOWNLOAD_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const TRASH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
  </svg>
)

// ── Inline meta icons (stroke-only, sized to match 13px text) ──────────────

const ICON_ID = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10v4M10 10v4M14 10v4M18 10v4" />
  </svg>
)
const ICON_USER = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)
const ICON_CLOCK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)
const ICON_CHECK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

// ── Copy-to-clipboard button (compact, used inline with metadata) ──────────

function CopyButton({ value, ariaLabel = 'Copy to clipboard' }: { value: string; ariaLabel?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied!' : ariaLabel}
      aria-label={copied ? 'Copied' : ariaLabel}
      className="inline-flex items-center justify-center rounded transition-colors"
      style={{
        width: '20px', height: '20px',
        color: copied ? 'var(--aka-blue)' : 'var(--aka-gray-400)',
        background: 'transparent',
      }}
      onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--aka-gray-100)' }}
      onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

// ── Job meta strip (inline icons + values, no card border) ─────────────────

function JobMetaStrip({ job }: { job: JobDetail }) {
  const shortId = `${job.id.slice(0, 8)}…${job.id.slice(-4)}`
  const completedFragment = job.completedAt
    ? `Completed ${formatRelative(job.completedAt)} (ran ${formatDuration(job.submittedAt, job.completedAt)})`
    : null

  return (
    <div
      className="mb-5 pb-5 flex items-center flex-wrap gap-x-6 gap-y-2 text-[13px]"
      style={{ borderBottom: '1px solid var(--aka-gray-200)', color: 'var(--aka-gray-600)' }}
    >
      <span className="inline-flex items-center gap-1.5" title={job.id}>
        <span style={{ color: 'var(--aka-gray-400)' }}>{ICON_ID}</span>
        <code style={{ fontFamily: "'SFMono-Regular', Consolas, monospace", fontSize: '12px', color: 'var(--aka-gray-700)' }}>
          {shortId}
        </code>
        <CopyButton value={job.id} ariaLabel="Copy job ID" />
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span style={{ color: 'var(--aka-gray-400)' }}>{ICON_USER}</span>
        {job.submittedBy}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span style={{ color: 'var(--aka-gray-400)' }}>{ICON_CLOCK}</span>
        Submitted {formatRelative(job.submittedAt)}
      </span>
      {completedFragment && (
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: 'var(--aka-green, #16a34a)' }}>{ICON_CHECK}</span>
          {completedFragment}
        </span>
      )}
    </div>
  )
}

// ── Spec card — single card with sectioned content ─────────────────────────

type Param = { key: string; val: string; wide?: boolean; muted?: boolean }
type Section = { title: string; params: Param[] }

function SpecsCard({ sections }: { sections: Section[] }) {
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
    >
      {sections.map((section, i) => (
        <div key={section.title}>
          {i > 0 && <div style={{ height: 1, background: 'var(--aka-gray-100)' }} />}
          <div className="px-6 py-5">
            <div className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--aka-gray-500)' }}>
              {section.title}
            </div>
            <div className="grid grid-cols-4 gap-x-6 gap-y-5">
              {section.params.map(p => (
                <div key={p.key} className={p.wide ? 'col-span-4' : ''}>
                  <div className="text-[12px] font-medium mb-1" style={{ color: 'var(--aka-gray-400)' }}>
                    {p.key}
                  </div>
                  <div
                    className="text-[14px] leading-snug"
                    style={{
                      color: p.muted ? 'var(--aka-gray-400)' : 'var(--aka-gray-900)',
                      fontStyle: p.muted ? 'italic' : 'normal',
                      fontWeight: p.muted ? 400 : 600,
                      wordBreak: 'break-word',
                    }}
                  >
                    {p.val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
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
    ...(job.engineImage ? [{ key: 'Engine image', val: job.engineImage, wide: true }] : []),
  ]

  const hardware: Param[] = [
    { key: 'GPU',   val: job.gpuName },
    { key: 'VRAM',  val: `${vram} GB` },
    { key: 'Count', val: '1' },
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

  const [confirmOpen, setConfirmOpen] = useState(false)

  async function performDelete() {
    if (!job) return
    const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? res.statusText)
    }
    router.push('/jobs?deleted=1')
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
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-[20px] font-extrabold leading-tight" style={{ color: 'var(--aka-gray-900)' }}>
                    {job.modelName}
                  </h1>
                  <StatusChip status={job.status} />
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
                  {engineLabel} · {job.quantisation?.toUpperCase() ?? '—'} · {job.gpuName}
                  {job.concurrencyLevels && job.concurrencyLevels.length > 0
                    ? <> · sweep [{job.concurrencyLevels.join(', ')}]</>
                    : <> · {job.concurrency} VUs · {job.requestCount} reqs</>
                  }
                </p>
              </div>

              {/* Action toolbar — overflow menu for downloads + delete,
                  standalone primary CTA for "View Report". */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <ActionsMenu
                  items={[
                    ...(job.status === 'complete'
                      ? DOWNLOAD_FILES.flatMap<ActionItem>(f => [{
                          type: 'item',
                          label: `Download ${f.label}`,
                          icon: DOWNLOAD_ICON,
                          onClick: () => { void triggerDownload(job.id, f.key, f.label) },
                        }])
                      : []),
                    ...(job.status === 'complete' ? [{ type: 'divider' as const }] : []),
                    {
                      type: 'item',
                      label: 'Delete job',
                      icon: TRASH_ICON,
                      variant: 'destructive',
                      onClick: () => setConfirmOpen(true),
                    },
                  ]}
                />
                {job.status === 'complete' && (
                  <Link
                    href={`/reports/${job.id}?from=jobs`}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold text-white"
                    style={{ background: 'var(--aka-blue)', boxShadow: '0 2px 8px rgba(0,155,222,0.3)' }}
                  >
                    View Report
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>
                )}
              </div>
            </div>

            {/* Compact inline metadata strip — Job ID, submitter, timings */}
            <JobMetaStrip job={job} />

            {/* Single-column main content — tabs + specs/logs panel */}
            <div className="flex flex-col gap-4" style={{ minWidth: 0 }}>

              {/* Tab bar */}
              <div className="flex" style={{ borderBottom: '1px solid var(--aka-gray-200)' }}>
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

              {/* Specifications panel — single card with sectioned content */}
              {mainTab === 'specs' && (
                <SpecsCard sections={buildSections(job)} />
              )}

              {/* Logs panel */}
              {mainTab === 'logs' && (
                <LogsViewer jobId={job.id} engineLabel={engineLabel} />
              )}

            </div>
          </>
        )}
      </main>

      {job && (
        <ConfirmDialog
          open={confirmOpen}
          variant="destructive"
          title="Delete this job?"
          description={
            <>Deleting <strong>{job.modelName}</strong> ({job.id.slice(0, 8)}…). This cannot be undone.</>
          }
          consequences={[
            'Cancels the K8s Job if it is still running.',
            'Removes the job rows from the database.',
            'The report (if any) and S3 result files are kept.',
          ]}
          confirmLabel="Delete job"
          onConfirm={performDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
