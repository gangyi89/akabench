import { NextRequest, NextResponse } from 'next/server'
import { searchModels } from '@/lib/catalogue/db'
import { vramFp16Gb, tagsFor } from '@/lib/catalogue/derived'
import { getSession, unauthorizedResponse } from '@/lib/auth/session'
import type { SearchResultItem } from '@/lib/catalogue/types'

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return unauthorizedResponse()

  const q = req.nextUrl.searchParams.get('q') ?? ''

  const models = await searchModels(q)

  const results: SearchResultItem[] = models.map((m) => ({
    hfRepoId:      m.hfRepoId,
    displayName:   m.displayName,
    paramCountB:   m.paramCountB,
    vramFp16Gb:    vramFp16Gb(m),
    tags:          tagsFor(m),
    gated:         m.gated,
    compatSummary: null,
  }))

  return NextResponse.json({ results })
}
