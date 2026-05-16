import { create } from 'zustand'
import type { DeriveResult, GPU, EngineType, QuantType, IslDistribution, Backend } from '@/lib/catalogue/types'

interface BenchmarkState {
  // Panel 1 — Model
  selectedModelId: string | null
  isDeriving: boolean

  // Panel 2 — Engine & Quantisation
  selectedEngine: EngineType | null
  selectedQuant: QuantType | null
  deriveResult: DeriveResult | null

  // Panel 3 — Hardware
  selectedGpuId: string | null
  availableGpus: GPU[]

  // Panel 4 — Load Profile
  concurrency: number
  sweepEnabled: boolean
  concurrencyLevels: number[]
  requestCount: number              // literal total requests — single-run mode
  sweepRequestMultiplier: number    // requests per VU per sweep step — sweep mode
  inputTokensMean: number
  outputTokensMean: number
  measurementWindow: number
  islDistribution: IslDistribution
  backend: Backend
  streaming: boolean

  // Panel 4 — Engine Tuning (shared)
  kvCacheDtype: string
  maxModelLen: number
  gpuMemoryUtil: number
  maxBatchSize: number

  // Panel 4 — Engine Tuning (vLLM)
  prefixCaching: boolean
  chunkedPrefill: boolean
  flashAttention: boolean

  // Panel 4 — Engine Tuning (TRT-LLM)
  batchScheduler: 'inflight' | 'static'
  cudaGraphs: boolean

  // Derived readiness
  isReadyToRun: boolean

  // Actions — Panels 1–3
  setIsDeriving: (val: boolean) => void
  setSelectedEngine: (engine: EngineType | null) => void
  setSelectedQuant: (quant: QuantType | null) => void
  commitModel: (hfRepoId: string, result: DeriveResult) => void
  setDeriveResult: (result: DeriveResult | null) => void
  setSelectedGpu: (gpuId: string | null) => void
  setAvailableGpus: (gpus: GPU[]) => void

  // Actions — Panel 4
  setConcurrency: (v: number) => void
  setSweepEnabled: (v: boolean) => void
  setConcurrencyLevels: (v: number[]) => void
  setRequestCount: (v: number) => void
  setSweepRequestMultiplier: (v: number) => void
  setInputTokensMean: (v: number) => void
  setOutputTokensMean: (v: number) => void
  setMeasurementWindow: (v: number) => void
  setIslDistribution: (v: IslDistribution) => void
  setBackend: (v: Backend) => void
  setStreaming: (v: boolean) => void
  setKvCacheDtype: (v: string) => void
  setMaxModelLen: (v: number) => void
  setGpuMemoryUtil: (v: number) => void
  setMaxBatchSize: (v: number) => void
  setPrefixCaching: (v: boolean) => void
  setChunkedPrefill: (v: boolean) => void
  setFlashAttention: (v: boolean) => void
  setBatchScheduler: (v: 'inflight' | 'static') => void
  setCudaGraphs: (v: boolean) => void
}

export const useBenchmarkStore = create<BenchmarkState>((set, get) => ({
  // Panel 1
  selectedModelId: null,
  isDeriving: false,

  // Panel 2
  selectedEngine: null,
  selectedQuant: null,
  deriveResult: null,

  // Panel 3
  selectedGpuId: null,
  availableGpus: [],

  // Panel 4 — Load Profile defaults
  concurrency: 16,
  sweepEnabled: false,
  concurrencyLevels: [1, 2, 5, 10, 50, 100, 250],
  requestCount: 100,
  sweepRequestMultiplier: 10,
  inputTokensMean: 512,
  outputTokensMean: 256,
  measurementWindow: 300,
  islDistribution: 'normal-25',
  backend: 'openai',
  streaming: true,

  // Panel 4 — Engine Tuning defaults (shared)
  kvCacheDtype: 'auto',
  maxModelLen: 2048,
  gpuMemoryUtil: 0.90,
  maxBatchSize: 64,

  // Panel 4 — vLLM defaults
  prefixCaching: true,
  chunkedPrefill: true,
  flashAttention: true,

  // Panel 4 — TRT-LLM defaults
  batchScheduler: 'inflight',
  cudaGraphs: true,

  isReadyToRun: false,

  // ── Panel 1–3 actions ───────────────────────────────────────────────────────

  setIsDeriving: (val) => set({ isDeriving: val }),

  setSelectedEngine: (engine) => {
    set((state) => ({
      selectedEngine: engine,
      kvCacheDtype: 'auto',
      isReadyToRun: !!engine && !!state.selectedGpuId && !!state.selectedQuant,
    }))
  },

  setSelectedQuant: (quant) => set({ selectedQuant: quant }),

  commitModel: (hfRepoId, result) => {
    // Model change resets engine + GPU + quant — avoids stale cross-panel
    // state. Quant defaults to the model's native format (bf16 for base
    // models, nvfp4 for pre-quantised repos).
    set({
      selectedModelId: hfRepoId,
      deriveResult: result,
      isDeriving: false,
      selectedEngine: null,
      selectedGpuId: null,
      selectedQuant: result.model.nativeQuant,
      isReadyToRun: false,
    })
  },

  setDeriveResult: (result) => {
    if (!result) return set({ deriveResult: null, isReadyToRun: false })
    const state = get()
    set({
      deriveResult: result,
      // Do NOT overwrite selectedEngine here — user may have overridden the recommendation
      selectedQuant: result.supportedQuants.includes(state.selectedQuant as QuantType)
        ? state.selectedQuant
        : result.supportedQuants[0] ?? null,
      isReadyToRun: !!result && !!state.selectedGpuId && !!state.selectedEngine,
    })
  },

  setSelectedGpu: (gpuId) =>
    set((state) => ({
      selectedGpuId: gpuId,
      isReadyToRun: !!state.deriveResult && !!gpuId && !!state.selectedEngine,
    })),

  setAvailableGpus: (gpus) => set({ availableGpus: gpus }),

  // ── Panel 4 actions ─────────────────────────────────────────────────────────

  setConcurrency:      (v) => set({ concurrency: v }),
  setSweepEnabled:     (v) => set({ sweepEnabled: v }),
  setConcurrencyLevels:(v) => set({ concurrencyLevels: v }),
  setRequestCount:     (v) => set({ requestCount: v }),
  setSweepRequestMultiplier: (v) => set({ sweepRequestMultiplier: v }),
  setInputTokensMean:  (v) => set({ inputTokensMean: v }),
  setOutputTokensMean: (v) => set({ outputTokensMean: v }),
  setMeasurementWindow:(v) => set({ measurementWindow: v }),
  setIslDistribution:  (v) => set({ islDistribution: v }),
  setBackend:          (v) => set({ backend: v }),
  setStreaming:        (v) => set({ streaming: v }),
  setKvCacheDtype:     (v) => set({ kvCacheDtype: v }),
  setMaxModelLen:      (v) => set({ maxModelLen: v }),
  setGpuMemoryUtil:    (v) => set({ gpuMemoryUtil: v }),
  setMaxBatchSize:     (v) => set({ maxBatchSize: v }),
  setPrefixCaching:    (v) => set({ prefixCaching: v }),
  setChunkedPrefill:   (v) => set({ chunkedPrefill: v }),
  setFlashAttention:   (v) => set({ flashAttention: v }),
  setBatchScheduler:   (v) => set({ batchScheduler: v }),
  setCudaGraphs:       (v) => set({ cudaGraphs: v }),
}))
