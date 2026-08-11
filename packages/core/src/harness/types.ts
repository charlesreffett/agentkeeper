export interface HarnessAuth {
  type: string
  key?: string
  env?: Record<string, string>
}

/** Diagnostic result of whether a harness can run right now, with a reason the
 *  UI can show verbatim instead of a bare "unavailable". */
export interface HarnessAvailability {
  available: boolean
  /** Human-readable reason when not available (missing binary, --version
   *  failure, …). Absent when available. */
  reason?: string
}

/** Per-harness auth status for the diagnostics surface. `ready` means a usable
 *  credential is present; `detail` explains what's configured. */
export interface HarnessAuthDetail {
  type: string
  ready: boolean
  /** Authenticated provider ids (e.g. opencode's auth store) — empty otherwise. */
  providers?: string[]
  detail?: string
}

export interface HarnessCLIOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

export interface HarnessSessionOptions {
  model?: string
  cwd: string
  systemPrompt?: string
  preset?: string
  env?: Record<string, string>
  mcpServers?: Record<string, unknown>
  permissionMode?: string
  effort?: string
  resume?: string
  abortController?: AbortController
  /** Tools removed from the model's context entirely. The SDK's `allowedTools`
   *  is only a permission-prompt bypass list — inert under bypassPermissions —
   *  so a real restriction must go through `disallowedTools`. */
  disallowedTools?: string[]
  includePartialMessages?: boolean
  settingSources?: string[]
  messageQueue?: AsyncIterable<{ type: 'user'; message: { role: 'user'; content: unknown } }>
}

export type HarnessEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Normalized model descriptor every harness adapter reports. The harness is the
 *  only authority for which models exist — never cross-referenced against an
 *  external DB, which would surface models the harness silently remaps. */
export interface HarnessModelInfo {
  value: string
  label: string
  description?: string
  /** Concrete model an alias/`default` resolves to, e.g. `claude-opus-4-8`. */
  resolvedModel?: string
  supportsEffort?: boolean
  effortLevels?: HarnessEffortLevel[]
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
  isDefault?: boolean
}

/** What a harness can actually honor. Callers branch on these instead of on the
 *  harness id, so adding a harness is filling a struct — never editing call
 *  sites. Each field maps to a place a caller would otherwise assume Claude Code
 *  semantics (in-process MCP, tool removal, permission modes, …). */
export interface HarnessCapabilities {
  /** Can receive MCP servers — the builtin `agentkeeper` server (send_message,
   *  plan tools) is injected this way. Agencies + planner depend on it. */
  mcpServers: boolean
  /** Honors `disallowedTools` (removes a tool from the model's context). This is
   *  how agencies deny the `Agent` tool; without it, coordination breaks. */
  disallowedTools: boolean
  systemPromptAppend: boolean
  permissionModes: boolean
  effort: boolean
  /** Has a real commands dir / management surface (not a stubbed empty path). */
  commands: boolean
  skills: boolean
  /** Can run a multi-role agency. Requires `mcpServers && disallowedTools`;
   *  declared explicitly so the check is one field, not a derived expression. */
  agencies: boolean
}

export type HarnessEvent =
  | { type: 'user'; message: { role: 'user'; content: unknown }; uuid?: string; session_id?: string }
  | { type: 'assistant'; message: { role: 'assistant'; content: unknown; model?: string }; uuid?: string; session_id?: string }
  | { type: 'system'; subtype: string; [key: string]: unknown }
  | { type: 'result'; subtype: string; [key: string]: unknown }
  | { type: 'stream_event'; [key: string]: unknown }

export interface HarnessAdapter {
  readonly id: string
  readonly name: string
  /** Static baseline of what this harness honors — synchronous so the UI can
   *  paint immediately. `probeCapabilities` may refine it at runtime. */
  readonly capabilities: HarnessCapabilities

  /** Optional runtime refinement of {@link capabilities}. This is the
   *  CLI-wrapping seam: a harness that shells out to a binary parses its
   *  `--help` (see `probeHelpText`) and returns only the fields it can confirm,
   *  overriding the baseline. SDK-backed harnesses omit this — their
   *  capabilities are known from the SDK's types and never drift. */
  probeCapabilities?(): Promise<Partial<HarnessCapabilities>>

  runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent>
  /** One-shot prompt → text. Harness-agnostic replacement for callers that used
   *  to hardcode `runCLI(['-p', …])` (a Claude-only flag). Used for side tasks:
   *  commit-message suggestion, title generation, role/command scaffolding. */
  runPrompt(prompt: string, options: HarnessSessionOptions): Promise<string>
  /** Authoritative list of models this harness can run right now. Account/plan
   *  dependent; may spin up a subprocess, so callers should cache. */
  getSupportedModels(): Promise<HarnessModelInfo[]>
  getSessionsRoot(): string
  getCommandsDir(scope: 'project' | 'global', projectPath?: string): string
  getSkillsDir(scope: 'project' | 'global', projectPath?: string): string
  getPluginsDir(): string
  getSettingsPath(): string
  runCLI(args: string[], options?: HarnessCLIOptions): Promise<string>
  resolveAuth(): Promise<HarnessAuth>
  probeAvailability(): Promise<HarnessAvailability>
  /** Optional human-readable auth status for the diagnostics surface. Harnesses
   *  that only distinguish api-key vs cli (claude-code) can omit it — callers
   *  fall back to {@link resolveAuth}. */
  probeAuthDetail?(): Promise<HarnessAuthDetail>
  encodeCwd(cwd: string): string
  /** Release any long-lived resources (e.g. a spawned server) at app shutdown.
   *  Optional — harnesses that hold nothing omit it. */
  dispose?(): void | Promise<void>
}

export class HarnessRegistry {
  private adapters = new Map<string, HarnessAdapter>()
  private defaultId: string | null = null

  register(adapter: HarnessAdapter, asDefault = false): void {
    this.adapters.set(adapter.id, adapter)
    if (asDefault || this.defaultId === null) {
      this.defaultId = adapter.id
    }
  }

  get(id: string): HarnessAdapter | undefined {
    return this.adapters.get(id)
  }

  getDefault(): HarnessAdapter {
    if (!this.defaultId) throw new Error('No harness registered')
    const adapter = this.adapters.get(this.defaultId)
    if (!adapter) throw new Error(`Default harness '${this.defaultId}' not found`)
    return adapter
  }

  setDefault(id: string): void {
    if (!this.adapters.has(id)) throw new Error(`Harness '${id}' not registered`)
    this.defaultId = id
  }

  list(): HarnessAdapter[] {
    return Array.from(this.adapters.values())
  }
}
