# Frontend image — Next.js 16 (App Router) with standalone output.
# Build context must be repo root: docker build -f frontend/Dockerfile -t <registry>/akabench/web:vX .

# ─── deps ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# musl shim for some npm postinstall scripts that hard-code glibc paths
RUN apk add --no-cache libc6-compat
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# ─── builder ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
RUN npm run build

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root runtime user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone bundle is self-contained — server.js + the minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
