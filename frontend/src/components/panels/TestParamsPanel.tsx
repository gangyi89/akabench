'use client'

import { useState } from 'react'
import { useBenchmarkStore } from '@/store/benchmarkStore'
import type { IslDistribution, Backend } from '@/lib/catalogue/types'

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--aka-gray-500)',
        paddingTop: '4px',
      }}
    >
      {children}
    </div>
  )
}

function ParamGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {children}
    </div>
  )
}

function ParamLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--aka-gray-800)' }}>
      {children}
    </div>
  )
}

function ParamSublabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '12px', color: 'var(--aka-gray-500)' }}>
      {children}
    </div>
  )
}

function ParamHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', color: 'var(--aka-gray-400)' }}>
      {children}
    </div>
  )
}

function SliderParam({
  label,
  sublabel,
  hint,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string
  sublabel: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  display: string
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <ParamGroup>
      <ParamLabel>{label}</ParamLabel>
      <ParamSublabel>{sublabel}</ParamSublabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
        {/* Track */}
        <div style={{ flex: 1, position: 'relative', height: '20px', display: 'flex', alignItems: 'center' }}>
          {/* Rail */}
          <div style={{ position: 'absolute', left: 0, right: 0, height: '4px', background: 'var(--aka-gray-200)', borderRadius: '2px' }} />
          {/* Fill */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              height: '4px',
              width: `${pct}%`,
              background: 'var(--aka-blue)',
              borderRadius: '2px',
              pointerEvents: 'none',
            }}
          />
          {/* Thumb */}
          <div
            style={{
              position: 'absolute',
              left: `${pct}%`,
              transform: 'translateX(-50%)',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: '#fff',
              border: '2px solid var(--aka-blue)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
          {/* Native input — full hit area, invisible */}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'grab',
              zIndex: 2,
              margin: 0,
            }}
          />
        </div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--aka-gray-800)', minWidth: '48px', textAlign: 'right' }}>
          {display}
        </div>
      </div>
      {hint && <ParamHint>{hint}</ParamHint>}
    </ParamGroup>
  )
}

function SelectParam({
  label,
  sublabel,
  value,
  options,
  onChange,
}: {
  label: string
  sublabel: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <ParamGroup>
      <ParamLabel>{label}</ParamLabel>
      <ParamSublabel>{sublabel}</ParamSublabel>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          marginTop: '4px',
          width: '100%',
          fontSize: '13px',
          padding: '5px 8px',
          borderRadius: '5px',
          border: '1px solid var(--aka-gray-200)',
          background: '#fff',
          color: 'var(--aka-gray-800)',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </ParamGroup>
  )
}

function ToggleParam({
  label,
  sublabel,
  value,
  disabled,
  disabledLabel,
  hint,
  onChange,
}: {
  label: string
  sublabel: React.ReactNode
  value: boolean
  disabled?: boolean
  disabledLabel?: string
  hint?: string
  onChange?: (v: boolean) => void
}) {
  return (
    <ParamGroup>
      <ParamLabel>{label}</ParamLabel>
      <ParamSublabel>{sublabel}</ParamSublabel>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
        <span style={{
          fontSize: '12px',
          color: disabled ? 'var(--aka-gray-400)' : value ? 'var(--aka-green)' : 'var(--aka-gray-600)',
          fontWeight: disabled ? 400 : 500,
        }}>
          {disabled ? (disabledLabel ?? 'Always on') : value ? 'Enabled' : 'Disabled'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          disabled={disabled}
          onClick={() => !disabled && onChange?.(!value)}
          style={{
            width: '32px',
            height: '18px',
            borderRadius: '9px',
            border: 'none',
            background: disabled
              ? value ? 'var(--aka-blue)' : 'var(--aka-gray-300)'
              : value ? 'var(--aka-blue)' : 'var(--aka-gray-300)',
            position: 'relative',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'background .15s',
            flexShrink: 0,
          }}
        >
          <span style={{
            position: 'absolute',
            top: '2px',
            left: value ? '16px' : '2px',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .15s',
          }} />
        </button>
      </div>
      {hint && (
        <div style={{ fontSize: '11px', color: 'var(--aka-blue)', marginTop: '2px' }}>{hint}</div>
      )}
    </ParamGroup>
  )
}

const PARAM_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '20px 24px',
  paddingTop: '16px',
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function TestParamsPanel() {
  const {
    selectedEngine,
    // Load Profile
    concurrency, setConcurrency,
    sweepEnabled, setSweepEnabled,
    concurrencyLevels, setConcurrencyLevels,
    requestCount, setRequestCount,
    sweepRequestMultiplier, setSweepRequestMultiplier,
    inputTokensMean, setInputTokensMean,
    outputTokensMean, setOutputTokensMean,
    islDistribution, setIslDistribution,
    backend, setBackend,
    // Engine Tuning — shared
    kvCacheDtype, setKvCacheDtype,
    maxModelLen, setMaxModelLen,
    gpuMemoryUtil, setGpuMemoryUtil,
    maxBatchSize, setMaxBatchSize,
    // Engine Tuning — vLLM
    prefixCaching, setPrefixCaching,
    chunkedPrefill, setChunkedPrefill,
    flashAttention, setFlashAttention,
    // Engine Tuning — TRT-LLM
    batchScheduler, setBatchScheduler,
    cudaGraphs, setCudaGraphs,
  } = useBenchmarkStore()

  const [activeTab, setActiveTab] = useState<'load-profile' | 'engine-tuning'>('load-profile')
  const [sweepInput, setSweepInput] = useState('')

  // Parse and commit comma/space-separated concurrency levels from text input
  function commitSweepInput(raw: string) {
    const parsed = raw
      .split(/[\s,]+/)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n) && n >= 1 && n <= 256)
    const unique = [...new Set(parsed)].sort((a, b) => a - b)
    if (unique.length > 0) setConcurrencyLevels(unique)
    setSweepInput('')
  }

  const engineBadgeStyle: React.CSSProperties = {
    marginLeft: '6px',
    padding: '1px 6px',
    borderRadius: '3px',
    fontSize: '11px',
    fontWeight: 700,
    background: selectedEngine === 'trt-llm' ? 'rgba(0,155,222,.12)' : selectedEngine === 'sglang' ? 'rgba(251,191,36,0.15)' : selectedEngine === 'vllm' ? '#dcfce7' : 'var(--aka-gray-100)',
    color: selectedEngine === 'trt-llm' ? 'var(--aka-blue)' : selectedEngine === 'sglang' ? '#92400e' : selectedEngine === 'vllm' ? '#166534' : 'var(--aka-gray-400)',
  }

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: '8px',
        border: '1px solid var(--aka-gray-200)',
        boxShadow: '0 1px 2px rgba(0,0,0,.05)',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--aka-gray-100)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: 'var(--aka-gray-800)' }}>
          <span
            style={{
              display: 'inline-flex',
              height: '22px',
              width: '22px',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              background: 'var(--aka-blue)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >4</span>
          Test Parameters
        </div>
        <span style={{ fontSize: '12px', color: 'var(--aka-gray-400)' }}>
          Defaults pre-set for optimal benchmark results
        </span>
      </div>

      {/* Panel body */}
      <div style={{ padding: '18px 18px 22px' }}>
        {/* Tab bar — matches wireframe: underline style, full-width bottom border */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--aka-gray-200)', marginBottom: '0' }}>
          {(['load-profile', 'engine-tuning'] as const).map(tab => {
            const active = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--aka-blue)' : 'var(--aka-gray-500)',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderBottom: `2px solid ${active ? 'var(--aka-blue)' : 'transparent'}`,
                  marginBottom: '-1px',
                  background: 'none',
                  cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                {tab === 'load-profile' ? 'Load Profile' : (
                  <>
                    Engine Tuning
                    <span style={engineBadgeStyle}>
                      {selectedEngine === 'trt-llm' ? 'TensorRT-LLM' : selectedEngine === 'sglang' ? 'SGLang' : selectedEngine === 'vllm' ? 'vLLM' : '—'}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>

          {/* ── Tab: Load Profile ── */}
          {activeTab === 'load-profile' && (
            <div style={PARAM_GRID}>
              <ToggleParam
                label="Sweep"
                sublabel={<>Runs at multiple virtual user counts and plots a latency–throughput curve.{' '}
                  <a
                    href="https://docs.nvidia.com/nim/benchmarking/llm/latest/step-by-step.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--aka-blue)', textDecoration: 'underline' }}
                  >NVIDIA guide</a>
                </>}
                value={sweepEnabled}
                onChange={setSweepEnabled}
              />

              {sweepEnabled ? (
                <>
                  <ParamGroup>
                    <ParamLabel>Virtual User Steps</ParamLabel>
                    <ParamSublabel>One run per step — model loads once, each step adds a point to the graph</ParamSublabel>
                    {/* Chip list */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {concurrencyLevels.map(c => (
                        <span
                          key={c}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            background: 'rgba(0,155,222,.1)',
                            color: 'var(--aka-blue)',
                            border: '1px solid rgba(0,155,222,.25)',
                          }}
                        >
                          {c}
                          <button
                            type="button"
                            onClick={() => setConcurrencyLevels(concurrencyLevels.filter(v => v !== c))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--aka-blue)', lineHeight: 1, fontSize: '14px' }}
                            aria-label={`Remove ${c}`}
                          >×</button>
                        </span>
                      ))}
                      <input
                        type="text"
                        placeholder="Add values…"
                        value={sweepInput}
                        onChange={e => setSweepInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitSweepInput(sweepInput) } }}
                        onBlur={() => { if (sweepInput.trim()) commitSweepInput(sweepInput) }}
                        style={{
                          border: 'none',
                          outline: 'none',
                          fontSize: '12px',
                          color: 'var(--aka-gray-800)',
                          background: 'transparent',
                          width: '80px',
                        }}
                      />
                    </div>
                    {/* Preset + count */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => setConcurrencyLevels([1, 2, 5, 10, 50, 100, 250])}
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: 'var(--aka-blue)',
                          background: 'none',
                          border: '1px solid var(--aka-blue)',
                          borderRadius: '4px',
                          padding: '2px 7px',
                          cursor: 'pointer',
                        }}
                      >
                        NVIDIA steps
                      </button>
                      <span style={{ fontSize: '11px', color: 'var(--aka-gray-400)' }}>
                        {concurrencyLevels.length} data point{concurrencyLevels.length !== 1 ? 's' : ''} on the graph
                      </span>
                    </div>
                  </ParamGroup>

                  {/* Per-step request multiplier — sweep only.
                      Each level runs (VUs × this) requests. NVIDIA recommends 3
                      for stable steady-state, 10 is the historical default. */}
                  <SliderParam
                    label="Requests per Virtual User"
                    sublabel="Each sweep step sends (Virtual Users × this many) requests"
                    hint="Range: 3 – 30 · NVIDIA recommends 3"
                    value={sweepRequestMultiplier}
                    min={3}
                    max={30}
                    step={1}
                    display={String(sweepRequestMultiplier)}
                    onChange={setSweepRequestMultiplier}
                  />
                </>
              ) : (
                <>
                  <SliderParam
                    label="Virtual Users"
                    sublabel="Parallel simulated sessions"
                    hint="Range: 1 – 256"
                    value={concurrency}
                    min={1}
                    max={256}
                    display={String(concurrency)}
                    onChange={setConcurrency}
                  />
                  <SliderParam
                    label="Request Count"
                    sublabel="Total requests to send during the benchmark"
                    hint="Range: 3 – 2000"
                    value={requestCount}
                    min={3}
                    max={2000}
                    step={1}
                    display={String(requestCount)}
                    onChange={setRequestCount}
                  />
                </>
              )}

              {/* Options — applies to both single and sweep runs. */}
              <div style={{
                gridColumn: '1 / -1',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '20px 24px',
              }}>
                <SectionTitle>Options</SectionTitle>

                <SelectParam
                  label="Backend"
                  sublabel="Protocol used by AIPerf to send requests"
                  value={backend}
                  options={[
                    { value: 'openai', label: 'OpenAI-compatible (recommended)' },
                    { value: 'triton-grpc', label: 'Triton gRPC' },
                  ]}
                  onChange={v => setBackend(v as Backend)}
                />

                <SliderParam
                  label="Input Sequence Length (ISL)"
                  sublabel="Mean prompt length in tokens"
                  hint="Range: 64 – 8192 tokens"
                  value={inputTokensMean}
                  min={64}
                  max={8192}
                  step={64}
                  display={String(inputTokensMean)}
                  onChange={setInputTokensMean}
                />

                <SliderParam
                  label="Output Sequence Length (OSL)"
                  sublabel="Hard cap on generation length — enforced per request for reproducible results"
                  hint="Range: 64 – 4096 tokens"
                  value={outputTokensMean}
                  min={64}
                  max={4096}
                  step={64}
                  display={String(outputTokensMean)}
                  onChange={setOutputTokensMean}
                />

                <SelectParam
                  label="ISL Distribution"
                  sublabel="Spread of input lengths around the ISL mean"
                  value={islDistribution}
                  options={[
                    { value: 'fixed', label: 'Fixed (no variance)' },
                    { value: 'normal-10', label: 'Normal ±10%' },
                    { value: 'normal-25', label: 'Normal ±25%' },
                    { value: 'exponential', label: 'Exponential (heavy tail)' },
                    { value: 'synthetic', label: 'Synthetic dataset (AIPerf default)' },
                  ]}
                  onChange={v => setIslDistribution(v as IslDistribution)}
                />
              </div>

            </div>
          )}

          {/* ── Tab: Engine Tuning ── */}
          {activeTab === 'engine-tuning' && (
            !selectedEngine ? (
              <div style={{ padding: '32px 0', textAlign: 'center', fontSize: '13px', color: 'var(--aka-gray-400)' }}>
                Select an engine to configure tuning parameters.
              </div>
            ) : selectedEngine === 'trt-llm' ? (
              <div style={PARAM_GRID}>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--aka-gray-500)' }}>
                    TensorRT-LLM Engine Parameters
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--aka-gray-400)' }}>
                    Defaults are optimal — only change for specific customer scenarios
                  </span>
                </div>

                <SelectParam
                  label="Batch Scheduler"
                  sublabel="How new requests join running batches"
                  value={batchScheduler}
                  options={[
                    { value: 'inflight', label: 'In-flight batching (recommended)' },
                    { value: 'static', label: 'Static batching' },
                  ]}
                  onChange={v => setBatchScheduler(v as 'inflight' | 'static')}
                />

                <SliderParam
                  label="Max Batch Size"
                  sublabel="Max concurrent sequences per step"
                  value={maxBatchSize}
                  min={1}
                  max={256}
                  display={String(maxBatchSize)}
                  onChange={setMaxBatchSize}
                />

                <SelectParam
                  label="KV Cache dtype"
                  sublabel="Memory format for attention key-value cache"
                  value={kvCacheDtype}
                  options={[
                    { value: 'fp8', label: 'FP8 (recommended)' },
                    { value: 'fp16', label: 'FP16' },
                    { value: 'int8', label: 'INT8' },
                  ]}
                  onChange={setKvCacheDtype}
                />

                <SliderParam
                  label="GPU Memory Utilisation"
                  sublabel="Fraction allocated to KV cache"
                  hint="Range: 0.50 – 0.98"
                  value={gpuMemoryUtil}
                  min={0.50}
                  max={0.98}
                  step={0.01}
                  display={gpuMemoryUtil.toFixed(2)}
                  onChange={setGpuMemoryUtil}
                />

                <ToggleParam
                  label="CUDA Graphs"
                  sublabel="Eliminates CPU kernel launch overhead"
                  value={cudaGraphs}
                  onChange={setCudaGraphs}
                />

              </div>
            ) : selectedEngine === 'sglang' ? (
              <div style={PARAM_GRID}>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--aka-gray-500)' }}>
                    SGLang Engine Parameters
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--aka-gray-400)' }}>
                    Defaults are optimal — only change for specific customer scenarios
                  </span>
                </div>

                <SliderParam
                  label="Context Length"
                  sublabel="Max token context window for input + output"
                  hint="Range: 512 – 32768 tokens"
                  value={maxModelLen}
                  min={512}
                  max={32768}
                  step={512}
                  display={String(maxModelLen)}
                  onChange={setMaxModelLen}
                />

                <SliderParam
                  label="Max Running Requests"
                  sublabel="Max concurrent requests in the engine"
                  value={maxBatchSize}
                  min={1}
                  max={256}
                  display={String(maxBatchSize)}
                  onChange={setMaxBatchSize}
                />

                <SelectParam
                  label="KV Cache dtype"
                  sublabel="Attention key-value cache precision"
                  value={kvCacheDtype}
                  options={[
                    { value: 'auto', label: 'Auto (RadixAttention managed)' },
                    { value: 'fp8', label: 'FP8' },
                  ]}
                  onChange={setKvCacheDtype}
                />

                <SliderParam
                  label="Mem Fraction Static"
                  sublabel="Fraction of GPU VRAM reserved for KV cache"
                  hint="Range: 0.50 – 0.98"
                  value={gpuMemoryUtil}
                  min={0.50}
                  max={0.98}
                  step={0.01}
                  display={gpuMemoryUtil.toFixed(2)}
                  onChange={setGpuMemoryUtil}
                />

                <ToggleParam
                  label="Chunked Prefill"
                  sublabel="Processes long prompts in 512-token chunks to reduce TTFT variance"
                  value={chunkedPrefill}
                  onChange={setChunkedPrefill}
                />

              </div>
            ) : (
              <div style={PARAM_GRID}>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--aka-gray-500)' }}>
                    vLLM Engine Parameters
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--aka-gray-400)' }}>
                    Defaults are optimal — only change for specific customer scenarios
                  </span>
                </div>

                <SliderParam
                  label="Max Model Length"
                  sublabel="Maximum sequence length (context window) the server accepts"
                  hint="Range: 512 – 32768 tokens"
                  value={maxModelLen}
                  min={512}
                  max={32768}
                  step={512}
                  display={String(maxModelLen)}
                  onChange={setMaxModelLen}
                />

                <SliderParam
                  label="Max Batch Size"
                  sublabel="Max sequences per scheduler step"
                  value={maxBatchSize}
                  min={1}
                  max={256}
                  display={String(maxBatchSize)}
                  onChange={setMaxBatchSize}
                />

                <SelectParam
                  label="KV Cache dtype"
                  sublabel="Memory format for attention key-value cache"
                  value={kvCacheDtype}
                  options={[
                    { value: 'auto', label: 'Auto (matches model dtype)' },
                    { value: 'fp8', label: 'FP8' },
                    { value: 'int8', label: 'INT8' },
                  ]}
                  onChange={setKvCacheDtype}
                />

                <SliderParam
                  label="GPU Memory Utilisation"
                  sublabel="Fraction allocated to KV cache (vLLM needs more headroom)"
                  hint="Range: 0.50 – 0.98 · default 0.90 (vs 0.95 for TRT-LLM)"
                  value={gpuMemoryUtil}
                  min={0.50}
                  max={0.98}
                  step={0.01}
                  display={gpuMemoryUtil.toFixed(2)}
                  onChange={setGpuMemoryUtil}
                />

                <ToggleParam
                  label="Prefix Caching"
                  sublabel="Caches shared system prompt KV state — reduces TTFT significantly"
                  value={prefixCaching}
                  onChange={setPrefixCaching}
                />

                <ToggleParam
                  label="Chunked Prefill"
                  sublabel="Splits long prefills to reduce TTFT variance at high concurrency"
                  value={true}
                  disabled
                  disabledLabel="Always on (V1 engine)"
                />

                <ToggleParam
                  label="Flash Attention 2"
                  sublabel="Memory-efficient attention kernel"
                  value={flashAttention}
                  onChange={setFlashAttention}
                />
              </div>
            )
          )}
      </div>
    </div>
  )
}
