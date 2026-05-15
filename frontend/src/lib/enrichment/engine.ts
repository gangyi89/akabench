import type { EnrichedModel, GPU, EngineType } from '@/lib/catalogue/types'

export interface EngineRecommendation {
  recommended: EngineType
  note: string
}

/**
 * Derives the recommended inference engine and a human-readable note
 * explaining why, based on model + GPU signals.
 */
export function deriveEngineRecommendation(
  model: EnrichedModel,
  gpu: GPU | null
): EngineRecommendation {
  // NGC container available → TRT-LLM is the clear choice
  if (model.ngcContainerTag) {
    return {
      recommended: 'trt-llm',
      note: 'Ready-to-deploy NVIDIA package — TensorRT-LLM recommended for lowest latency.',
    }
  }

  // NVIDIA-published model without NGC container — TRT-LLM still preferred
  if (model.vendor === 'nvidia') {
    return {
      recommended: 'trt-llm',
      note: 'NVIDIA-optimised model — TensorRT-LLM recommended. One-off engine build required (~10–30 min).',
    }
  }

  // MoE architecture — vLLM PagedAttention handles expert routing better today
  if (model.archType === 'moe') {
    return {
      recommended: 'vllm',
      note: 'Mixture-of-Experts model — vLLM handles expert routing more efficiently today.',
    }
  }

  // GPU does not support TRT-LLM
  if (gpu && !gpu.trtLlmSupported) {
    return {
      recommended: 'vllm',
      note: `${gpu.name} does not support TensorRT-LLM — vLLM selected instead.`,
    }
  }

  // Default: vLLM — fastest cold start, no compilation overhead
  return {
    recommended: 'vllm',
    note: 'vLLM recommended — no build step, fast start, strong throughput.',
  }
}
