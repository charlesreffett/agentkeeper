import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient } from '@opencode-ai/sdk/client'
import type { HarnessAdapter, HarnessAuth, HarnessCapabilities, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { sanitizeCustomModel } from '@agentkeeper/core'
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
  private async getOrCreateServer(): Promise<{ url: string; client: OpencodeClient; close(): void }> {
    if (this.singleton) return this.singleton

    // If a start is already in-flight, wait for it.
    if (this.starting) return this.starting

    this.starting = (async () => {
      const port = 4096 + Math.floor(Math.random() * 1000)
      // No `signal` here: the SDK binds the server process to it (bindAbort →
      // SIGTERM on abort). The server is a singleton shared across every
      // session, so tying it to any one session's AbortController would kill
      // it for all sessions when that session terminates. Startup is bounded
      // by `timeout` instead.
      const result = await createOpencode({
        hostname: '127.0.0.1',
        port,
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
    const { client } = await this.getOrCreateServer()

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

      // Wire abort once for the session's lifetime: cancels whichever turn is
      // in flight (a no-op between turns), and the turn loop checks the signal
      // so an abort while blocked on the message queue exits cleanly.
      if (options.abortController) {
        options.abortController.signal.addEventListener('abort', () => {
          // Abort is instance-scoped in opencode too — route it to the
          // session's directory or it cancels the wrong (server-cwd) instance.
          void client.session.abort({
            path: { id: sessionId },
            headers: { 'x-opencode-directory': encodeURIComponent(options.cwd) },
          }).catch(() => {})
        }, { once: true })
      }

      // Loop over queue turns on this one session — promptAsync retains the
      // session's context across calls, so turn N+1 sees everything turn N
      // produced. The first turn comes from `prompt` (runPrompt/resume) or the
      // first queued message; later turns come only from the message queue.
      // The SSE subscription is re-opened per turn: the server closes the
      // stream at session.idle, so it can't be held across turns.
      let firstTurn = true
      while (!abortController.signal.aborted) {
        const parts = firstTurn
          ? await this.buildParts(prompt, options)
          : await this.nextParts(options)
        if (!parts.length) break
        if (abortController.signal.aborted) break

        // Subscribe *before* sending the prompt so we don't miss any events.
        // The directory is required to route the SSE stream to this session's
        // opencode Instance — without it the subscription attaches to the
        // server's cwd instance and no session events ever arrive (session.idle
        // included), so the turn would hang waiting for a terminal signal.
        const eventStream = await client.event.subscribe({ query: { directory: options.cwd } })
        const modelId = await this.resolveModel(options.model)
        const promptResp = await client.session.promptAsync({
          path: { id: sessionId },
          // Opencode is instance-scoped by directory: without this the turn runs
          // on the server-cwd instance and its events (session.idle included)
          // emit on the wrong event bus, so the subscription hangs forever.
          query: { directory: options.cwd },
          body: {
            parts,
            ...(modelId ? { model: parseModelId(modelId) } : {}),
            // System prompt + tool removal are per-prompt in OpenCode, so they
            // must ride along on every turn, not just the first.
            ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
            // Tool removal — opencode takes an enable/disable map keyed by its
            // own (harness-native) tool names.
            ...(options.disallowedTools?.length
              ? { tools: Object.fromEntries(options.disallowedTools.map((t) => [t, false])) }
              : {}),
          },
        })

        if (!promptResp.response.ok) {
          throw new Error(`OpenCode prompt failed: ${promptResp.response.status}`)
        }
        firstTurn = false

        // Stream events until this turn's session.idle, translating each one
        // into HarnessEvents that the agent driver understands.
        let sawResult = false
        let turnError: string | undefined
        for await (const ev of this.consumeTurn(eventStream.stream, sessionId)) {
          yield ev
          if (ev.type === 'result') {
            sawResult = true
            if (ev.subtype === 'error') turnError = typeof ev.error === 'string' ? ev.error : undefined
          }
        }
        // session.error is terminal for the OpenCode session — surface it to
        // the driver as a stream error (status 'error' + onTerminalError)
        // instead of letting the generator end on a success-looking turn.
        if (turnError !== undefined) {
          throw new Error(turnError || 'OpenCode session errored')
        }
        // A turn that ends without a result (stream died, no idle) is also
        // terminal — don't loop back to wait for input that will never produce
        // output.
        if (!sawResult) break
      }
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
   * Convert the first-turn input into OpenCode Part objects. When messageQueue
   * is present the first message is the initial prompt; the queue stays open
   * and later messages are consumed one per turn by {@link nextParts}.
   */
  private async buildParts(
    prompt: string,
    options: HarnessSessionOptions,
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const parts: Array<{ type: 'text'; text: string }> = []

    if (options.messageQueue) {
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
   * Consume the next queued follow-up for a turn after the first. Blocks until
   * a message arrives or the queue is closed (interrupt/terminate), which
   * resolves to done — the caller then ends the loop. No queue means the
   * session is single-turn (runPrompt path).
   */
  private async nextParts(
    options: HarnessSessionOptions,
  ): Promise<Array<{ type: 'text'; text: string }>> {
    if (!options.messageQueue) return []
    for await (const msg of options.messageQueue) {
      const text = extractText(msg.message?.content)
      if (text) return [{ type: 'text', text }]
      return []
    }
    return []
  }

  /**
   * Translate OpenCode SSE events into HarnessEvents for ONE turn. The mapping:
   *
   * OpenCode Event                    → HarnessEvent
   * ──────────────────────────────────────────────────────────
   * message.part.updated (text delta) → assistant (accumulated)
   * message.part.updated (tool)       → assistant (tool_use block)
   * message.updated (assistant msg)   → result (on completion)
   * session.idle                      → result (subtype: 'success') — turn end
   * session.error                     → result (subtype: 'error')
   *
   * `stream` is a fresh per-turn SSE generator; it terminates at session.idle.
   */
  private async *consumeTurn(
    eventStream: Awaited<ReturnType<OpencodeClient['event']['subscribe']>>['stream'],
    sessionId: string,
  ): AsyncIterable<HarnessEvent> {
    // OpenCode streams parts for BOTH the user and assistant messages, and part
    // text is a full snapshot (not a delta). Suppress the user's echoed prompt
    // by tracking known USER message ids — user message.updated always precedes
    // its parts (message creation + connect replay), but assistant
    // message.updated can arrive AFTER its parts on later turns, so an unknown
    // message id is treated as assistant output. Usage is stashed and emitted
    // once, at session.idle; message.updated fires repeatedly and must not each
    // emit a terminal result.
    const userMessageIds = new Set<string>()
    let usage: Record<string, unknown> = {}
    let totalCostUsd = 0

    for await (const event of eventStream) {
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
          if (id && role === 'user') userMessageIds.add(id)
          if (id && role === 'assistant') {
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
          // Suppress the user's echoed prompt — only assistant parts. Unknown
          // ids are assistant (see above).
          if (userMessageIds.has(messageID)) break

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
   *  run: `default`/empty resolves to the reachable default (cached). Custom
   *  (free-text) models are legitimate, but only when they pass the pattern
   *  guard — anything off-pattern falls back to the default instead of reaching
   *  promptAsync. */
  private async resolveModel(model?: string): Promise<string | undefined> {
    if (model && model !== 'default') return sanitizeCustomModel(model) ?? undefined
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

  /** Root of opencode's per-session JSON tree. Reads go through
   *  {@link readOpenCodeTranscript}, which resolves `message/<id>` and
   *  `part/<id>` under this dir — not Claude's flat `<sessionId>.jsonl`. */
  getSessionsRoot(): string {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage')
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
