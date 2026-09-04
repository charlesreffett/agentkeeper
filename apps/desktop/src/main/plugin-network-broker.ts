import * as dns from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import {
  isNetworkOriginAllowed,
  parseNetworkOriginPattern,
  type PluginManifest,
} from '@agentkeeper/sdk'
import type { PluginAuthority } from './plugin-authority.js'
import { authorityFromManifest } from './plugin-authority.js'

const MAX_URL_LENGTH = 2_048
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BODY_BYTES = 20 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 30_000

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface PluginNetworkRequest {
  url: string
  init?: {
    method?: string
    headers?: Array<[string, string]>
    body?: ArrayBuffer
  }
}

export interface PluginNetworkResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: ArrayBuffer
}

function isPrivateOrReservedIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase()
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.')
  }
  return true
}

function exactOriginWasGranted(patterns: readonly string[], target: URL): boolean {
  return patterns.some(value => {
    const pattern = parseNetworkOriginPattern(value)
    if (!pattern || pattern.wildcard) return false
    const port = target.port || (target.protocol === 'https:' ? '443' : '80')
    return pattern.scheme === target.protocol
      && pattern.hostname === target.hostname
      && pattern.port === port
  })
}

async function resolvePinnedAddress(target: URL, patterns: readonly string[]): Promise<{ address: string; family: 4 | 6 }> {
  const literalFamily = net.isIP(target.hostname)
  if (literalFamily) return { address: target.hostname, family: literalFamily as 4 | 6 }

  const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true })
  if (addresses.length === 0) throw new Error('NetworkPermissionDenied: target did not resolve')
  const allowPrivate = exactOriginWasGranted(patterns, target)
  if (!allowPrivate && addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
    throw new Error('NetworkPermissionDenied: wildcard grants cannot resolve to private or reserved addresses')
  }
  const selected = addresses.find(item => item.family === 4) ?? addresses[0]!
  return { address: selected.address, family: selected.family as 4 | 6 }
}

function normalizeHeaders(input: Array<[string, string]> | undefined, bodyLength: number): Record<string, string> {
  if ((input?.length ?? 0) > 128) throw new Error('Network request has too many headers')
  const headers: Record<string, string> = {}
  for (const [rawName, rawValue] of input ?? []) {
    const name = rawName.toLowerCase()
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/.test(name)) throw new Error('Network request contains an invalid header name')
    if (rawValue.length > 16_384 || /[\r\n\0]/.test(rawValue)) throw new Error(`Network request contains an invalid ${name} header`)
    if (!FORBIDDEN_REQUEST_HEADERS.has(name)) headers[name] = rawValue
  }
  headers['accept-encoding'] = 'identity'
  if (bodyLength > 0) headers['content-length'] = String(bodyLength)
  return headers
}

async function requestOnce(
  target: URL,
  patterns: readonly string[],
  method: string,
  headers: Record<string, string>,
  body: Uint8Array | undefined,
  signal?: AbortSignal,
): Promise<{ status: number; statusText: string; headers: Array<[string, string]>; body: Uint8Array }> {
  const resolved = await resolvePinnedAddress(target, patterns)
  const client = target.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: target.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        ...headers,
        host: target.host,
      },
      ...(target.protocol === 'https:' && !net.isIP(target.hostname)
        ? { servername: target.hostname }
        : {}),
    }, response => {
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_RESPONSE_BODY_BYTES) {
          request.destroy(new Error(`Network response exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseHeaders: Array<[string, string]> = []
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          responseHeaders.push([response.rawHeaders[index]!, response.rawHeaders[index + 1] ?? ''])
        }
        const responseBody = Buffer.concat(chunks)
        resolve({
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: responseHeaders,
          body: new Uint8Array(responseBody.buffer, responseBody.byteOffset, responseBody.byteLength),
        })
      })
      response.on('error', reject)
    })
    const abort = () => request.destroy(new Error('Network request aborted'))
    signal?.addEventListener('abort', abort, { once: true })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Network request timed out')))
    request.once('close', () => signal?.removeEventListener('abort', abort))
    request.once('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

export async function fetchForPlugin(
  authorityInput: PluginAuthority | PluginManifest,
  input: PluginNetworkRequest,
  signal?: AbortSignal,
): Promise<PluginNetworkResponse> {
  const authority = 'networkOrigins' in authorityInput ? authorityInput : authorityFromManifest(authorityInput)
  if (!authority.permissions.includes('network') || !authority.networkOrigins.length) {
    throw new Error('NetworkPermissionDenied: plugin has no network permission')
  }
  if (input.url.length > MAX_URL_LENGTH) throw new Error('Network request URL is too long')
  let target = new URL(input.url)
  let method = (input.init?.method ?? 'GET').toUpperCase()
  if (!/^[A-Z]{1,16}$/.test(method) || method === 'CONNECT' || method === 'TRACE') {
    throw new Error('Network request method is not allowed')
  }
  let body = input.init?.body ? new Uint8Array(input.init.body) : undefined
  if ((body?.byteLength ?? 0) > MAX_REQUEST_BODY_BYTES) {
    throw new Error(`Network request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`)
  }
  let headers = normalizeHeaders(input.init?.headers, body?.byteLength ?? 0)

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!isNetworkOriginAllowed(authority.networkOrigins, target)) {
      throw new Error(`NetworkPermissionDenied: origin is not declared: ${target.origin}`)
    }
    const response = await requestOnce(target, authority.networkOrigins, method, headers, body, signal)
    const exactBody = response.body.buffer.slice(response.body.byteOffset, response.body.byteOffset + response.body.byteLength) as ArrayBuffer
    if (![301, 302, 303, 307, 308].includes(response.status)) return { ...response, body: exactBody }
    const location = response.headers.find(([name]) => name.toLowerCase() === 'location')?.[1]
    if (!location) return { ...response, body: exactBody }
    if (redirectCount === MAX_REDIRECTS) throw new Error('Network request exceeded redirect limit')
    const previousOrigin = target.origin
    target = new URL(location, target)
    if (target.origin !== previousOrigin) {
      for (const name of ['authorization', 'cookie', 'proxy-authorization']) delete headers[name]
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
      headers = normalizeHeaders(input.init?.headers, 0)
      delete headers['content-type']
    }
  }
  throw new Error('Network request failed')
}
