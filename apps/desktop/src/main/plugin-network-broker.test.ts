import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginManifest } from '@agentkeeper/sdk'
import { fetchForPlugin } from './plugin-network-broker'

const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})
function manifest(hosts: string[], network = true): PluginManifest {
  return {
    schema_version: 1,
    id: 'network-test',
    name: 'Network Test',
    version: '1.0.0',
    entry: 'dist/index.js',
    activation_events: ['onStartup'],
    permissions: network ? ['network'] : [],
    ...(network ? { network: { hosts } } : {}),
  }
}

async function targetServer(body: string): Promise<string> {
  const server = http.createServer((_request, response) => response.end(body))
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('plugin network broker', () => {
  it('requires both permission and an exact origin grant', async () => {
    const target = await targetServer('allowed')
    await expect(fetchForPlugin(manifest([], false), { url: target })).rejects.toThrow('no network permission')
    await expect(fetchForPlugin(manifest(['http://127.0.0.1:1234']), { url: target })).rejects.toThrow('not declared')
    const response = await fetchForPlugin(manifest([target]), { url: target })
    expect(Buffer.from(response.body).toString()).toBe('allowed')
  })

  it('rechecks every redirect target against the grant', async () => {
    const blocked = await targetServer('secret')
    const redirector = http.createServer((_request, response) => {
      response.writeHead(302, { location: blocked })
      response.end()
    })
    servers.push(redirector)
    await new Promise<void>((resolve, reject) => {
      redirector.once('error', reject)
      redirector.listen(0, '127.0.0.1', resolve)
    })
    const allowed = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`
    await expect(fetchForPlugin(manifest([allowed]), { url: allowed })).rejects.toThrow('not declared')
  })

  it('does not trust a caller-controlled Host header', async () => {
    const target = await targetServer('allowed')
    const response = await fetchForPlugin(manifest([target]), {
      url: target,
      init: { headers: [['host', 'attacker.invalid'], ['connection', 'upgrade']] },
    })
    expect(Buffer.from(response.body).toString()).toBe('allowed')
  })
})
