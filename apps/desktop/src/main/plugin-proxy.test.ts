import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { closeAllProxies, createPluginProxy } from './plugin-proxy'

afterEach(() => closeAllProxies())

function requestThroughProxy(proxyUrl: string, targetUrl: string): Promise<{ status: number; body: string }> {
  const proxy = new URL(proxyUrl)
  const target = new URL(targetUrl)
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: proxy.hostname,
      port: proxy.port,
      path: target.href,
      headers: { host: target.host },
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.on('error', reject)
    request.end()
  })
}

describe('plugin network proxy boundary', () => {
  it('rejects hosts outside the manifest allowlist', async () => {
    const proxy = await createPluginProxy('example', ['api.example.test'])
    const response = await requestThroughProxy(proxy.url, 'http://blocked.example.test/data')
    expect(response.status).toBe(403)
    expect(response.body).toContain('NetworkPermissionDenied')
  })

  it('forwards requests only when the target host is allowed', async () => {
    const target = http.createServer((_request, response) => response.end('allowed'))
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
    try {
      const port = (target.address() as AddressInfo).port
      const proxy = await createPluginProxy('example', ['127.0.0.1'])
      const response = await requestThroughProxy(proxy.url, `http://127.0.0.1:${port}/data`)
      expect(response).toEqual({ status: 200, body: 'allowed' })
    } finally {
      await new Promise<void>((resolve, reject) => target.close(error => error ? reject(error) : resolve()))
    }
  })
})
