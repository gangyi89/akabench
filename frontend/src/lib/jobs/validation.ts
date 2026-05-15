import type { JobSubmitRequest } from '@/lib/catalogue/types'

type ValidationError = { error: string; code: string }

/**
 * Returns a ValidationError if the request violates engine/quant/GPU
 * compatibility rules, or null if valid. Server-side is the authoritative gate.
 */
export function validateJobRequest(req: JobSubmitRequest): ValidationError | null {
  const { quantisation: q, engine, gpuId } = req

  if (!q) return null

  if (q === 'nvfp4' && gpuId === 'rtx-4000-ada') {
    return {
      error: 'NVFP4 requires RTX Pro 6000 — FP4 tensor cores not available on RTX 4000 Ada',
      code: 'NVFP4_REQUIRES_RTX_PRO_6000',
    }
  }

  if (q === 'nvfp4' && engine === 'sglang') {
    return { error: 'NVFP4 is TensorRT-LLM exclusive', code: 'QUANT_TRTLLM_ONLY' }
  }

  if ((q === 'smoothquant' || q === 'w4a8' || q === 'w4a16') && (engine === 'vllm' || engine === 'sglang')) {
    return { error: `${q} is TensorRT-LLM exclusive`, code: 'QUANT_TRTLLM_ONLY' }
  }

  return null
}
