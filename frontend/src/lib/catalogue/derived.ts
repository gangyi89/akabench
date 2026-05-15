import type { EnrichedModel } from './types'

// FP16 weights = 2 bytes per parameter. FP8 halves it; NVFP4 quarters it.
// For MoE models the full parameter count is what sits in VRAM — only
// routing is sparse, the experts are all resident.
export const vramFp16Gb  = (m: Pick<EnrichedModel, 'paramCountB'>) => m.paramCountB * 2
export const vramFp8Gb   = (m: Pick<EnrichedModel, 'paramCountB'>) => m.paramCountB
export const vramNvfp4Gb = (m: Pick<EnrichedModel, 'paramCountB'>) => m.paramCountB / 2

export const isMoe = (m: Pick<EnrichedModel, 'activeParamCountB'>) => m.activeParamCountB !== null

// Display tags for the model row. Derived from canonical fields so the
// UI stays consistent with the catalogue without a stored column.
export function tagsFor(m: EnrichedModel): string[] {
  const tags: string[] = []
  if (m.vendor === 'nvidia') tags.push('nvidia')
  if (m.ngcContainerTag) tags.push('ngc')
  tags.push(m.nativeQuant)
  if (m.gated) tags.push('gated')
  return tags
}
