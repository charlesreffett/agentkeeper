import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

interface ConnectableMcpServer {
  _registeredTools?: Record<string, unknown>
  connect(transport: StreamableHTTPServerTransport): Promise<void>
  close(): Promise<void>
}

/** Exposes an SDK/in-process MCP server on a private loopback HTTP endpoint.
 * OpenCode runs out-of-process and can only attach to local or remote MCP
 * transports, so this is the boundary that lets it use AgentKeeper's
 * closure-backed tools (notably agency send_message). */
export async function bridgeSdkMcpServer(value: unknown): Promise<{
  url: string
  toolNames: string[]
  close(): Promise<void>
}> {
  const instance = (value as { type?: string; instance?: ConnectableMcpServer })?.instance
  if (!instance || typeof instance.connect !== 'function') {
    throw new Error('OpenCode can only bridge SDK MCP server objects')
  }

  const transport = new StreamableHTTPServerTransport({
    // OpenCode sends `notifications/initialized` as a second request. With the
    // SDK's stateless Node transport that request is answered with HTTP 500;
    // a stateful session gives OpenCode the Mcp-Session-Id it expects and keeps
    // the Streamable HTTP connection healthy.
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  })
  await instance.connect(transport)

  const server = http.createServer((req, res) => {
    void transport.handleRequest(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
      }
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    await transport.close()
    throw new Error('Failed to bind the OpenCode MCP bridge')
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    // createSdkMcpServer registers definitions on its McpServer instance. The
    // OpenCode tool-id endpoint only reports native tools, so the bridge must
    // carry these authoritative MCP names across the process boundary itself.
    toolNames: Object.keys(instance._registeredTools ?? {}),
    async close() {
      await transport.close().catch(() => {})
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
