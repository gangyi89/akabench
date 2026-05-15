import type { EnrichedModel, GPU, CompatResult } from '@/lib/catalogue/types'
import { vramFp16Gb, vramFp8Gb, vramNvfp4Gb } from '@/lib/catalogue/derived'

/**
 * Returns compatibility results for a model against all provided GPUs.
 * Used by Panel 2 to dim incompatible GPU cards.
 */
export function deriveCompat(model: EnrichedModel, gpus: GPU[]): CompatResult[] {
  const fp16 = vramFp16Gb(model)
  const fp8  = vramFp8Gb(model)
  const fp4  = vramNvfp4Gb(model)

  return gpus.map((gpu) => {
    const fitsFp16 = fp16 <= gpu.vramGb
    const fitsFp8  = fp8  <= gpu.vramGb
    const fitsNvfp4 =
      fp4 <= gpu.vramGb &&
      gpu.tensorCoreCaps.includes('fp4') &&
      model.supportedQuants.includes('nvfp4')

    let warning: string | null = null

    if (!fitsFp16 && fitsFp8) {
      warning = `⚠ FP16 requires ${fp16} GB — use FP8 on this GPU`
    } else if (!fitsFp8 && fitsNvfp4) {
      warning = `⚠ Needs NVFP4 to fit on ${gpu.name}`
    } else if (!fitsNvfp4 && !fitsFp8 && !fitsFp16) {
      warning = `✗ Model does not fit — even NVFP4 requires ${fp4} GB`
    }

    return { gpuId: gpu.id, fitsFp16, fitsFp8, fitsNvfp4, warning }
  })
}
