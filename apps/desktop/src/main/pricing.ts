import https from 'node:https'
import { getDb } from './db/index'
import { modelPricing } from './db/schema'

export interface ModelPricing {
  input: number        // $/1M tokens
  output: number       // $/1M tokens
  cacheWrite5m: number // $/1M tokens
  cacheWrite1h: number // $/1M tokens
  cacheRead: number    // $/1M tokens
}

// Bundled from Anthropic pricing page 2026-05-05.
const BUNDLED: Record<string, ModelPricing> = {
  'claude-opus-4-7':   { input: 5,    output: 25,   cacheWrite5m: 6.25,  cacheWrite1h: 10,   cacheRead: 0.50 },
  'claude-opus-4-6':   { input: 5,    output: 25,   cacheWrite5m: 6.25,  cacheWrite1h: 10,   cacheRead: 0.50 },
  'claude-opus-4-5':   { input: 5,    output: 25,   cacheWrite5m: 6.25,  cacheWrite1h: 10,   cacheRead: 0.50 },
  'claude-opus-4-1':   { input: 15,   output: 75,   cacheWrite5m: 18.75, cacheWrite1h: 30,   cacheRead: 1.50 },
  'claude-opus-4':     { input: 15,   output: 75,   cacheWrite5m: 18.75, cacheWrite1h: 30,   cacheRead: 1.50 },
  'claude-sonnet-4-6': { input: 3,    output: 15,   cacheWrite5m: 3.75,  cacheWrite1h: 6,    cacheRead: 0.30 },
  'claude-sonnet-4-5': { input: 3,    output: 15,   cacheWrite5m: 3.75,  cacheWrite1h: 6,    cacheRead: 0.30 },
  'claude-sonnet-4':   { input: 3,    output: 15,   cacheWrite5m: 3.75,  cacheWrite1h: 6,    cacheRead: 0.30 },
  'claude-sonnet-3-7': { input: 3,    output: 15,   cacheWrite5m: 3.75,  cacheWrite1h: 6,    cacheRead: 0.30 },
  'claude-haiku-4-5':  { input: 1,    output: 5,    cacheWrite5m: 1.25,  cacheWrite1h: 2,    cacheRead: 0.10 },
  'claude-haiku-3-5':  { input: 0.80, output: 4,    cacheWrite5m: 1.00,  cacheWrite1h: 1.60, cacheRead: 0.08 },
  'claude-haiku-3':    { input: 0.25, output: 1.25, cacheWrite5m: 0.30,  cacheWrite1h: 0.50, cacheRead: 0.03 },
  'claude-opus-3':     { input: 15,   output: 75,   cacheWrite5m: 18.75, cacheWrite1h: 30,   cacheRead: 1.50 },
}

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

// Strip trailing date suffix e.g. -20250715 and lowercase.
function normalizeId(id: string): string {
  return id.toLowerCase().replace(/-\d{8}$/, '')
}

// Seed the DB table with bundled prices if it is empty, and return a full
// in-memory snapshot used for synchronous lookups in the same process.
export function init(): Record<string, ModelPricing> {
  const db = getDb()
  const existing = db.select().from(modelPricing).all()
  if (existing.length === 0) {
    const now = Date.now()
    db.insert(modelPricing).values(
      Object.entries(BUNDLED).map(([id, p]) => ({
        modelId: id,
        inputPerM: p.input,
        outputPerM: p.output,
        cacheWrite5mPerM: p.cacheWrite5m,
        cacheWrite1hPerM: p.cacheWrite1h,
        cacheReadPerM: p.cacheRead,
        source: 'bundled' as const,
        updatedAt: now,
      }))
    ).run()
    return { ...BUNDLED }
  }
  return Object.fromEntries(
    existing.map((r) => [r.modelId, {
      input: r.inputPerM,
      output: r.outputPerM,
      cacheWrite5m: r.cacheWrite5mPerM,
      cacheWrite1h: r.cacheWrite1hPerM,
      cacheRead: r.cacheReadPerM,
    }])
  )
}

// In-process cache so lookupPricing() is synchronous without a DB round-trip per call.
let _cache: Record<string, ModelPricing> = {}

export function initPricing(): void {
  _cache = init()
}

export function getAllPricing(): Record<string, ModelPricing> {
  return { ..._cache }
}

export function lookupPricing(modelId: string): ModelPricing | null {
  const n = normalizeId(modelId)
  if (_cache[n]) return _cache[n]!
  for (const [key, p] of Object.entries(_cache)) {
    if (n.startsWith(key) || key.startsWith(n)) return p
  }
  return null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface PerTypeCost {
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
}

export function calculateCostBreakdown(usage: TokenUsage, modelId: string): PerTypeCost {
  const p = lookupPricing(modelId)
  if (!p) return { inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
  const M = 1_000_000
  return {
    inputCostUsd: (usage.inputTokens / M) * p.input,
    outputCostUsd: (usage.outputTokens / M) * p.output,
    cacheReadCostUsd: (usage.cacheReadTokens / M) * p.cacheRead,
    cacheCreationCostUsd: (usage.cacheCreationTokens / M) * p.cacheWrite5m,
  }
}

export function calculateCost(usage: TokenUsage, modelId: string): number {
  const p = lookupPricing(modelId)
  if (!p) return 0
  const M = 1_000_000
  return (
    (usage.inputTokens / M) * p.input +
    (usage.outputTokens / M) * p.output +
    (usage.cacheReadTokens / M) * p.cacheRead +
    (usage.cacheCreationTokens / M) * p.cacheWrite5m
  )
}

export async function refreshFromLiteLLM(): Promise<void> {
  const raw = await fetchUrl(LITELLM_URL)
  const json = JSON.parse(raw) as Record<string, unknown>
  const db = getDb()
  const now = Date.now()
  const M = 1_000_000

  for (const [id, entry] of Object.entries(json)) {
    if (!id.startsWith('claude-')) continue
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const inp = e['input_cost_per_token']
    const out = e['output_cost_per_token']
    if (typeof inp !== 'number' || typeof out !== 'number') continue

    const cacheWrite5m =
      typeof e['cache_creation_input_token_cost'] === 'number'
        ? (e['cache_creation_input_token_cost'] as number) * M
        : inp * M * 1.25
    const cacheRead =
      typeof e['cache_read_input_token_cost'] === 'number'
        ? (e['cache_read_input_token_cost'] as number) * M
        : inp * M * 0.1

    const pricing: ModelPricing = {
      input: inp * M,
      output: out * M,
      cacheWrite5m,
      cacheWrite1h: cacheWrite5m * 1.6,
      cacheRead,
    }
    const mid = normalizeId(id)

    db.insert(modelPricing).values({
      modelId: mid,
      inputPerM: pricing.input,
      outputPerM: pricing.output,
      cacheWrite5mPerM: pricing.cacheWrite5m,
      cacheWrite1hPerM: pricing.cacheWrite1h,
      cacheReadPerM: pricing.cacheRead,
      source: 'litellm',
      updatedAt: now,
    }).onConflictDoUpdate({
      target: modelPricing.modelId,
      set: {
        inputPerM: pricing.input,
        outputPerM: pricing.output,
        cacheWrite5mPerM: pricing.cacheWrite5m,
        cacheWrite1hPerM: pricing.cacheWrite1h,
        cacheReadPerM: pricing.cacheRead,
        source: 'litellm',
        updatedAt: now,
      },
    }).run()

    _cache[mid] = pricing
  }
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => resolve(data))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}
