import { NextResponse } from 'next/server'
import { getAllGpus } from '@/lib/catalogue/db'

export async function GET() {
  return NextResponse.json({ gpus: getAllGpus() })
}
