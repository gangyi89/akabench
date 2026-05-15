/**
 * Catalogue store.
 *   - Models are persisted in Postgres (table `models`) — async reads.
 *   - GPUs are hardware constants — kept in memory.
 */
import { sql } from '@/lib/db'
import type { EnrichedModel, GPU, QualityTier, QuantType } from './types'
import { SEED_GPUS } from './seed'

type ModelRow = {
  hf_repo_id: string
  display_name: string
  vendor: string
  family: string
  param_count_b: string                // NUMERIC returns as string
  active_param_count_b: string | null
  quality_tier: string
  supported_quants: string[]
  native_quant: string
  ngc_container_tag: string | null
  gated: boolean
}

function rowToModel(row: ModelRow): EnrichedModel {
  return {
    hfRepoId:          row.hf_repo_id,
    displayName:       row.display_name,
    vendor:            row.vendor,
    family:            row.family,
    paramCountB:       Number(row.param_count_b),
    activeParamCountB: row.active_param_count_b !== null ? Number(row.active_param_count_b) : null,
    qualityTier:       row.quality_tier as QualityTier,
    supportedQuants:   row.supported_quants as QuantType[],
    nativeQuant:       row.native_quant as QuantType,
    ngcContainerTag:   row.ngc_container_tag,
    gated:             row.gated,
  }
}

export async function searchModels(query: string): Promise<EnrichedModel[]> {
  const q = query.toLowerCase().trim()
  const rows = q
    ? await sql<ModelRow[]>`
        SELECT * FROM models
        WHERE LOWER(hf_repo_id) LIKE ${'%' + q + '%'}
           OR LOWER(family)     LIKE ${'%' + q + '%'}
           OR LOWER(vendor)     LIKE ${'%' + q + '%'}
        ORDER BY family ASC, param_count_b ASC, display_name ASC
      `
    : await sql<ModelRow[]>`
        SELECT * FROM models
        ORDER BY family ASC, param_count_b ASC, display_name ASC
      `
  return rows.map(rowToModel)
}

export async function getModel(hfRepoId: string): Promise<EnrichedModel | null> {
  const rows = await sql<ModelRow[]>`
    SELECT * FROM models WHERE hf_repo_id = ${hfRepoId}
  `
  return rows[0] ? rowToModel(rows[0]) : null
}

export function getAllGpus(): GPU[] {
  return SEED_GPUS
}

export function getGpu(id: string): GPU | null {
  return SEED_GPUS.find((g) => g.id === id) ?? null
}
