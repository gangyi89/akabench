import { NextRequest, NextResponse } from 'next/server'
import { searchModels } from '@/lib/catalogue/db'
import type { SearchResultItem } from '@/lib/catalogue/types'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''

  const models = searchModels(q)

  const results: SearchResultItem[] = models.map((m) => {
    let licenceWarning: string | null = null
    if (m.mauLimit !== null) {
      licenceWarning = `700M MAU limit`
    } else if (m.licenceType === 'gated') {
      licenceWarning = 'Gated — HuggingFace approval required'
    } else if (m.licenceType === 'other') {
      licenceWarning = 'Custom licence — review before customer use'
    }

    return {
      hfRepoId: m.hfRepoId,
      displayName: m.displayName,
      paramCountB: m.paramCountB,
      vramFp16Gb: m.vramFp16Gb,
      downloadsMonthly: m.downloadsMonthly,
      tags: m.tags,
      licenceType: m.licenceType,
      licenceWarning,
      compatSummary: null,
    }
  })

  return NextResponse.json({ results })
}
