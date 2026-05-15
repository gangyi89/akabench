'use client'

import { useBenchmarkStore } from '@/store/benchmarkStore'
import QuantChip from '@/components/shared/QuantChip'
import type { EngineType, QuantType } from '@/lib/catalogue/types'

const ALL_QUANTS: QuantType[] = ['bf16', 'fp8', 'nvfp4']

const PANEL_STYLE = {
  background: '#fff',
  borderRadius: '8px',
  border: '1px solid var(--aka-gray-200)',
  boxShadow: '0 1px 2px rgba(0,0,0,.05)',
}

const HEADER_STYLE = {
  borderBottom: '1px solid var(--aka-gray-100)',
}

const SECTION_LABEL_STYLE = {
  fontSize: '12px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--aka-gray-500)',
  marginBottom: '8px',
}

const ENGINES = [
  {
    id: 'vllm' as EngineType,
    label: '🔁 vLLM',
    desc: 'Open-source PagedAttention serving.',
    bestFor: 'Best for: Throughput / concurrency story',
    disabled: false,
  },
  {
    id: 'sglang' as EngineType,
    label: '🔷 SGLang',
    desc: 'RadixAttention + FlashInfer backend.',
    bestFor: 'Best for: Shared-prefix / RAG workloads',
    disabled: false,
  },
  {
    id: 'trt-llm' as EngineType,
    label: '⚡ TensorRT-LLM',
    desc: 'NVIDIA-native compiled runtime.',
    bestFor: 'Coming soon',
    disabled: true,
  },
]

export default function EngineQuantPanel() {
  const {
    selectedModelId,
    selectedEngine,
    selectedQuant,
    deriveResult,
    isDeriving,
    setSelectedEngine,
    setSelectedQuant,
  } = useBenchmarkStore()

  const supportedQuants = deriveResult?.supportedQuants ?? []

  return (
    <div className="flex flex-col overflow-hidden" style={PANEL_STYLE}>
      {/* Header */}
      <div className="flex items-center gap-2 px-[18px] py-[14px]" style={HEADER_STYLE}>
        <span
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-white font-bold shrink-0"
          style={{ background: 'var(--aka-blue)', fontSize: '11px' }}
        >2</span>
        <span className="font-semibold" style={{ fontSize: '14px', color: 'var(--aka-gray-800)' }}>
          Engine &amp; Quantisation
        </span>
        {selectedEngine && selectedQuant && (
          <span className="ml-auto font-semibold" style={{ fontSize: '12px', color: 'var(--aka-green)' }}>
            ✓ {selectedEngine === 'trt-llm' ? 'TensorRT-LLM' : selectedEngine === 'sglang' ? 'SGLang' : 'vLLM'} · {selectedQuant.toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 p-[18px]">
        {/* Engine cards */}
        <div>
          <div style={SECTION_LABEL_STYLE}>Engine</div>
          <div className="grid grid-cols-3 gap-2">
            {ENGINES.map((engine) => {
              const isSelected = !engine.disabled && !!selectedModelId && selectedEngine === engine.id

              return (
                <button
                  key={engine.id}
                  type="button"
                  disabled={engine.disabled}
                  onClick={() => !engine.disabled && setSelectedEngine(engine.id)}
                  className="text-left rounded-md p-3 transition-colors"
                  style={{
                    border: isSelected
                      ? '2px solid var(--aka-blue)'
                      : '2px solid var(--aka-gray-200)',
                    background: isSelected ? 'var(--aka-light)' : '#fff',
                    opacity: engine.disabled ? 0.4 : 1,
                    cursor: engine.disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div className="font-bold" style={{ fontSize: '13px', color: 'var(--aka-gray-800)' }}>
                    {engine.label}
                  </div>
                  <div className="mt-1 leading-snug" style={{ fontSize: '12px', color: 'var(--aka-gray-500)' }}>
                    {engine.desc}
                  </div>
                  <div
                    className="mt-1.5 font-medium"
                    style={{ fontSize: '11px', color: engine.disabled ? 'var(--aka-gray-400)' : 'var(--aka-blue)' }}
                  >
                    {engine.bestFor}
                  </div>
                </button>
              )
            })}
          </div>

        </div>

        {/* Quantisation chips */}
        <div>
          <div style={SECTION_LABEL_STYLE}>Quantisation</div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_QUANTS.map((q) => {
              const isSupported = !selectedModelId || supportedQuants.includes(q)
              const isDisabled = !isSupported || isDeriving
              return (
                <QuantChip
                  key={q}
                  quant={q}
                  selected={selectedQuant === q}
                  disabled={isDisabled}
                  onClick={() => setSelectedQuant(q)}
                />
              )
            })}
          </div>

        </div>

      </div>
    </div>
  )
}
