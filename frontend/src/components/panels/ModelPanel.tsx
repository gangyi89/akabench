'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useBenchmarkStore } from '@/store/benchmarkStore'
import type { SearchResultItem, DeriveResult } from '@/lib/catalogue/types'

const TAG_STYLES: Record<string, string> = {
  nvidia:  'border-[#009bde] text-[#009bde] bg-[#e8f5fd]',
  ngc:     'border-[#009bde] text-[#009bde] bg-[#e8f5fd]',
  nvfp4:   'border-[#7c3aed] text-[#7c3aed] bg-[#f5f3ff]',
  bf16:    'border-[#e5e7eb] text-[#6b7280] bg-[#f3f4f6]',
  fp8:     'border-[#e5e7eb] text-[#6b7280] bg-[#f3f4f6]',
  gated:   'border-[#f59e0b] text-[#92400e] bg-[#fffbeb]',
}

function tagStyle(tag: string) {
  return TAG_STYLES[tag] ?? 'border-[#e5e7eb] text-[#6b7280] bg-[#f3f4f6]'
}

const PANEL_STYLE = {
  background: '#fff',
  borderRadius: '8px',
  border: '1px solid var(--aka-gray-200)',
  boxShadow: '0 1px 2px rgba(0,0,0,.05)',
}

const HEADER_STYLE = {
  borderBottom: '1px solid var(--aka-gray-100)',
}

export default function ModelPanel() {
  const {
    selectedModelId,
    selectedGpuId,
    commitModel,
    setDeriveResult,
    setIsDeriving,
  } = useBenchmarkStore()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [availableFamilies, setAvailableFamilies] = useState<string[]>([])
  const [selectedFamily, setSelectedFamily] = useState<string>('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { fetchResults('') }, [])

  // Debounced auto-search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchResults(query), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Re-derive when GPU changes with a model already selected.
  // Uses setDeriveResult (not commitModel) to preserve the user's engine selection.
  useEffect(() => {
    if (!selectedModelId) return
    let cancelled = false
    async function rederive() {
      setIsDeriving(true)
      try {
        const params = new URLSearchParams({ id: selectedModelId! })
        if (selectedGpuId) params.set('gpu', selectedGpuId)
        const res = await fetch(`/api/models/derive?${params}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as DeriveResult
        setDeriveResult(data)
      } finally {
        if (!cancelled) setIsDeriving(false)
      }
    }
    rederive()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGpuId])

  async function fetchResults(q: string) {
    setIsSearching(true)
    try {
      const res = await fetch(`/api/models/search?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { results: SearchResultItem[] }
      setResults(data.results)
      // Seed the family dropdown once from the initial (unfiltered) fetch so
      // its options don't shrink as the user types in the search box.
      setAvailableFamilies(prev => {
        if (prev.length > 0) return prev
        return [...new Set(data.results.map(r => r.family))].sort()
      })
    } finally {
      setIsSearching(false)
    }
  }

  const visibleResults = selectedFamily
    ? results.filter(r => r.family === selectedFamily)
    : results

  const fetchDerive = useCallback(async (modelId: string, gpuId: string | null) => {
    setIsDeriving(true)
    try {
      const params = new URLSearchParams({ id: modelId })
      if (gpuId) params.set('gpu', gpuId)
      const res = await fetch(`/api/models/derive?${params}`)
      if (!res.ok) return
      const data = await res.json() as DeriveResult
      commitModel(modelId, data)
    } finally {
      setIsDeriving(false)
    }
  }, [commitModel, setIsDeriving])

  async function handleSelectModel(hfRepoId: string) {
    if (hfRepoId === selectedModelId) return
    // Model change clears engine + GPU in the store, so derive without a GPU
    // context — the prior selectedGpuId is about to be wiped.
    await fetchDerive(hfRepoId, null)
  }

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={PANEL_STYLE}>
      {/* Header */}
      <div className="flex items-center gap-2 px-[18px] py-[14px]" style={HEADER_STYLE}>
        <span
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-white font-bold shrink-0"
          style={{ background: 'var(--aka-blue)', fontSize: '11px' }}
        >1</span>
        <span className="font-semibold" style={{ fontSize: '14px', color: 'var(--aka-gray-800)' }}>
          Model Selection
        </span>
        {selectedModelId && (
          <span className="ml-auto font-semibold" style={{ fontSize: '12px', color: 'var(--aka-green)' }}>
            ✓ Model selected
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-[18px] flex-1 min-h-0">
        {/* Search + family filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--aka-gray-400)' }}
            >
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search models by name…"
              className="w-full rounded-md pl-8 pr-8 py-2 outline-none transition-colors"
              style={{
                fontSize: '14px',
                border: '1px solid var(--aka-blue)',
                background: '#fff',
                color: 'var(--aka-gray-700)',
                boxShadow: '0 0 0 3px rgba(0,155,222,0.1)',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--aka-blue)'
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,155,222,0.1)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--aka-gray-300)'
                e.currentTarget.style.boxShadow = 'none'
                e.currentTarget.style.background = 'var(--aka-gray-50)'
              }}
            />
            {isSearching && (
              <svg
                className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
                width="13" height="13" viewBox="0 0 24 24" fill="none"
                style={{ color: 'var(--aka-gray-400)' }}
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
          <select
            value={selectedFamily}
            onChange={e => setSelectedFamily(e.target.value)}
            className="rounded-md px-2 py-2 outline-none cursor-pointer"
            style={{
              fontSize: '13px',
              border: '1px solid var(--aka-gray-300)',
              background: selectedFamily ? 'var(--aka-light)' : '#fff',
              color: 'var(--aka-gray-700)',
              minWidth: '120px',
            }}
            title="Filter by model series"
          >
            <option value="">All series</option>
            {availableFamilies.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* Results */}
        <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5 flex-1 min-h-0 basis-0">
          {visibleResults.length === 0 && !isSearching && (
            <p className="py-4 text-center" style={{ fontSize: '12px', color: 'var(--aka-gray-400)' }}>
              No models found
            </p>
          )}
          {visibleResults.map((model) => {
            const isSelected = model.hfRepoId === selectedModelId
            return (
              <button
                key={model.hfRepoId}
                type="button"
                onClick={() => handleSelectModel(model.hfRepoId)}
                className="w-full text-left rounded-md px-3 py-2.5 transition-colors cursor-pointer"
                style={{
                  border: isSelected
                    ? '1px solid var(--aka-blue)'
                    : '1px solid var(--aka-gray-200)',
                  background: isSelected ? 'var(--aka-light)' : '#fff',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold truncate" style={{ fontSize: '13px', color: 'var(--aka-gray-800)' }}>
                        {model.hfRepoId}
                      </span>
                      <a
                        href={`https://huggingface.co/${model.hfRepoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="shrink-0"
                        style={{ color: 'var(--aka-gray-400)', lineHeight: 0 }}
                        title="Open on Hugging Face"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                          <polyline points="15 3 21 3 21 9"/>
                          <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                      </a>
                    </div>
                    <div className="mt-0.5" style={{ fontSize: '12px', color: 'var(--aka-gray-500)' }}>
                      {model.paramCountB}B params · ~{model.vramFp16Gb} GB FP16
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {model.tags.map(tag => (
                        <span
                          key={tag}
                          className={`inline-flex items-center rounded-full border px-1.5 py-px font-semibold ${tagStyle(tag)}`}
                          style={{ fontSize: '11px' }}
                        >
                          {tag.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0" style={{ fontSize: '12px' }}>
                    {model.gated && (
                      <span style={{ color: 'var(--aka-amber)' }}>⚠ HF approval required</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
