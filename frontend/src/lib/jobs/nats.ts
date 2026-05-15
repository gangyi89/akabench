/**
 * NATS JetStream singleton for publishing benchmark requests.
 * Lazily connects on first publish. Fails silently if NATS_URL is not set
 * (dev / CI environments where NATS isn't running).
 */
import { connect, type NatsConnection, type JetStreamClient } from 'nats'
import type { NatsPayload } from '@/lib/catalogue/types'

const SUBJECT = 'jobs'

let nc: NatsConnection | null = null
let js: JetStreamClient | null = null

async function getJetStream(): Promise<JetStreamClient | null> {
  const url = process.env.NATS_URL
  if (!url) return null

  if (js) return js

  nc = await connect({ servers: url })
  js = nc.jetstream()

  // Ensure the JOBS stream exists — idempotent.
  try {
    const jsm = await nc.jetstreamManager()
    await jsm.streams.add({ name: 'JOBS', subjects: [SUBJECT] })
  } catch {
    // Stream already exists — safe to ignore.
  }

  return js
}

export async function publishBenchmarkRequest(payload: NatsPayload): Promise<void> {
  const jetstream = await getJetStream()
  if (!jetstream) return  // NATS not configured — skip silently

  const data = new TextEncoder().encode(JSON.stringify(payload))
  await jetstream.publish(SUBJECT, data)
}
