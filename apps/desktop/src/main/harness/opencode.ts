import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChildProcess } from 'node:child_process'
import { createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient } from '@opencode-ai/sdk/client'
import type { HarnessAdapter, HarnessAuth, HarnessAuthDetail, HarnessAvailability, HarnessCapabilities, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { sanitizeCustomModel } from '@agentkeeper/core'
import { secrets, SECRET_KEYS } from '../secrets'
import { resolveBin, type BinConfig } from './bin'
import { isMissingBinary } from './diagnostics'
import { bridgeSdkMcpServer } from './mcp-http-bridge'

const execFileAsync = promisify(execFile)

/** Where the opencode server binary comes from — resolved per spawn so a
 *  settings/env override applies on the next start without an app restart. */
const OPENCODE_BIN: BinConfig = {
  harnessId: 'opencode',
  fallbackBins: ['opencode'],
  envVar: 'OPENCODE_BIN',
}

const SERVER_START_TIMEOUT_MS = 15_000

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
  /** OpenCode runs as a separate server process. In-process SDK MCP servers
   *  are exposed to it through a private loopback Streamable HTTP bridge.
   *  Commands/skills use opencode's markdown dirs — opencode discovers both its
   *  native `.config/opencode` locations and the shared agent dirs. */
  readonly capabilities: HarnessCapabilities = {
    mcpServers: true,
    disallowedTools: true,
    systemPromptAppend: true,
    permissionModes: false,
    effort: false,
    commands: true,
    skills: true,
    agencies: true,
    modelSelection: 'idle',
    customModels: true,
  }
  readonly authentication = {
    login: { command: 'opencode', args: ['auth', 'login'], label: 'Authenticate' },
  }

  /** Singleton server — lazily started, shared across all runSession calls. */
  private singleton: { url: string; client: OpencodeClient; close(): void } | null = null
  private starting: Promise<{ url: string; client: OpencodeClient; close(): void }> | null = null
  /** OpenCode MCP configuration is directory-scoped, but tool visibility is
   * prompt-scoped. Track each live session's bridge tools so a member can hide
   * its peers' identity-bound send_message closures. */
  private agencyMcpTools = new Map<string, Map<string, string[]>>()

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
      const bin = resolveBin(OPENCODE_BIN)
      if (!bin) {
        throw new Error(
          "OpenCode binary not found — install `opencode`, set OPENCODE_BIN, or configure a bin path in settings.",
        )
      }
      const port = 4096 + Math.floor(Math.random() * 1000)
      // No `signal` here: the server is a singleton shared across every
      // session, so tying its lifetime to any one session's AbortController
      // would kill it for all sessions when that session terminates. Startup
      // is bounded by SERVER_START_TIMEOUT_MS inside spawnServer instead.
      const server = await spawnServer(bin, '127.0.0.1', port)
      const client = createOpencodeClient({ baseUrl: server.url })
      this.singleton = { url: server.url, client, close: server.close }
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
    const mcpBridges: Array<{ close(): Promise<void> }> = []
    let ownMcpToolIds: string[] = []
    let mcpRegistration: { cwd: string; sessionId: string } | null = null

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

      // MCP configuration is directory-scoped in OpenCode while AgentKeeper's
      // agency MCP server is agent-scoped. Give each session a unique server
      // name, then hide every peer session's AgentKeeper tools per prompt.
      if (options.mcpServers) {
        for (const [baseName, config] of Object.entries(options.mcpServers)) {
          if ((config as { type?: string })?.type === 'sdk') {
            const bridge = await bridgeSdkMcpServer(config)
            mcpBridges.push(bridge)
            const name = `${baseName}_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
            const added = await client.mcp.add({
              query: { directory: options.cwd },
              body: { name, config: { type: 'remote', url: bridge.url, oauth: false } },
            })
            assertOpenCodeMcpConnected(name, added.data)
            ownMcpToolIds.push(...bridge.toolNames.map((toolName) =>
              `${sanitizeOpenCodeToolName(name)}_${sanitizeOpenCodeToolName(toolName)}`,
            ))
          } else {
            const external = config as {
              type?: 'stdio' | 'http' | 'sse'
              command?: string
              args?: string[]
              env?: Record<string, string>
              url?: string
              headers?: Record<string, string>
            }
            const mapped = external.command
              ? { type: 'local' as const, command: [external.command, ...(external.args ?? [])], environment: external.env }
              : external.url
                ? { type: 'remote' as const, url: external.url, headers: external.headers, oauth: false as const }
                : null
            if (mapped) {
              const added = await client.mcp.add({
                query: { directory: options.cwd },
                body: { name: baseName, config: mapped },
              })
              assertOpenCodeMcpConnected(baseName, added.data)
            }
          }
        }
      }
      if (ownMcpToolIds.length) {
        let directoryTools = this.agencyMcpTools.get(options.cwd)
        if (!directoryTools) {
          directoryTools = new Map()
          this.agencyMcpTools.set(options.cwd, directoryTools)
        }
        directoryTools.set(sessionId, ownMcpToolIds)
        mcpRegistration = { cwd: options.cwd, sessionId }
      }

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
            ...((options.systemPrompt || ownMcpToolIds.length) ? {
              system: [
                options.systemPrompt,
                ownMcpToolIds.length
                  ? `AgentKeeper coordination tools for this agent are: ${ownMcpToolIds.join(', ')}. Use these exact tool names when instructions refer to send_message or send_messages.`
                  : '',
              ].filter(Boolean).join('\n\n'),
            } : {}),
            // Tool removal — opencode takes an enable/disable map keyed by its
            // own (harness-native) tool names.
            ...this.toolRestrictions(options.cwd, options.disallowedTools ?? [], ownMcpToolIds),
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
    } finally {
      if (mcpRegistration) {
        const sessions = this.agencyMcpTools.get(mcpRegistration.cwd)
        sessions?.delete(mcpRegistration.sessionId)
        if (sessions?.size === 0) this.agencyMcpTools.delete(mcpRegistration.cwd)
      }
      await Promise.all(mcpBridges.map((bridge) => bridge.close()))
    }
  }

  private toolRestrictions(
    cwd: string,
    disallowedTools: string[],
    ownMcpToolIds: string[],
  ): { tools?: Record<string, boolean> } {
    const disabled = new Set(disallowedTools)
    // Claude Code's subagent tool is `Agent`; OpenCode calls the equivalent
    // native tool `task`. Agency members must not create an unmanaged layer of
    // subagents in either harness.
    if (disabled.has('Agent')) disabled.add('task')

    // MCP registrations are directory-scoped, so every agency member can see
    // the other members' uniquely named bridges. Disable those foreign tool
    // ids on this prompt; only this member's closure-backed server stays usable.
    if (ownMcpToolIds.length) {
      const own = new Set(ownMcpToolIds)
      for (const ids of this.agencyMcpTools.get(cwd)?.values() ?? []) {
        for (const id of ids) {
          if (!own.has(id)) disabled.add(id)
        }
      }
    }
    return disabled.size ? { tools: Object.fromEntries([...disabled].map((id) => [id, false])) } : {}
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
          contextWindow: model.limit?.context,
          provider: provider.name,
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

  /** Root of opencode's legacy per-session JSON tree. Transcript reads go
   *  through {@link readOpenCodeTranscript}, which prefers the 1.18.x SQLite
   *  store and only falls back to `message/<id>` + `part/<id>` under this dir —
   *  either way, not Claude's flat `<sessionId>.jsonl`. */
  getSessionsRoot(): string {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage')
  }

  getCommandsDir(scope: 'project' | 'global', projectPath?: string): string {
    // Markdown command files opencode discovers: `.opencode/commands/*.md`
    // (project) and `~/.config/opencode/commands/*.md` (global).
    if (scope === 'project') {
      return path.join(projectPath!, '.opencode', 'commands')
    }
    return path.join(os.homedir(), '.config', 'opencode', 'commands')
  }

  getSkillsDir(scope: 'project' | 'global', projectPath?: string): string {
    // The agent-compatible dir (`npx skills -a opencode` installs here) is the
    // canonical surface — opencode discovers `.agents/skills/<name>/SKILL.md`
    // alongside its native `.opencode`/`.config/opencode` locations, and the
    // skills manager stays consistent between install and list.
    if (scope === 'project') {
      return path.join(projectPath!, '.agents', 'skills')
    }
    return path.join(os.homedir(), '.agents', 'skills')
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
    const bin = resolveBin(OPENCODE_BIN)
    if (!bin) {
      throw new Error(
        "OpenCode binary not found — install `opencode`, set OPENCODE_BIN, or configure a bin path in settings.",
      )
    }
    const { stdout } = await execFileAsync(bin, args, {
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
    const bin = resolveBin(OPENCODE_BIN)
    if (!bin) {
      return {
        available: false,
        reason: "`opencode` not found on PATH — install opencode or set OPENCODE_BIN.",
      }
    }
    try {
      await execFileAsync(bin, ['--version'])
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
        status: 'authenticated',
        providers,
        detail: `${providerDetail}${apiKey ? ' Sessions may also use the stored Anthropic API key.' : ''}`,
      }
    }
    return {
      type: 'provider',
      status: 'unauthenticated',
      providers: [],
      detail: 'Not authenticated — run `opencode auth login` or add an Anthropic API key in Settings.',
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Spawn `opencode serve` with an explicit binary and resolve its URL from
 * stdout. Replicates the SDK's createOpencodeServer so a resolved bin path
 * (settings override / *_BIN env) can be honored — the SDK hardcodes `opencode`
 * from PATH. The signal aborts the wait; `close` kills the process tree.
 */
function spawnServer(
  bin: string,
  hostname: string,
  port: number,
  signal?: AbortSignal,
): Promise<{ url: string; close(): void }> {
  const proc: ChildProcess = spawn(bin, ['serve', `--hostname=${hostname}`, `--port=${port}`], {
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: '{}' },
  })

  const stop = (): void => {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill()
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(id)
      signal?.removeEventListener('abort', onAbort)
      proc.off('exit', onExit)
      proc.off('error', onError)
      if (err) reject(err)
      else resolve({ url: url!, close: stop })
    }

    const id = setTimeout(() => {
      stop()
      finish(new Error(`Timeout waiting for OpenCode server to start after ${SERVER_START_TIMEOUT_MS}ms`))
    }, SERVER_START_TIMEOUT_MS)

    const onAbort = (): void => {
      stop()
      finish(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'))
    }
    const onExit = (code: number): void => {
      stop()
      finish(new Error(`OpenCode server exited with code ${code}`))
    }
    const onError = (error: Error): void => {
      stop()
      finish(error)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    proc.on('exit', onExit)
    proc.on('error', onError)

    let output = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const lines = output.split('\n')
      for (const line of lines) {
        if (line.startsWith('opencode server listening')) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (match) {
            finish(null, match[1])
            return
          }
        }
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
  })
}

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

/** Matches OpenCode's MCP catalog sanitization when it builds
 * `<server>_<tool>` ids. */
function sanitizeOpenCodeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function assertOpenCodeMcpConnected(
  name: string,
  statuses: Record<string, { status: string; error?: string }> | undefined,
): void {
  const status = statuses?.[name]
  if (status?.status === 'connected') return
  const detail = status?.error ? `: ${status.error}` : ''
  throw new Error(`Failed to connect OpenCode MCP server '${name}'${detail}`)
}

/** Check if an error is a connection/network error that indicates the server died. */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('socket hang up')
}
