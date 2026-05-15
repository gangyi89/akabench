import type { EnrichedModel, GPU, QuantType } from '@/lib/catalogue/types'

/**
 * Returns which quant chips are enabled for a given model + gpu combination,
 * and an optional notice string to display below the row.
 */
export function deriveQuantSupport(
  model: EnrichedModel,
  gpu: GPU | null
): { supported: QuantType[]; notice: string | null } {
  const supported = model.supportedQuants.filter((q) => {
    // NVFP4 requires FP4 tensor cores — only hide if a GPU is selected and lacks them
    if (q === 'nvfp4') {
      if (!gpu) return true
      return gpu.tensorCoreCaps.includes('fp4')
    }
    return true
  })

  let notice: string | null = null

  if (gpu) {
    if (model.supportedQuants.includes('nvfp4') && !gpu.tensorCoreCaps.includes('fp4')) {
      notice = `NVFP4 not available — ${gpu.name} lacks FP4 tensor cores.`
    } else if (model.supportedQuants.includes('nvfp4') && gpu.tensorCoreCaps.includes('fp4')) {
      notice = `NVFP4 available on ${gpu.name}. TensorRT-LLM only.`
    } else if (model.vramFp16Gb > gpu.vramGb && model.vramFp8Gb <= gpu.vramGb) {
      notice = `FP16 does not fit ${gpu.name} (${gpu.vramGb} GB VRAM). Use FP8 or lower.`
    } else if (model.vramFp8Gb > gpu.vramGb && model.vramNvfp4Gb <= gpu.vramGb) {
      notice = `FP16 and FP8 do not fit ${gpu.name}. INT4 AWQ or NVFP4 required.`
    }
  }

  return { supported, notice }
}
