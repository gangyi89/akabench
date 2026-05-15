import type { EnrichedModel, GPU, QuantType } from '@/lib/catalogue/types'
import { vramFp16Gb, vramFp8Gb, vramNvfp4Gb } from '@/lib/catalogue/derived'

/**
 * Returns which quant chips are enabled for a given model + gpu combination,
 * and an optional notice string to display below the row.
 */
export function deriveQuantSupport(
  model: EnrichedModel,
  gpu: GPU | null
): { supported: QuantType[]; notice: string | null } {
  // Chip availability tracks the model's capability — GPU mismatch is surfaced
  // on the GPU card (HardwarePanel), not by hiding a chip the model supports.
  const supported = model.supportedQuants

  let notice: string | null = null

  if (gpu) {
    const fp16 = vramFp16Gb(model)
    const fp8  = vramFp8Gb(model)
    const fp4  = vramNvfp4Gb(model)
    if (model.supportedQuants.includes('nvfp4') && !gpu.tensorCoreCaps.includes('fp4')) {
      notice = `NVFP4 not available — ${gpu.name} lacks FP4 tensor cores.`
    } else if (model.supportedQuants.includes('nvfp4') && gpu.tensorCoreCaps.includes('fp4')) {
      notice = `NVFP4 available on ${gpu.name}.`
    } else if (fp16 > gpu.vramGb && fp8 <= gpu.vramGb) {
      notice = `FP16 does not fit ${gpu.name} (${gpu.vramGb} GB VRAM). Use FP8 or lower.`
    } else if (fp8 > gpu.vramGb && fp4 <= gpu.vramGb) {
      notice = `FP16 and FP8 do not fit ${gpu.name}. INT4 AWQ or NVFP4 required.`
    }
  }

  return { supported, notice }
}
