import postgres from 'postgres'

// Module-level singleton — reused across requests in the same process.
// Next.js hot-reload creates new module instances in dev, so we cache on
// the global object to avoid exhausting the connection pool.
declare global {
  var __sql: ReturnType<typeof postgres> | undefined
}

// Lazy — initialised on first use. Eager construction breaks `next build`,
// which imports every API route during "Collecting page data" and would
// throw here when DATABASE_URL is unset in the build environment.
function getSql(): ReturnType<typeof postgres> {
  if (globalThis.__sql) return globalThis.__sql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  globalThis.__sql = postgres(url, { max: 5 })
  return globalThis.__sql
}

export const sql = new Proxy((() => {}) as unknown as ReturnType<typeof postgres>, {
  apply: (_t, _thisArg, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
  get:   (_t, prop) => (getSql() as unknown as Record<string | symbol, unknown>)[prop],
})
