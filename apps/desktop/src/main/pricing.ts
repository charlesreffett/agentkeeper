import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'

// All prices in USD per 1 million tokens.
export interface ModelPricing {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export interface PriceTable {
  source: 'bundled' | 'litellm-cache'
  fetchedAt: string | null
  models: Record<string, ModelPricing>
}

// Bundled from Anthropic pricing page 2026-05-05.
const BUNDLED_MODELS: Record<string, ModelPricing> = {
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

export const BUNDLED: PriceTable = { source: 'bundled', fetchedAt: null, models: BUNDLED_MODELS }

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const CACHE_FILE = 'pricing-cache.json'

let _userDataPath = ''
let _active: PriceTable = BUNDLED

export function init(userDataPath: string): void {
  _userDataPath = userDataPath
  try {
    const raw = fs.readFileSync(path.join(userDataPath, CACHE_FILE), 'utf8')
    const cached = JSON.parse(raw) as PriceTable
    if (cached.models && Object.keys(cached.models).length > 0) _active = cached
  } catch {
    // no cache file yet
  }
}

// Strip trailing date suffix e.g. -20250715 and lowercase.
function normalizeId(id: string): string {
  return id.toLowerCase().replace(/-\d{8}$/, '')
}

export function lookupPricing(modelId: string): ModelPricing | null {
  const n = normalizeId(modelId)
  for (const table of _active === BUNDLED ? [BUNDLED] : [_active, BUNDLED]) {
    if (table.models[n]) return table.models[n]
    for (const [key, p] of Object.entries(table.models)) {
      if (n.startsWith(key) || key.startsWith(n)) return p
    }
  }
  return null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
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

export function getActivePriceTable(): PriceTable {
  return _active
}

export async function refreshFromLiteLLM(): Promise<PriceTable> {
  const raw = await fetchUrl(LITELLM_URL)
  const json = JSON.parse(raw) as Record<string, unknown>

  const models: Record<string, ModelPricing> = { ...BUNDLED_MODELS }
  const M = 1_000_000

  for (const [id, entry] of Object.entries(json)) {
    if (!id.startsWith('claude-')) continue
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const inp = e['input_cost_per_token']
    const out = e['output_cost_per_token']
    if (typeof inp !== 'number' || typeof out !== 'number') continue

    const cacheWrite =
      typeof e['cache_creation_input_token_cost'] === 'number'
        ? (e['cache_creation_input_token_cost'] as number) * M
        : inp * M * 1.25
    const cacheRead =
      typeof e['cache_read_input_token_cost'] === 'number'
        ? (e['cache_read_input_token_cost'] as number) * M
        : inp * M * 0.1

    models[normalizeId(id)] = {
      input: inp * M,
      output: out * M,
      cacheWrite5m: cacheWrite,
      cacheWrite1h: cacheWrite * 1.6,
      cacheRead,
    }
  }

  const table: PriceTable = {
    source: 'litellm-cache',
    fetchedAt: new Date().toISOString(),
    models,
  }
  fs.writeFileSync(path.join(_userDataPath, CACHE_FILE), JSON.stringify(table), 'utf8')
  _active = table
  return table
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
