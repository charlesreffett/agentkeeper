import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient } from '@opencode-ai/sdk/client'
import type { HarnessAdapter, HarnessAuth, HarnessAuthDetail, HarnessAvailability, HarnessCapabilities, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { secrets, SECRET_KEYS } from '../secrets'
import { isMissingBinary } from './diagnostics'

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
  /** OpenCode runs as a separate server process, so the builtin in-process
   *  `agentkeeper` MCP object can't be handed to it — hence `mcpServers:false`,
   *  and `agencies:false` (agency coordination needs that MCP + tool removal).
   *  `disallowedTools` awaits an SDK audit (commit: opencode option wiring).
   *  Commands/skills have no OpenCode surface yet (dir helpers return ''). */
  readonly capabilities: HarnessCapabilities = {
    mcpServers: false,
    disallowedTools: true,
    systemPromptAppend: true,
    permissionModes: false,
    effort: false,
    commands: false,
    skills: false,
    agencies: false,
  }

  /** Singleton server — lazily started, shared across all runSession calls. */
  private singleton: { url: string; client: OpencodeClient; close(): void } | null = null
  private starting: Promise<{ url: string; client: OpencodeClient; close(): void }> | null = null

  /** Concrete model the `default` alias resolves to. Populated the first time
   *  models are queried; anthropic may be unconfigured, so this reflects what
   *  the server can actually reach. */
  private preferredDefault: string | null = null

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
      const modelId = await this.resolveModel(options.model)
      const promptResp = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts,
          ...(modelId ? { model: parseModelId(modelId) } : {}),
          ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
          // Tool removal — opencode takes an enable/disable map keyed by its own
          // (harness-native) tool names.
          ...(options.disallowedTools?.length
            ? { tools: Object.fromEntries(options.disallowedTools.map((t) => [t, false])) }
            : {}),
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

  async runPrompt(prompt: string, options: HarnessSessionOptions): Promise<string> {
    let text = ''
    for await (const ev of this.runSession(prompt, options)) {
      if (ev.type === 'assistant') {
        const t = extractText((ev.message as { content?: unknown }).content)
        if (t) text = t
      } else if (ev.type === 'result') {
        break
      }
    }
    return text
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
      // Take a single turn and stop. The queue stays open for the session's
      // lifetime (streaming input for the Claude SDK), so iterating to
      // completion would block forever — promptAsync sends one prompt per
      // runSession, so we consume the first buffered message and return.
      for await (const msg of options.messageQueue) {
        const text = extractText(msg.message?.content)
        if (text) parts.push({ type: 'text', text })
        break
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
    // OpenCode streams parts for BOTH the user and assistant messages, and part
    // text is a full snapshot (not a delta). Track each message's role from
    // message.updated (which reliably precedes its parts) so we only surface
    // assistant output — otherwise the user's own prompt is echoed back as an
    // assistant reply. Usage is stashed and emitted once, at session.idle;
    // message.updated fires repeatedly and must not each emit a terminal result.
    const roleByMessage = new Map<string, string>()
    let usage: Record<string, unknown> = {}
    let totalCostUsd = 0

    const isAssistant = (messageID: string | undefined): boolean =>
      !!messageID && roleByMessage.get(messageID) === 'assistant'

    for await (const event of eventStream.stream) {
      // Only process events for our session.
      const props = (event as Record<string, unknown>)['properties'] as Record<string, unknown> | undefined
      if (props && typeof props['sessionID'] === 'string' && props['sessionID'] !== sessionId) {
        continue
      }

      const eventType = (event as Record<string, unknown>)['type'] as string

      switch (eventType) {
        case 'message.updated': {
          const info = props?.['info'] as Record<string, unknown> | undefined
          const id = info?.['id'] as string | undefined
          const role = info?.['role'] as string | undefined
          if (id && role) roleByMessage.set(id, role)
          if (role === 'assistant') {
            const tokens = info!['tokens'] as Record<string, unknown> | undefined
            const cache = tokens?.['cache'] as Record<string, unknown> | undefined
            usage = {
              input_tokens: (tokens?.['input'] as number) ?? 0,
              output_tokens: (tokens?.['output'] as number) ?? 0,
              cache_read_input_tokens: (cache?.['read'] as number) ?? 0,
              cache_creation_input_tokens: (cache?.['write'] as number) ?? 0,
            }
            totalCostUsd = (info!['cost'] as number) ?? totalCostUsd
          }
          break
        }

        case 'message.part.updated': {
          const part = props?.['part'] as Record<string, unknown> | undefined
          if (!part) break
          const partType = part['type'] as string
          const messageID = part['messageID'] as string
          // Suppress the user's echoed prompt — only assistant parts.
          if (!isAssistant(messageID)) break

          if (partType === 'text') {
            // part.text is the full accumulated snapshot for this part.
            const text = (part['text'] as string) ?? ''
            yield {
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text }],
              },
            }
          } else if (partType === 'tool') {
            const toolState = part['state'] as Record<string, unknown> | undefined
            const toolName = part['tool'] as string
            const callID = part['callID'] as string

            if (toolState?.['status'] === 'pending' || toolState?.['status'] === 'running') {
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

        case 'session.idle': {
          // The real terminal signal — emit the single result with stashed usage.
          yield {
            type: 'result',
            subtype: 'success',
            usage,
            total_cost_usd: totalCostUsd,
          }
          return
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
    const [provResp, cfgResp] = await Promise.all([client.config.providers(), client.config.get()])
    const data = provResp.data
    if (!data) return []

    const concrete: HarnessModelInfo[] = []
    for (const provider of data.providers) {
      for (const model of Object.values(provider.models)) {
        concrete.push({
          value: `${provider.id}/${model.id}`,
          label: model.name,
          description: provider.name,
          resolvedModel: `${provider.id}/${model.id}`,
          supportsEffort: model.capabilities?.reasoning ?? false,
        })
      }
    }

    // Opencode has no `default` model id — the TUI's selection comes from the
    // user's config `model` (e.g. `opencode/big-pickle`). Flag that concrete
    // model as the default instead of inventing a synthetic row.
    const preferred = this.pickDefault(cfgResp.data?.model, data.default, concrete)
    this.preferredDefault = preferred ?? null

    return concrete.map((m) => (m.value === preferred ? { ...m, isDefault: true } : m))
  }

  /** The concrete default model, resolved to a real enumerated id: opencode's
   *  own configured default (config `model`, what the TUI runs) if present,
   *  then the adapter's declared model, then the anthropic provider default,
   *  then the first reported model. */
  private pickDefault(
    configModel: string | undefined,
    providerDefaults: Record<string, string> | undefined,
    concrete: HarnessModelInfo[],
  ): string | undefined {
    const anthropicDefault = providerDefaults?.['anthropic']
      ? `anthropic/${providerDefaults['anthropic']}`
      : undefined
    return (
      concrete.find((m) => m.value === configModel)?.value ??
      concrete.find((m) => m.value === this.defaultModel)?.value ??
      concrete.find((m) => m.value === anthropicDefault)?.value ??
      concrete[0]?.value
    )
  }

  /** Turn a stored model value into a concrete providerID/modelID the server can
   *  run: `default`/empty resolves to the reachable default (cached). */
  private async resolveModel(model?: string): Promise<string | undefined> {
    if (model && model !== 'default') return model
    if (this.preferredDefault) return this.preferredDefault
    try {
      await this.getSupportedModels()
    } catch {
      return this.defaultModel
    }
    return this.preferredDefault ?? this.defaultModel
  }

  /** Shut down the singleton server. Called on app exit or adapter reset. */
  close(): void {
    if (this.singleton) {
      this.singleton.close()
      this.singleton = null
    }
  }

  dispose(): void {
    this.close()
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

  async probeAvailability(): Promise<HarnessAvailability> {
    try {
      await execFileAsync('opencode', ['--version'])
      return { available: true }
    } catch (error) {
      if (isMissingBinary(error)) {
        return {
          available: false,
          reason: "`opencode` not found on PATH — install opencode or set OPENCODE_BIN.",
        }
      }
      return {
        available: false,
        reason: `\`opencode --version\` failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** OpenCode authenticates per provider through `opencode auth login` (stored
   *  in its auth.json) or falls back to the app's stored Anthropic API key for
   *  anthropic/* models. */
  async probeAuthDetail(): Promise<HarnessAuthDetail> {
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json')
    let providers: string[] = []
    try {
      const raw = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Record<string, { type?: string } | undefined>
      providers = Object.keys(raw).filter((k) => !!raw[k]?.type)
    } catch {
      // no auth store yet — providers stays empty
    }
    const apiKey = await secrets.get(SECRET_KEYS.anthropicApiKey)
    const providerDetail = providers.length > 0
      ? `Logged in: ${providers.join(', ')}.`
      : 'No `opencode auth login` providers.'
    if (providers.length > 0 || apiKey) {
      return {
        type: 'provider',
        ready: true,
        providers,
        detail: `${providerDetail}${apiKey ? ' Sessions may also use the stored Anthropic API key.' : ''}`,
      }
    }
    return {
      type: 'provider',
      ready: false,
      providers: [],
      detail: 'Not authenticated — run `opencode auth login` or add an Anthropic API key in Settings.',
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
