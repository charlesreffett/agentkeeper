import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient } from '@opencode-ai/sdk/client'
import type { HarnessAdapter, HarnessAuth, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { secrets, SECRET_KEYS } from '../secrets'

const execFileAsync = promisify(execFile)

/**
 * OpenCode harness adapter — runs agent sessions via the OpenCode server
 * (https://opencode.ai). OpenCode is model-agnostic and supports 75+ LLM
 * providers through the Vercel AI SDK.
 *
 * Architecture:
 *   1. A singleton OpenCode server is spawned on first use and reused across
 *      all sessions — this avoids SQLite migration conflicts from multiple
 *      server processes trying to migrate the same shared state DB.
 *   2. The SDK client connects over HTTP and manages sessions/messages.
 *   3. SSE event streaming provides real-time assistant output.
 *   4. The adapter translates OpenCode events into the HarnessEvent format
 *      consumed by the agent driver.
 *
 * Resume: OpenCode uses a parent-child session model. When `options.resume` is
 * set, a new session is created with `parentID` pointing to the previous
 * session, preserving its context.
 */
export class OpenCodeHarnessAdapter implements HarnessAdapter {
  readonly id = 'opencode'
  readonly name = 'OpenCode'
  readonly defaultModel = 'anthropic/claude-sonnet-4-20250514'

  /** Singleton server — lazily started, shared across all runSession calls. */
  private singleton: { url: string; client: OpencodeClient; close(): void } | null = null
  private starting: Promise<{ url: string; client: OpencodeClient; close(): void }> | null = null

  /**
   * Get or create the shared OpenCode server. Only one process runs at a time
   * to avoid SQLite migration conflicts.
   */
  private async getOrCreateServer(abortController?: AbortController): Promise<{ url: string; client: OpencodeClient; close(): void }> {
    if (this.singleton) return this.singleton

    // If a start is already in-flight, wait for it.
    if (this.starting) return this.starting

    this.starting = (async () => {
      const port = 4096 + Math.floor(Math.random() * 1000)
      const result = await createOpencode({
        hostname: '127.0.0.1',
        port,
        signal: abortController?.signal,
        timeout: 15_000,
      })
      const client = createOpencodeClient({ baseUrl: result.server.url })
      this.singleton = { url: result.server.url, client, close: result.server.close }
      return this.singleton
    })()

    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  async *runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent> {
    const abortController = options.abortController ?? new AbortController()
    const { client } = await this.getOrCreateServer(abortController)

    try {
      // Create a session — if resuming, link to the parent session.
      const sessionBody: { title: string; parentID?: string } = {
        title: 'AgentKeeper Session',
      }
      if (options.resume) {
        sessionBody.parentID = options.resume
      }
      const sessionResp = await client.session.create({
        body: sessionBody,
        query: { directory: options.cwd },
      })
      if (!sessionResp.data) {
        throw new Error(`Failed to create OpenCode session: ${JSON.stringify(sessionResp.error)}`)
      }
      const sessionId = sessionResp.data.id

      // Yield the system/init event so the agent driver can capture the
      // session id for resume support.
      yield {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
      } satisfies HarnessEvent

      // Build the message parts from the prompt or the message queue.
      const parts = await this.buildParts(prompt, options)

      // Subscribe to the SSE event stream *before* sending the prompt so we
      // don't miss any events.
      const eventStream = await client.event.subscribe()

      // Send the prompt asynchronously — the SSE stream will carry the
      // response events.
      const promptResp = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts,
          ...(options.model ? {
            model: parseModelId(options.model),
          } : {}),
          ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        },
      })

      if (!promptResp.response.ok) {
        throw new Error(`OpenCode prompt failed: ${promptResp.response.status}`)
      }

      // Wire abort: cancel the in-progress prompt when the caller aborts.
      if (options.abortController) {
        options.abortController.signal.addEventListener('abort', () => {
          void client.session.abort({ path: { id: sessionId } }).catch(() => {})
        }, { once: true })
      }

      // Stream events from the SSE feed, translating each one into
      // HarnessEvents that the agent driver understands.
      yield* this.consumeEventStream(eventStream, sessionId)
    } catch (error) {
      // If the singleton server died, clear it so the next session spawns fresh.
      if (isConnectionError(error)) {
        this.singleton?.close()
        this.singleton = null
      }
      throw error
    }
  }

  /**
   * Convert the incoming prompt + messageQueue into OpenCode Part objects.
   * When messageQueue is present the first message is the initial prompt and
   * subsequent ones are follow-ups.
   */
  private async buildParts(
    prompt: string,
    options: HarnessSessionOptions,
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const parts: Array<{ type: 'text'; text: string }> = []

    if (options.messageQueue) {
      // Drain the async queue — each message is a user turn.
      for await (const msg of options.messageQueue) {
        const text = extractText(msg.message?.content)
        if (text) parts.push({ type: 'text', text })
      }
    } else if (prompt) {
      parts.push({ type: 'text', text: prompt })
    }

    return parts
  }

  /**
   * Translate OpenCode SSE events into HarnessEvents. The mapping:
   *
   * OpenCode Event                    → HarnessEvent
   * ──────────────────────────────────────────────────────────
   * message.part.updated (text delta) → assistant (accumulated)
   * message.part.updated (tool)       → assistant (tool_use block)
   * message.updated (assistant msg)   → result (on completion)
   * session.idle                      → result (subtype: 'success')
   * session.error                     → result (subtype: 'error')
   */
  private async *consumeEventStream(
    eventStream: Awaited<ReturnType<OpencodeClient['event']['subscribe']>>,
    sessionId: string,
  ): AsyncIterable<HarnessEvent> {
    // Accumulate text deltas per message so we can emit complete assistant
    // messages once a turn finishes.
    const textAccumulator = new Map<string, string>()
    const toolCalls = new Map<string, { id: string; name: string; input: unknown }>()

    for await (const event of eventStream.stream) {
      // Only process events for our session.
      const props = (event as Record<string, unknown>)['properties'] as Record<string, unknown> | undefined
      if (props && typeof props['sessionID'] === 'string' && props['sessionID'] !== sessionId) {
        continue
      }

      const eventType = (event as Record<string, unknown>)['type'] as string

      switch (eventType) {
        case 'message.part.updated': {
          const part = props?.['part'] as Record<string, unknown> | undefined
          if (!part) break
          const partType = part['type'] as string
          const messageID = part['messageID'] as string

          if (partType === 'text') {
            // Accumulate text deltas.
            const delta = (props?.['delta'] as string) ?? (part['text'] as string) ?? ''
            const prev = textAccumulator.get(messageID) ?? ''
            textAccumulator.set(messageID, prev + delta)

            // Yield an assistant event with the accumulated text so far.
            yield {
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: textAccumulator.get(messageID)! }],
              },
            }
          } else if (partType === 'tool') {
            const toolState = part['state'] as Record<string, unknown> | undefined
            const toolName = part['tool'] as string
            const callID = part['callID'] as string

            if (toolState?.['status'] === 'pending' || toolState?.['status'] === 'running') {
              // Tool call starting.
              toolCalls.set(callID, {
                id: callID,
                name: toolName,
                input: toolState?.['input'] ?? {},
              })
              yield {
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: [{
                    type: 'tool_use',
                    id: callID,
                    name: toolName,
                    input: toolState?.['input'] ?? {},
                  }],
                },
              }
            } else if (toolState?.['status'] === 'completed' || toolState?.['status'] === 'error') {
              // Tool result.
              yield {
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: [{
                    type: 'tool_result',
                    tool_use_id: callID,
                    content: toolState?.['output'] ?? '',
                    is_error: toolState?.['status'] === 'error',
                  }],
                },
              }
            }
          }
          break
        }

        case 'message.updated': {
          const info = props?.['info'] as Record<string, unknown> | undefined
          if (info?.['role'] === 'assistant') {
            // Assistant message completed — yield a result event with usage.
            const tokens = info['tokens'] as Record<string, unknown> | undefined
            const cache = tokens?.['cache'] as Record<string, unknown> | undefined
            yield {
              type: 'result',
              subtype: info['error'] ? 'error' : 'success',
              usage: {
                input_tokens: (tokens?.['input'] as number) ?? 0,
                output_tokens: (tokens?.['output'] as number) ?? 0,
                cache_read_input_tokens: (cache?.['read'] as number) ?? 0,
                cache_creation_input_tokens: (cache?.['write'] as number) ?? 0,
              },
              total_cost_usd: (info['cost'] as number) ?? 0,
            }
          }
          break
        }

        case 'session.idle': {
          // Session is idle — final result signal.
          yield {
            type: 'result',
            subtype: 'success',
          }
          return // End the stream.
        }

        case 'session.error': {
          const error = props?.['error'] as Record<string, unknown> | undefined
          yield {
            type: 'result',
            subtype: 'error',
            error: error?.['message'] ?? 'Unknown OpenCode error',
          }
          return
        }
      }
    }
  }

  /**
   * Authoritative model list — the running OpenCode server reports every
   * provider it can reach (env/auth-configured), each with its concrete models.
   * Spins the singleton server on first call; models.ts caches the result.
   */
  async getSupportedModels(): Promise<HarnessModelInfo[]> {
    const { client } = await this.getOrCreateServer()
    const resp = await client.config.providers()
    const data = resp.data
    if (!data) return []

    // Per-provider default model ids, e.g. { anthropic: 'claude-sonnet-4-...' }.
    const providerDefaults = (data.default ?? {}) as Record<string, string>

    const models: HarnessModelInfo[] = []
    for (const provider of data.providers) {
      for (const model of Object.values(provider.models)) {
        models.push({
          value: `${provider.id}/${model.id}`,
          label: `${provider.name} · ${model.name}`,
          resolvedModel: `${provider.id}/${model.id}`,
          supportsEffort: model.capabilities?.reasoning ?? false,
        })
      }
    }

    // One default: prefer the adapter's declared model, else the anthropic
    // provider default, else the first model reported.
    const anthropicDefault = providerDefaults['anthropic']
      ? `anthropic/${providerDefaults['anthropic']}`
      : undefined
    const preferred =
      models.find((m) => m.value === this.defaultModel)?.value ??
      models.find((m) => m.value === anthropicDefault)?.value ??
      models[0]?.value
    for (const m of models) {
      if (m.value === preferred) m.isDefault = true
    }

    return models
  }

  /** Shut down the singleton server. Called on app exit or adapter reset. */
  close(): void {
    if (this.singleton) {
      this.singleton.close()
      this.singleton = null
    }
  }

  // ─── Path helpers ────────────────────────────────────────────────────────

  getSessionsRoot(): string {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'sessions')
  }

  getCommandsDir(_scope: 'project' | 'global', _projectPath?: string): string {
    return ''
  }

  getSkillsDir(_scope: 'project' | 'global', _projectPath?: string): string {
    return ''
  }

  getPluginsDir(): string {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'plugins')
  }

  getSettingsPath(): string {
    return path.join(os.homedir(), '.config', 'opencode', 'config.json')
  }

  encodeCwd(cwd: string): string {
    return cwd.replaceAll('\\', '-').replaceAll('/', '-').replaceAll(':', '-')
  }

  // ─── CLI ─────────────────────────────────────────────────────────────────

  async runCLI(args: string[], options?: HarnessCLIOptions): Promise<string> {
    const { stdout } = await execFileAsync('opencode', args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      timeout: options?.timeout,
    })
    return stdout
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  async resolveAuth(): Promise<HarnessAuth> {
    const key = await secrets.get(SECRET_KEYS.anthropicApiKey)
    if (key) {
      return { type: 'api-key', key, env: { ANTHROPIC_API_KEY: key } }
    }
    return { type: 'cli' }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('opencode', ['--version'])
      return true
    } catch {
      return false
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract plain text from a Claude-style content block array or string. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>)['type'] === 'text') {
        return (block as Record<string, unknown>)['text'] as string
      }
    }
  }
  return ''
}

/**
 * Parse a model string like "anthropic/claude-sonnet-4-20250514" into the
 * providerID/modelID structure that the OpenCode SDK expects.
 */
function parseModelId(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf('/')
  if (slash === -1) {
    return { providerID: 'anthropic', modelID: model }
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  }
}

/** Check if an error is a connection/network error that indicates the server died. */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('socket hang up')
}
