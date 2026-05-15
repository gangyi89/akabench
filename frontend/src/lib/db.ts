import postgres from 'postgres'

// Module-level singleton — reused across requests in the same process.
// Next.js hot-reload creates new module instances in dev, so we cache on
// the global object to avoid exhausting the connection pool.
declare global {
  var __sql: ReturnType<typeof postgres> | undefined
}

function createSql(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return postgres(url, { max: 5 })
}

export const sql = globalThis.__sql ?? (globalThis.__sql = createSql())
