import * as http from 'node:http'
import * as net from 'node:net'
import * as url from 'node:url'

export interface PluginProxy {
  url: string
  close(): void
}

const DENY_ALL_SENTINEL = 'http://127.0.0.1:0/__deny_all__'

function hostMatches(host: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // '.github.com'
    return host === pattern.slice(2) || host.endsWith(suffix)
  }
  return host === pattern
}

function isAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(p => hostMatches(host, p))
}

export async function createPluginProxy(pluginId: string, allowedHosts: string[]): Promise<PluginProxy> {
  const server = http.createServer((req, res) => {
    const reqUrl = new url.URL(req.url!, 'http://placeholder')
    const host = req.headers.host?.split(':')[0] ?? reqUrl.hostname
    if (!isAllowed(host, allowedHosts)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'NetworkPermissionDenied', host, pluginId }))
      return
    }
    const target = new url.URL(req.url!, `http://${req.headers.host}`)
    const proxyReq = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(proxyReq)
  })

  // HTTPS CONNECT tunneling
  server.on('connect', (req, clientSocket, head) => {
    const [host = '', portStr] = (req.url ?? '').split(':')
    const port = parseInt(portStr ?? '443', 10)
    if (!isAllowed(host, allowedHosts)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      clientSocket.destroy()
      return
    }
    const serverSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) serverSocket.write(head)
      serverSocket.pipe(clientSocket)
      clientSocket.pipe(serverSocket)
    })
    serverSocket.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => serverSocket.destroy())
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  const addr = server.address() as net.AddressInfo
  const proxyUrl = `http://127.0.0.1:${addr.port}`

  proxyRegistry.set(pluginId, { url: proxyUrl, close: () => server.close() })
  return { url: proxyUrl, close: () => { server.close(); proxyRegistry.delete(pluginId) } }
}

export function createDenyAllProxy(pluginId: string): PluginProxy {
  // Returns a sentinel URL; the bootstrap checks for this and installs
  // blocking agents instead of routing through a real proxy server.
  return {
    url: DENY_ALL_SENTINEL,
    close() {},
  }
}

export { DENY_ALL_SENTINEL }

export const proxyRegistry = new Map<string, PluginProxy>()

export function closeAllProxies(): void {
  for (const proxy of proxyRegistry.values()) {
    proxy.close()
  }
  proxyRegistry.clear()
}
