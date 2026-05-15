import { NextRequest, NextResponse } from 'next/server'
import { getModel, getAllGpus, getGpu } from '@/lib/catalogue/db'
import { deriveQuantSupport } from '@/lib/enrichment/quants'
import { deriveEngineRecommendation } from '@/lib/enrichment/engine'
import { deriveCompat } from '@/lib/enrichment/vram'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'
import type { DeriveResult } from '@/lib/catalogue/types'

// GET /api/models/derive?id={hfRepoId}&gpu={gpuId}
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const hfRepoId = req.nextUrl.searchParams.get('id')
  const gpuId = req.nextUrl.searchParams.get('gpu')

  if (!hfRepoId) {
    return NextResponse.json(
      { error: 'Missing required param: id', code: 'MISSING_PARAM' },
      { status: 400 }
    )
  }

  const model = await getModel(hfRepoId)
  if (!model) {
    return NextResponse.json(
      { error: 'Model not found', code: 'MODEL_NOT_FOUND' },
      { status: 404 }
    )
  }

  const gpu = gpuId ? getGpu(gpuId) : null
  const allGpus = getAllGpus()

  const { supported: supportedQuants, notice: quantNotice } = deriveQuantSupport(model, gpu)
  const { recommended: engineRecommendation, note: engineNote } = deriveEngineRecommendation(model, gpu)
  const compat = deriveCompat(model, allGpus)

  const selectedCompat = gpuId ? compat.find((c) => c.gpuId === gpuId) : null

  const result: DeriveResult = {
    model,
    engineRecommendation,
    engineNote,
    supportedQuants,
    quantNotice,
    compatWarning: selectedCompat?.warning ?? null,
    compat,
  }

  return NextResponse.json(result)
}
