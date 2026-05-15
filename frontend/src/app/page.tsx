'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBenchmarkStore } from '@/store/benchmarkStore'
import TopNav from '@/components/shared/TopNav'
import ModelPanel from '@/components/panels/ModelPanel'
import EngineQuantPanel from '@/components/panels/EngineQuantPanel'
import HardwarePanel from '@/components/panels/HardwarePanel'
import TestParamsPanel from '@/components/panels/TestParamsPanel'

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  onClose,
  onConfirm,
  isSubmitting,
  error,
}: {
  onClose: () => void
  onConfirm: () => void
  isSubmitting: boolean
  error: string | null
}) {
  const { selectedModelId, selectedEngine, selectedQuant, selectedGpuId, availableGpus, deriveResult, sweepEnabled, concurrencyLevels, concurrency } = useBenchmarkStore()

  const gpuName = availableGpus.find(g => g.id === selectedGpuId)?.name ?? selectedGpuId
  const modelName = deriveResult?.model.displayName ?? selectedModelId

  const loadProfileValue = sweepEnabled
    ? `Sweep · ${concurrencyLevels.length} levels`
    : `Single run · ${concurrency} concurrent`

  const rows = [
    { label: 'Model', value: modelName },
    { label: 'Engine', value: selectedEngine === 'trt-llm' ? 'TensorRT-LLM' : selectedEngine === 'sglang' ? 'SGLang' : selectedEngine === 'vllm' ? 'vLLM' : '—' },
    { label: 'Quantisation', value: selectedQuant?.toUpperCase() ?? '—' },
    { label: 'Hardware', value: gpuName },
    { label: 'Load profile', value: loadProfileValue },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] overflow-hidden rounded-xl bg-white"
        style={{ boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--aka-gray-100)' }}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
            style={{ background: 'rgba(0,155,222,0.1)' }}
          >▶</div>
          <div>
            <div className="font-bold text-[14px]" style={{ color: 'var(--aka-gray-800)' }}>Run Benchmark?</div>
            <div className="text-[12px]" style={{ color: 'var(--aka-gray-400)' }}>Review your configuration before submitting.</div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <table className="w-full mb-4" style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {rows.map(r => (
                <tr key={r.label}>
                  <td className="py-1 text-[13px] w-28" style={{ color: 'var(--aka-gray-500)' }}>{r.label}</td>
                  <td className="py-1 text-[13px] font-semibold" style={{ color: 'var(--aka-gray-800)' }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            className="flex items-start gap-2 rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'var(--aka-gray-100)', border: '1px solid var(--aka-gray-200)', color: 'var(--aka-gray-500)' }}
          >
            ☕ This run will take few minutes — go grab a coffee.
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex flex-col gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--aka-gray-100)' }}
        >
          {error && (
            <div className="text-[12px] text-red-600 text-right">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: 'var(--aka-gray-100)', color: 'var(--aka-gray-600)', border: '1px solid var(--aka-gray-200)' }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              style={{ background: 'var(--aka-blue)' }}
            >
              {isSubmitting && (
                <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {isSubmitting ? 'Submitting…' : 'Confirm & Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sticky action bar ─────────────────────────────────────────────────────────

function ActionBar({ onRun }: { onRun: () => void }) {
  const { selectedModelId, selectedEngine, selectedQuant, selectedGpuId, deriveResult } = useBenchmarkStore()

  const steps = [
    { label: 'Model', done: !!selectedModelId },
    { label: 'Engine & Quant', done: !!deriveResult && !!selectedEngine && !!selectedQuant },
    { label: 'Hardware', done: !!selectedGpuId },
    { label: 'Parameters', done: !!selectedModelId && !!selectedEngine && !!selectedQuant && !!selectedGpuId },
  ]

  const isReady = !!selectedModelId && !!selectedEngine && !!selectedGpuId && !!selectedQuant

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6"
      style={{
        background: '#fff',
        borderTop: '1px solid var(--aka-gray-200)',
        height: '52px',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* Left spacer */}
      <div className="flex-1" />

      {/* Step progress — centred */}
      <div className="flex items-center gap-4">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2">
            {i > 0 && (
              <div style={{ width: '24px', height: '1px', background: step.done ? 'var(--aka-blue)' : 'var(--aka-gray-200)' }} />
            )}
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  background: step.done ? 'var(--aka-blue)' : 'var(--aka-gray-200)',
                  color: step.done ? '#fff' : 'var(--aka-gray-400)',
                }}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <span
                className="text-[12px] font-medium"
                style={{ color: step.done ? 'var(--aka-gray-700)' : 'var(--aka-gray-400)' }}
              >
                {step.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Right spacer + CTA */}
      <div className="flex-1 flex justify-end">
      <button
        onClick={onRun}
        disabled={!isReady}
        className="flex items-center gap-2 rounded-lg px-5 py-2 text-[14px] font-bold text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: isReady ? 'var(--aka-blue)' : 'var(--aka-gray-300)',
          boxShadow: isReady ? '0 2px 8px rgba(0,155,222,0.35)' : 'none',
          transition: 'all .15s',
        }}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
          style={{ background: 'rgba(255,255,255,0.2)' }}
        >▶</span>
        Run Benchmark
      </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [showModal, setShowModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()
  const {
    selectedModelId, selectedEngine, selectedQuant, selectedGpuId,
    concurrency, sweepEnabled, concurrencyLevels,
    requestCount, inputTokensMean, outputTokensMean,
    measurementWindow, islDistribution, backend, streaming,
    kvCacheDtype, maxModelLen, gpuMemoryUtil, maxBatchSize,
    prefixCaching, chunkedPrefill, flashAttention,
    batchScheduler, cudaGraphs,
  } = useBenchmarkStore()

  async function handleConfirm() {
    setIsSubmitting(true)
    try {
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId:           selectedModelId,
          engine:            selectedEngine,
          quantisation:      selectedQuant,
          gpuId:             selectedGpuId,
          // Load profile — sweep mode sends concurrencyLevels, single run sends concurrency
          ...(sweepEnabled ? { concurrencyLevels } : { concurrency }),
          requestCount,
          inputTokensMean,
          outputTokensMean,
          measurementWindow,
          islDistribution,
          backend,
          streaming,
          // Engine tuning — shared
          kvCacheDtype,
          maxModelLen,
          gpuMemoryUtil,
          maxBatchSize,
          // Engine tuning — vLLM
          prefixCaching,
          chunkedPrefill,
          flashAttention,
          // Engine tuning — TRT-LLM
          batchScheduler,
          cudaGraphs,
        }),
      })
    } catch {
      // fire-and-forget — navigate regardless
    }
    setTimeout(() => router.push('/jobs'), 1000)
  }

  return (
    <div className="flex flex-col min-h-screen pb-[52px]" style={{ background: 'var(--aka-gray-100)' }}>
      <TopNav active="configure" />

      {/* Panel grid */}
      <main className="flex-1 p-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
          <ModelPanel />
          <div className="flex flex-col gap-4">
            <EngineQuantPanel />
            <HardwarePanel />
          </div>
          <div className="xl:col-span-2">
            <TestParamsPanel />
          </div>
        </div>
      </main>

      {/* Sticky action bar */}
      <ActionBar onRun={() => setShowModal(true)} />

      {/* Confirmation modal */}
      {showModal && (
        <ConfirmModal
          onClose={() => setShowModal(false)}
          onConfirm={handleConfirm}
          isSubmitting={isSubmitting}
          error={null}
        />
      )}
    </div>
  )
}
