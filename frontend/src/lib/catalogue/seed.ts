import type { GPU } from './types'

// Models live in Postgres — see db/migrations/0002_models.sql for the seed data.
// GPUs are in-memory: only two of them, and they are hardware constants, not catalogue entries.

export const SEED_GPUS: GPU[] = [
  {
    id: 'rtx-pro-6000',
    name: 'RTX Pro 6000',
    optionLabel: 'Option B',
    vramGb: 96,
    bf16Tflops: 314.6,
    tensorCoreCaps: ['fp16', 'fp4', 'int8'],
    trtLlmSupported: true,
    vllmSupported: true,
    targetWorkload: 'Large models (up to 70B FP16), NVFP4 capable',
    available: false,
  },
  {
    id: 'rtx-4000-ada',
    name: 'RTX 4000 Ada',
    optionLabel: 'Option A',
    vramGb: 20,
    bf16Tflops: 48.7,
    tensorCoreCaps: ['fp16', 'int8'],
    trtLlmSupported: true,
    vllmSupported: true,
    targetWorkload: 'Smaller models (≤13B FP16), cost-efficient tier',
    available: true,
  },
]
