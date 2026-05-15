'use client'

import { useEffect, useState } from 'react'
import { useBenchmarkStore } from '@/store/benchmarkStore'
import type { GPU, CompatResult } from '@/lib/catalogue/types'

// GpuSpec kept for potential reuse — inline spec rows used in GPU cards instead

export default function HardwarePanel() {
  const {
    selectedGpuId,
    deriveResult,
    selectedModelId,
    selectedQuant,
    setSelectedGpu,
    setAvailableGpus,
  } = useBenchmarkStore()

  const [gpus, setGpus] = useState<GPU[]>([])

  useEffect(() => {
    fetch('/api/hardware')
      .then(r => r.json())
      .then(data => {
        setGpus(data.gpus)
        setAvailableGpus(data.gpus)
      })
  }, [setAvailableGpus])

  // Build a compat lookup: gpuId → CompatResult
  const compatMap = new Map<string, CompatResult>(
    (deriveResult?.compat ?? []).map(c => [c.gpuId, c])
  )

  const selectedGpuName = gpus.find(g => g.id === selectedGpuId)?.name

  // Map selected quant to the appropriate VRAM estimate and label.
  function vramForQuant(): { gb: number; label: string } | null {
    if (!deriveResult) return null
    const m = deriveResult.model
    const q = selectedQuant
    if (!q || q === 'fp16' || q === 'bf16') return { gb: m.vramFp16Gb, label: q?.toUpperCase() ?? 'FP16' }
    if (q === 'fp8' || q === 'smoothquant') return { gb: m.vramFp8Gb, label: q.toUpperCase() }
    // int4 variants and nvfp4 — use the NVFP4/INT4 estimate
    return { gb: m.vramNvfp4Gb, label: q.toUpperCase() }
  }
  const vram = vramForQuant()

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        background: '#fff',
        borderRadius: '8px',
        border: '1px solid var(--aka-gray-200)',
        boxShadow: '0 1px 2px rgba(0,0,0,.05)',
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-[18px] py-[14px]"
        style={{ borderBottom: '1px solid var(--aka-gray-100)' }}
      >
        <div className="flex items-center gap-2 font-semibold" style={{ fontSize: '14px', color: 'var(--aka-gray-800)' }}>
          <span
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-white font-bold"
            style={{ background: 'var(--aka-blue)', fontSize: '11px' }}
          >3</span>
          Hardware Selection
        </div>
        {selectedGpuId && (
          <span className="font-semibold" style={{ fontSize: '12px', color: 'var(--aka-green)' }}>
            ✓ {selectedGpuName} selected
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-[18px]">
        {/* Info banner */}
        {selectedModelId && deriveResult && (
          <div
            className="rounded-md px-3 py-2"
            style={{
              border: '1px solid rgba(245,158,11,0.35)',
              background: '#fffbeb',
              fontSize: '12px',
              color: '#92400e',
            }}
          >
            💡 {deriveResult.model.displayName} selected
            {' — '}
            {vram ? <><strong>{vram.gb} GB</strong> VRAM required at {vram.label}.</> : null}
            {deriveResult.compatWarning && (
              <span className="ml-1" style={{ color: 'var(--aka-amber)' }}>{deriveResult.compatWarning}</span>
            )}
          </div>
        )}

        {/* GPU cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {gpus.map((gpu) => {
            const compat = compatMap.get(gpu.id)
            const isSelected = selectedGpuId === gpu.id

            // Determine fit status — if a quant is selected, check that quant's VRAM;
            // otherwise fall back to "nothing fits at all"
            const isIncompatible = selectedModelId && compat && (
              selectedQuant && vram
                ? vram.gb > gpu.vramGb
                : !compat.fitsFp16 && !compat.fitsFp8 && !compat.fitsNvfp4
            )

            return (
              <button
                key={gpu.id}
                type="button"
                onClick={() => setSelectedGpu(gpu.id)}
                disabled={!!isIncompatible}
                className="relative text-left rounded-md p-[14px] transition-colors"
                style={{
                  border: isSelected
                    ? '2px solid var(--aka-blue)'
                    : '2px solid var(--aka-gray-200)',
                  background: isSelected ? 'var(--aka-light)' : '#fff',
                  opacity: isIncompatible ? 0.45 : 1,
                  cursor: isIncompatible ? 'not-allowed' : 'pointer',
                }}
              >
                {/* Incompatible badge */}
                {isIncompatible && (
                  <span
                    className="absolute top-2 right-2 font-bold uppercase tracking-wider rounded px-1.5 py-px"
                    style={{ fontSize: '9px', color: 'var(--aka-red)', background: '#fee2e2', border: '1px solid #fca5a5' }}
                  >
                    Too small
                  </span>
                )}

                {/* Selected checkmark */}
                {isSelected && !isIncompatible && (
                  <span
                    className="absolute top-2 right-2 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-white font-bold"
                    style={{ background: 'var(--aka-blue)', fontSize: '11px' }}
                  >✓</span>
                )}

                <div className="font-bold mb-2 pr-8" style={{ fontSize: '14px', color: 'var(--aka-gray-800)' }}>
                  {gpu.name}
                </div>

                <div className="flex flex-col gap-1">
                  {[
                    { label: 'VRAM',    value: `${gpu.vramGb} GB` },
                    { label: 'BF16',    value: `${gpu.bf16Tflops} TFLOPS` },
                    {
                      label: 'Max model',
                      value: selectedModelId && compat
                        ? compat.fitsFp16 ? 'FP16 fits ✓'
                        : compat.fitsFp8 ? 'FP8 fits ✓'
                        : compat.fitsNvfp4 ? 'NVFP4 only'
                        : 'Does not fit ✗'
                        : `${gpu.vramGb} GB`,
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between" style={{ fontSize: '13px' }}>
                      <span style={{ color: 'var(--aka-gray-500)' }}>{label}</span>
                      <span className="font-semibold" style={{ color: 'var(--aka-gray-700)' }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {gpu.tensorCoreCaps.includes('fp4') && (
                    <span
                      className="inline-block rounded font-semibold px-1.5 py-px"
                      style={{ fontSize: '11px', background: 'rgba(0,155,222,.12)', color: 'var(--aka-blue)' }}
                    >
                      NVFP4 capable · Large models
                    </span>
                  )}
                  {!gpu.tensorCoreCaps.includes('fp4') && (
                    <span
                      className="inline-block rounded font-semibold px-1.5 py-px"
                      style={{ fontSize: '11px', background: 'var(--aka-gray-100)', color: 'var(--aka-gray-600)' }}
                    >
                      {gpu.targetWorkload}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {gpus.length === 0 && (
          <p className="py-4 text-center" style={{ fontSize: '12px', color: 'var(--aka-gray-400)' }}>Loading hardware…</p>
        )}
      </div>
    </div>
  )
}
