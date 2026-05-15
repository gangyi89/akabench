import type { EnrichedModel, GPU, CompatResult } from '@/lib/catalogue/types'

/**
 * Returns compatibility results for a model against all provided GPUs.
 * Used by Panel 2 to dim incompatible GPU cards.
 */
export function deriveCompat(model: EnrichedModel, gpus: GPU[]): CompatResult[] {
  return gpus.map((gpu) => {
    const fitsFp16 = model.vramFp16Gb <= gpu.vramGb
    const fitsFp8 = model.vramFp8Gb <= gpu.vramGb
    const fitsNvfp4 =
      model.vramNvfp4Gb <= gpu.vramGb &&
      gpu.tensorCoreCaps.includes('fp4') &&
      model.supportedQuants.includes('nvfp4')

    let warning: string | null = null

    if (!fitsFp16 && fitsFp8) {
      warning = `⚠ FP16 requires ${model.vramFp16Gb} GB — use FP8 on this GPU`
    } else if (!fitsFp8 && fitsNvfp4) {
      warning = `⚠ Needs NVFP4 to fit on ${gpu.name}`
    } else if (!fitsNvfp4 && !fitsFp8 && !fitsFp16) {
      warning = `✗ Model does not fit — even NVFP4 requires ${model.vramNvfp4Gb} GB`
    }

    return { gpuId: gpu.id, fitsFp16, fitsFp8, fitsNvfp4, warning }
  })
}
