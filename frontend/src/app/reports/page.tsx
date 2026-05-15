'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useMemo, Suspense } from 'react'
import useSWR from 'swr'
import TopNav from '@/components/shared/TopNav'
import EngineBadge from '@/components/shared/EngineBadge'
import type { ReportListItem } from '@/lib/catalogue/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const HEADERS = ['Model', 'Engine', 'Quant', 'Hardware', 'Requests', 'Submitted by', 'Completed', '']

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
                  width: j === 0 ? '160px' : j === cols - 1 ? '48px' : '90px',
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-md text-[13px] px-3 py-1.5 pr-7 cursor-pointer appearance-none"
      style={{
        border: '1px solid var(--aka-gray-200)',
        background: '#fff',
        color: value ? 'var(--aka-gray-800)' : 'var(--aka-gray-400)',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function ReportsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data, error } = useSWR<{ reports: ReportListItem[] }>('/api/reports', fetcher, {
    keepPreviousData: true,
  })

  const [activeTab, setActiveTab] = useState<'individual' | 'sweep'>(
    searchParams.get('tab') === 'sweep' ? 'sweep' : 'individual'
  )

  function switchTab(tab: 'individual' | 'sweep') {
    setActiveTab(tab)
    router.replace(`/reports?tab=${tab}`, { scroll: false })
  }
  const [search,  setSearch]  = useState('')
  const [engine,  setEngine]  = useState('')
  const [hardware, setHardware] = useState('')

  const allReports = useMemo(() => data?.reports ?? [], [data?.reports])

  // Build filter options from actual data
  const engineOptions = useMemo(() => {
    const seen = new Set<string>()
    return allReports
      .filter(r => { if (seen.has(r.engine)) return false; seen.add(r.engine); return true })
      .map(r => ({ value: r.engine, label: r.engine === 'trt-llm' ? 'TensorRT-LLM' : r.engine === 'sglang' ? 'SGLang' : 'vLLM' }))
  }, [allReports])

  const hardwareOptions = useMemo(() => {
    const seen = new Set<string>()
    return allReports
      .filter(r => { if (seen.has(r.gpuId)) return false; seen.add(r.gpuId); return true })
      .map(r => ({ value: r.gpuId, label: r.gpuName }))
  }, [allReports])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allReports.filter(r => {
      if (engine   && r.engine  !== engine)   return false
      if (hardware && r.gpuId   !== hardware) return false
      if (q && !r.modelName.toLowerCase().includes(q) && !r.modelId.toLowerCase().includes(q)) return false
      return true
    })
  }, [allReports, search, engine, hardware])

  const filteredSingle = filtered.filter(r => !r.concurrencyLevels)
  const filteredSweep  = filtered.filter(r =>  r.concurrencyLevels)

  const hasFilters = search || engine || hardware

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--aka-gray-100)' }}>
      <TopNav active="reports" />

      <main className="flex-1 p-6 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[16px] font-bold" style={{ color: 'var(--aka-gray-800)' }}>Reports</h1>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--aka-gray-400)' }}>
              {!data
                ? '\u00A0'
                : `${filteredSingle.length} single run · ${filteredSweep.length} sweep`
              }
            </p>
          </div>

          {/* Search + filters */}
          {data && allReports.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ color: 'var(--aka-gray-400)' }}
                >
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search model…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="rounded-md text-[13px] pl-8 pr-3 py-1.5 w-48"
                  style={{
                    border: '1px solid var(--aka-gray-200)',
                    background: '#fff',
                    color: 'var(--aka-gray-800)',
                    outline: 'none',
                  }}
                />
              </div>
              <FilterSelect
                value={engine}
                onChange={setEngine}
                options={engineOptions}
                placeholder="All engines"
              />
              <FilterSelect
                value={hardware}
                onChange={setHardware}
                options={hardwareOptions}
                placeholder="All hardware"
              />
              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setEngine(''); setHardware('') }}
                  className="text-[12px] font-semibold px-2 py-1.5 rounded"
                  style={{ color: 'var(--aka-gray-400)' }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="px-4 py-12 text-center text-[14px]" style={{ color: '#991b1b' }}>
            Failed to load reports.
          </div>
        )}

        {!error && (
          <>
            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--aka-gray-200)', marginBottom: '20px' }}>
              {([
                { key: 'individual' as const, label: 'Single Run', count: filteredSingle.length },
                { key: 'sweep'      as const, label: 'Sweep',      count: filteredSweep.length  },
              ]).map(tab => {
                const active = activeTab === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => switchTab(tab.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '8px 16px', fontSize: '13px',
                      fontWeight: active ? 600 : 500,
                      color: active ? 'var(--aka-blue)' : 'var(--aka-gray-500)',
                      borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                      borderBottom: `2px solid ${active ? 'var(--aka-blue)' : 'transparent'}`,
                      marginBottom: '-1px', background: 'none', cursor: 'pointer',
                      transition: 'all .15s',
                    }}
                  >
                    {tab.label}
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '1px 6px', borderRadius: '10px',
                      background: active ? 'rgba(0,155,222,.1)' : 'var(--aka-gray-100)',
                      color: active ? 'var(--aka-blue)' : 'var(--aka-gray-400)',
                    }}>
                      {data ? tab.count : '—'}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-lg" style={{ background: '#fff', border: '1px solid var(--aka-gray-200)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--aka-gray-50)', borderBottom: '1px solid var(--aka-gray-200)' }}>
                    {HEADERS.map(h => (
                      <th key={h} className={`${h === 'Engine' ? 'pl-4 pr-2' : 'px-4'} py-2.5 text-left text-[12px] font-semibold uppercase tracking-wider`} style={{ color: 'var(--aka-gray-500)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!data ? (
                    <SkeletonRows cols={HEADERS.length} />
                  ) : allReports.length === 0 ? (
                    <tr>
                      <td colSpan={HEADERS.length} className="px-4 py-12 text-center text-[14px]" style={{ color: 'var(--aka-gray-400)' }}>
                        No completed benchmarks yet.{' '}
                        <Link href="/portal" style={{ color: 'var(--aka-blue)' }}>Run your first benchmark →</Link>
                      </td>
                    </tr>
                  ) : (() => {
                    const rows = activeTab === 'individual' ? filteredSingle : filteredSweep
                    const emptyMsg = activeTab === 'individual'
                      ? 'No single run benchmarks match your filters.'
                      : 'No sweep benchmarks match your filters.'
                    if (rows.length === 0) return (
                      <tr>
                        <td colSpan={HEADERS.length} className="px-4 py-12 text-center text-[14px]" style={{ color: 'var(--aka-gray-400)' }}>
                          {hasFilters ? emptyMsg : (activeTab === 'individual' ? 'No single run benchmarks yet.' : 'No sweep benchmarks yet.')}
                        </td>
                      </tr>
                    )
                    return rows.map((r, i) => (
                      <tr
                        key={r.jobId}
                        onClick={() => router.push(`/reports/${r.jobId}?from=reports&tab=${activeTab}`)}
                        style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--aka-gray-100)' : 'none', cursor: 'pointer' }}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--aka-gray-800)' }}>{r.modelName}</div>
                          <div className="text-[12px]" style={{ color: 'var(--aka-gray-400)' }}>{r.modelId}</div>
                        </td>
                        <td className="pl-4 pr-2 py-3">
                          <EngineBadge engine={r.engine} />
                        </td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-600)' }}>
                          {r.quantisation?.toUpperCase() ?? 'FP16'}
                        </td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-700)' }}>{r.gpuName}</td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-700)' }}>
                          {activeTab === 'sweep'
                            ? <div>{r.concurrencyLevels!.join(', ')}<br /><span style={{ color: 'var(--aka-gray-400)', fontSize: '11px' }}>10× virtual users per level</span></div>
                            : <>{r.concurrency} concurrent · {r.requestCount} reqs</>
                          }
                        </td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-600)' }}>{r.submittedBy}</td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--aka-gray-400)' }}>{formatDate(r.completedAt)}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <Link
                            href={`/reports/${r.jobId}?from=reports&tab=${activeTab}`}
                            className="rounded px-3 py-1 text-[12px] font-semibold"
                            style={{ border: '1px solid var(--aka-gray-200)', color: 'var(--aka-gray-600)', background: '#fff' }}
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsContent />
    </Suspense>
  )
}
