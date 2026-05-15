/**
 * In-memory catalogue store — MVP only.
 * All reads/writes go through these functions.
 * Replace internals with a Postgres client later without touching callers.
 */
import type { EnrichedModel, GPU } from './types'
import { SEED_MODELS, SEED_GPUS } from './seed'

const models: Map<string, EnrichedModel> = new Map(
  SEED_MODELS.map((m) => [m.hfRepoId, m])
)

const gpus: Map<string, GPU> = new Map(
  SEED_GPUS.map((g) => [g.id, g])
)

export function searchModels(query: string): EnrichedModel[] {
  const q = query.toLowerCase().trim()
  if (!q) return SEED_MODELS
  return SEED_MODELS.filter(
    (m) =>
      m.hfRepoId.toLowerCase().includes(q) ||
      m.family.toLowerCase().includes(q) ||
      m.vendor.toLowerCase().includes(q)
  )
}

export function getModel(hfRepoId: string): EnrichedModel | null {
  return models.get(hfRepoId) ?? null
}

export function getAllGpus(): GPU[] {
  return SEED_GPUS
}

export function getGpu(id: string): GPU | null {
  return gpus.get(id) ?? null
}
