'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import TopNav from '@/components/shared/TopNav'
import EngineBadge from '@/components/shared/EngineBadge'
import Spinner from '@/components/shared/Spinner'
import ActionsMenu, { type ActionItem } from '@/components/shared/ActionsMenu'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import type { ReportData, AiperfMetric, DcgmMetricStats } from '@/lib/catalogue/types'
import LatencyThroughputChart from '@/components/shared/LatencyThroughputChart'

const fetcher = (url: string) => fetch(url).then(async r => {
  const json = await r.json()
  if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`)
  return json
})

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(val: number | undefined, decimals = 2): string {
  if (val === undefined || val === null) return '—'
  return val.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      data-print-card
      className={`rounded-lg overflow-hidden ${className}`}
      style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
    >
      {children}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider"
      style={{ color: 'var(--aka-gray-500)', borderBottom: '1px solid var(--aka-gray-100)' }}
    >
      {children}
    </div>
  )
}

function HeadlineStat({ label, value, unit, sub }: { label: string; value: string; unit: string; sub?: string }) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-1"
      style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--aka-gray-400)' }}>
        {label}
      </div>
      <div className="text-[24px] font-extrabold leading-none" style={{ color: 'var(--aka-gray-900)' }}>
        {value}
      </div>
      <div className="text-[12px]" style={{ color: 'var(--aka-gray-500)' }}>{unit}</div>
      {sub && <div className="text-[11px]" style={{ color: 'var(--aka-gray-400)' }}>{sub}</div>}
    </div>
  )
}

// ── AIPerf metrics table ──────────────────────────────────────────────────────

type AiperfRow = {
  label:     string
  metric:    AiperfMetric | undefined
  highlight: boolean
  scalar?:   boolean  // avg only, no percentile columns
}

function AiperfTable({ rows }: { rows: AiperfRow[] }) {
  const COLS: { key: string; label: string }[] = [
    { key: 'avg', label: 'avg' },
    { key: 'min', label: 'min' },
    { key: 'max', label: 'max' },
    { key: 'p99', label: 'p99' },
    { key: 'p90', label: 'p90' },
    { key: 'p50', label: 'p50' },
    { key: 'std', label: 'std' },
  ]

  const thStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'right',
    fontWeight: 600,
    fontSize: '12px',
    color: 'var(--aka-gray-500)',
    borderBottom: '2px solid var(--aka-gray-200)',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }
  const tdStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'right',
    color: 'var(--aka-gray-700)',
    whiteSpace: 'nowrap',
    fontSize: '13px',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left' }}>Metric</th>
            {COLS.map(c => <th key={c.key} style={thStyle}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.label}
              style={{ borderBottom: '1px solid var(--aka-gray-200)' }}
            >
              <td style={{ ...tdStyle, textAlign: 'left', color: 'var(--aka-gray-800)' }}>
                {row.label}
              </td>
              {COLS.map(c => {
                const val = row.metric?.[c.key] as number | undefined
                const isNA = row.scalar && c.key !== 'avg'
                return (
                  <td key={c.key} style={{ ...tdStyle, color: isNA ? 'var(--aka-gray-700)' : 'var(--aka-gray-700)' }}>
                    {isNA ? '—' : fmt(val)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── DCGM activity table ───────────────────────────────────────────────────────

type DcgmRow = { label: string; stats: DcgmMetricStats | undefined; format?: (v: number) => string }

function DcgmTable({ rows }: { rows: DcgmRow[] }) {
  const thStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'right',
    fontWeight: 600,
    fontSize: '12px',
    color: 'var(--aka-gray-500)',
    borderBottom: '2px solid var(--aka-gray-200)',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }
  const tdStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'right',
    color: 'var(--aka-gray-700)',
    whiteSpace: 'nowrap',
    fontSize: '13px',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left' }}>Metric</th>
            {['avg', 'p50', 'p95', 'peak'].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const f = row.format ?? ((v: number) => fmt(v))
            return (
              <tr key={row.label} style={{ borderBottom: '1px solid var(--aka-gray-200)' }}>
                <td style={{ ...tdStyle, textAlign: 'left', color: 'var(--aka-gray-800)' }}>{row.label}</td>
                {(['avg', 'p50', 'p95', 'peak'] as const).map(k => (
                  <td key={k} style={tdStyle}>{f(row.stats?.[k] ?? 0)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── KV row ────────────────────────────────────────────────────────────────────

function KVRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--aka-gray-50)' }}>
      <span className="text-[12px]" style={{ color: 'var(--aka-gray-400)' }}>{label}</span>
      <span className="text-[13px] font-semibold ml-4 text-right" style={{ color: 'var(--aka-gray-800)' }}>{value}</span>
    </div>
  )
}


// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from')
  const tab  = searchParams.get('tab')
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function performDelete() {
    const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? res.statusText)
    }
    router.push('/reports?deleted=1')
  }
  const backLabel = from === 'jobs' ? '← Back to Job' : '← Back to Reports'

  function handleBack() {
    if (from === 'jobs') {
      // Direct link to the originating job — no history dependence so a
      // refresh-then-back still works.
      router.push(`/jobs/${id}`)
      return
    }
    // For from=reports (default), use history-back so the listing's
    // search / engine / hardware / tab filters are preserved exactly as
    // the user left them. Fall back to /reports if there's no history
    // (e.g. user opened this report in a new tab).
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(`/reports${tab ? `?tab=${tab}` : ''}`)
    }
  }
  const { data, error, isLoading } = useSWR<ReportData>(
    id ? `/api/reports/${id}` : null,
    fetcher,
  )

  const { job, aiperf, dcgm, sweepPoints } = data ?? {}

  // Derived values
  const isTrt      = job?.engine === 'trt-llm'
  const engineLabel = isTrt ? 'TensorRT-LLM' : job?.engine === 'sglang' ? 'SGLang' : 'vLLM'
  // Extract the engine version from the image tag captured at submit time
  // (e.g. "vllm/vllm-openai:v0.21.0-cu129" → "v0.21.0").
  const engineVersion = job?.engineImage?.split(':')[1]?.split('-')[0] ?? null
  const vramUsedGb  = dcgm?.summary.vram_used_gb.peak ?? 0
  const vramTotalGb = (dcgm?.summary.vram_total_mb ?? 0) / 1024
  const vramPct     = vramTotalGb > 0 ? (vramUsedGb / vramTotalGb) * 100 : 0

  const aiperfRows: AiperfRow[] = aiperf ? [
    { label: 'Time to First Token (ms)',                      metric: aiperf.time_to_first_token,              highlight: true  },
    { label: 'Time to Second Token (ms)',                     metric: aiperf.time_to_second_token,             highlight: false },
    { label: 'Request Latency (ms)',                          metric: aiperf.request_latency,                  highlight: true  },
    { label: 'Inter Token Latency (ms)',                      metric: aiperf.inter_token_latency,              highlight: true  },
    { label: 'Output Token Throughput Per User (tok/s/user)', metric: aiperf.output_token_throughput_per_user, highlight: false },
    { label: 'Output Sequence Length (tokens)',               metric: aiperf.output_sequence_length,           highlight: false },
    { label: 'Input Sequence Length (tokens)',                metric: aiperf.input_sequence_length,            highlight: false },
    { label: 'Output Token Throughput (tok/s)',               metric: aiperf.output_token_throughput,          highlight: false, scalar: true },
    { label: 'Request Throughput (req/s)',                    metric: aiperf.request_throughput,               highlight: false, scalar: true },
    { label: 'Request Count',                                 metric: aiperf.request_count,                    highlight: false, scalar: true },
  ] : []

  const dcgmRows: DcgmRow[] = dcgm ? [
    { label: 'GPU Utilisation (%)',    stats: dcgm.summary.gpu_util_pct,     format: v => fmt(v, 1) },
    { label: 'DRAM Active (0–1)',      stats: dcgm.summary.dram_active,      format: v => fmt(v, 3) },
    { label: 'Tensor Core Active (0–1)', stats: dcgm.summary.tensor_active,  format: v => fmt(v, 3) },
    { label: 'GR Engine Active (0–1)', stats: dcgm.summary.gr_engine_active, format: v => fmt(v, 3) },
    { label: 'SM Clock (MHz)',         stats: dcgm.summary.sm_clock_mhz,     format: v => fmt(v, 0) },
    { label: 'Memory Clock (MHz)',     stats: dcgm.summary.mem_clock_mhz,    format: v => fmt(v, 0) },
  ] : []

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--aka-gray-100)' }}>
      <TopNav active="reports" />

      <main className="flex-1 p-6 max-w-[1400px] mx-auto w-full">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1 mb-4 text-[13px] font-semibold cursor-pointer bg-transparent border-0 p-0"
          style={{ color: 'var(--aka-gray-500)' }}
          data-print-hide
        >
          {backLabel}
        </button>

        {isLoading && <Spinner />}
        {error && (
          <div className="text-[14px] py-12 text-center" style={{ color: '#991b1b' }}>
            Failed to load report: {error.message}
          </div>
        )}

        {job && dcgm && (aiperf || sweepPoints) && (
          <>
            {/* Title */}
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h1 className="text-[20px] font-extrabold leading-tight" style={{ color: 'var(--aka-gray-900)' }}>
                  {job.modelName}
                </h1>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--aka-gray-500)' }}>
                  {job.modelId} · {engineLabel} · {job.quantisation?.toUpperCase() ?? '—'} · {job.gpuName}
                </p>
              </div>
              <div className="flex items-center gap-2" data-print-hide>
                <ActionsMenu
                  items={[
                    {
                      type: 'item',
                      label: 'Delete report',
                      variant: 'destructive',
                      icon: (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
                        </svg>
                      ),
                      onClick: () => setConfirmOpen(true),
                    } satisfies ActionItem,
                  ]}
                />
                <button
                  type="button"
                  onClick={() => {
                    const prev = document.title
                    document.title = `${job.modelName} — ${engineLabel} ${job.quantisation?.toUpperCase() ?? ''} · ${job.gpuName}`
                    window.print()
                    document.title = prev
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold text-white cursor-pointer"
                  style={{ background: 'var(--aka-blue)', boxShadow: '0 2px 8px rgba(0,155,222,0.3)' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  Export PDF
                </button>
              </div>
            </div>

            <div className="grid gap-4" data-print-layout style={{ gridTemplateColumns: '1fr 280px', alignItems: 'start' }}>

              {/* ── Left column ── */}
              <div className="flex flex-col gap-4">

                {/* Sweep charts — 2×2 grid */}
                {sweepPoints && sweepPoints.length >= 2 && (
                  <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--aka-gray-500)' }}>Benchmark Graphs</span>
                    <a
                      href="https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '11px', fontWeight: 600, color: 'var(--aka-blue)' }}
                    >
                      Learn more →
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-4" data-print-sweep-charts>
                    {([
                      { xKey: 'ttftAvg',       xLabel: 'TTFT avg (ms)',        title: 'TTFT vs Throughput' },
                      { xKey: 'itlAvg',        xLabel: 'ITL avg (ms)',         title: 'Inter-Token Latency vs Throughput' },
                      { xKey: 'e2eLatencyAvg', xLabel: 'E2E latency avg (ms)', title: 'E2E Latency vs Throughput' },
                      { xKey: 'tpsPerUserAvg', xLabel: 'TPS per user avg (tok/s)', title: 'TPS per User vs Total Throughput' },
                    ] as const).map(cfg => (
                      <Card key={cfg.xKey}>
                        <div className="p-4">
                          <LatencyThroughputChart points={sweepPoints} {...cfg} />
                        </div>
                      </Card>
                    ))}
                  </div>
                  </>
                )}

                {/* Headline stats — single-run only */}
                {aiperf && <div className="grid grid-cols-4 gap-3" data-print-headlines>
                  <HeadlineStat
                    label="Output Throughput"
                    value={fmt(aiperf.output_token_throughput?.avg, 1)}
                    unit="tokens / sec"
                    sub={`${fmt(aiperf.benchmark_duration?.avg, 1)} s · ${Math.round(aiperf.request_count?.avg ?? 0)} requests${job.concurrencyLevels ? ' (10× per level)' : ''}`}
                  />
                  <HeadlineStat
                    label="TTFT p50"
                    value={fmt(aiperf.time_to_first_token?.p50, 0)}
                    unit="ms"
                    sub={`p99: ${fmt(aiperf.time_to_first_token?.p99, 0)} ms`}
                  />
                  <HeadlineStat
                    label="Inter-Token Latency p50"
                    value={fmt(aiperf.inter_token_latency?.p50, 1)}
                    unit="ms / token"
                    sub={`p99: ${fmt(aiperf.inter_token_latency?.p99, 1)} ms`}
                  />
                  <HeadlineStat
                    label="Request Latency p50"
                    value={fmt(aiperf.request_latency?.p50, 0)}
                    unit="ms"
                    sub={`p99: ${fmt(aiperf.request_latency?.p99, 0)} ms`}
                  />
                </div>}

                {/* LLM Metrics table — single-run only */}
                {aiperf && <Card>
                  <div
                    className="px-4 py-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--aka-gray-500)', borderBottom: '1px solid var(--aka-gray-100)' }}
                  >
                    <span>LLM Metrics · aiperf {aiperf.aiperf_version ?? '0.19.0'}</span>
                    <a
                      href="https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '11px', fontWeight: 600, color: 'var(--aka-blue)', textTransform: 'none', letterSpacing: 'normal' }}
                    >
                      Learn more →
                    </a>
                  </div>
                  <div className="p-4">
                    <AiperfTable rows={aiperfRows} />
                  </div>
                </Card>}

                {/* GPU Activity table */}
                <Card>
                  <CardTitle>GPU Activity</CardTitle>
                  <div className="p-4">
                    <DcgmTable rows={dcgmRows} />
                    <div className="mt-3 text-[12px]" style={{ color: 'var(--aka-gray-400)' }}>
                      {dcgm.summary.sample_count} samples · 2 s interval
                    </div>
                  </div>
                </Card>

              </div>

              {/* ── Right sidebar ── */}
              <div className="flex flex-col gap-3" data-print-sidebar>

                {/* Run info */}
                <Card>
                  <CardTitle>Run Info</CardTitle>
                  <div className="px-4 py-3">
                    <KVRow label="Model"        value={<span style={{ fontSize: '12px', textAlign: 'right' }}>{job.modelId}</span>} />
                    <KVRow label="Engine"       value={<EngineBadge engine={job.engine} />} />
                    {engineVersion && <KVRow label="Engine Version" value={engineVersion} />}
                    <KVRow label="Quantisation" value={job.quantisation?.toUpperCase() ?? '—'} />
                    <KVRow label="dtype"        value={job.dtype} />
                    <KVRow label="Hardware"     value={job.gpuName} />
                    <div data-print-hide>
                      <KVRow label="Submitted by" value={job.submittedBy} />
                    </div>
                    <div data-print-hide className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--aka-gray-50)' }}>
                      <span className="text-[12px]" style={{ color: 'var(--aka-gray-400)' }}>Job ID</span>
                      <Link href={`/jobs/${job.id}?from=report`}
                        className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline whitespace-nowrap ml-4"
                        style={{ color: 'var(--aka-gray-800)' }}>
                        {job.id.split('-')[0]}
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--aka-gray-400)', flexShrink: 0 }}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                          <polyline points="15 3 21 3 21 9"/>
                          <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                      </Link>
                    </div>
                  </div>
                </Card>

                {/* Load profile */}
                <Card>
                  <CardTitle>Load Profile</CardTitle>
                  <div className="px-4 py-3">
                    {job.concurrencyLevels
                      ? <KVRow label="Sweep Levels" value={job.concurrencyLevels.join(', ')} />
                      : <KVRow label="Virtual Users"     value={String(job.concurrency)} />
                    }
                    <KVRow label="Input Seq. Length"  value={`${job.inputTokensMean} tokens`} />
                    <KVRow label="Output Seq. Length" value={`${job.outputTokensMean} tokens`} />
                    <KVRow label="ISL Distribution"   value={{
                      'fixed':       'Fixed',
                      'normal-10':   'Normal ±10%',
                      'normal-25':   'Normal ±25%',
                      'exponential': 'Exponential',
                      'synthetic':   'Synthetic',
                    }[job.islDistribution] ?? job.islDistribution} />
                  </div>
                </Card>

                {/* Engine configuration */}
                <Card>
                  <CardTitle>Engine Config — {engineLabel}{engineVersion ? ` ${engineVersion}` : ''}</CardTitle>
                  <div className="px-4 py-3">
                    <KVRow label="Max Model Length"    value={`${job.maxModelLen} tokens`} />
                    <KVRow label="Max Batch Size"      value={String(job.maxBatchSize)} />
                    <KVRow label="GPU Mem Util"        value={`${Math.round(job.gpuMemoryUtil * 100)}%`} />
                    {isTrt ? (<>
                      <KVRow label="Batch Scheduler"  value={job.batchScheduler === 'inflight' ? 'In-flight' : 'Static'} />
                      <KVRow label="CUDA Graphs"      value={job.cudaGraphs ? 'Enabled' : 'Disabled'} />
                    </>) : (<>
                      <KVRow label="Prefix Caching"   value={job.prefixCaching ? 'Enabled' : 'Disabled'} />
                      <KVRow label="Chunked Prefill"  value={job.chunkedPrefill ? 'Enabled' : 'Disabled'} />
                      <KVRow label="Flash Attention"  value={job.flashAttention ? 'Enabled' : 'Disabled'} />
                    </>)}
                  </div>
                </Card>

                {/* VRAM usage */}
                <Card>
                  <CardTitle>VRAM Usage</CardTitle>
                  <div className="px-4 py-3">
                    <div className="flex justify-between text-[13px] mb-2">
                      <span style={{ color: 'var(--aka-gray-600)' }}>
                        {fmt(vramUsedGb, 1)} GB used
                      </span>
                      <span style={{ color: 'var(--aka-gray-400)' }}>
                        {fmt(vramTotalGb, 0)} GB total
                      </span>
                    </div>
                    <div className="w-full rounded-full overflow-hidden" style={{ height: '8px', background: 'var(--aka-gray-200)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(vramPct, 100)}%`, background: 'var(--aka-blue)', transition: 'width 0.4s' }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] mt-1">
                      <span style={{ color: 'var(--aka-gray-400)' }}>Peak usage</span>
                      <span style={{ color: 'var(--aka-gray-500)' }}>{fmt(100 - vramPct, 1)}% headroom</span>
                    </div>
                  </div>
                </Card>

              </div>
            </div>
          </>
        )}
      </main>

      {job && (
        <ConfirmDialog
          open={confirmOpen}
          variant="destructive"
          title="Delete this report?"
          description={
            <>Deleting the report for <strong>{job.modelName}</strong>. This cannot be undone.</>
          }
          consequences={[
            'Removes the report row from the database.',
            `Deletes all S3 result files under ${id}/.`,
            'The original job record (if it still exists) is kept.',
          ]}
          confirmLabel="Delete report"
          onConfirm={performDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
