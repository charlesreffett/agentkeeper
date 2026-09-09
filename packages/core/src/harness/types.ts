export interface HarnessAuth {
  type: string
  key?: string
  env?: Record<string, string>
}

/** Free-text model ids reach the harness boundary from many places (user-typed
 *  custom models, role files, agency plans, CLI socket, iOS). Sanitize before
 *  any spawn/argv construction: allow only safe characters and cap the length
 *  so a hostile or malformed value can't smuggle shell metacharacters into a
 *  subprocess. Returns null when off-pattern; callers fall back to the harness
 *  default instead of forwarding it. */
export function sanitizeCustomModel(model: string): string | null {
  if (model.length > 200) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(model)) return null
  return model
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
  status: 'authenticated' | 'unauthenticated' | 'expired' | 'unknown' | 'not-required'
  /** Authenticated provider ids (e.g. opencode's auth store) — empty otherwise. */
  providers?: string[]
  detail?: string
}

export type HarnessConfigurationField = {
  id: string
  label: string
  description?: string
  required?: boolean
  advanced?: boolean
  placeholder?: string
  /** Simple adapters can map a field directly into their child environment. */
  env?: string
} & (
  | { type: 'text' | 'path' | 'url'; secret?: false }
  | { type: 'secret'; secret: true }
  | { type: 'boolean'; defaultValue?: boolean }
  | { type: 'select'; choices: Array<{ value: string; label: string }> }
)

export interface HarnessConfigurationDescriptor {
  fields: HarnessConfigurationField[]
}

export interface HarnessAuthenticationDescriptor {
  login?: { command: string; args: string[]; label?: string }
}

export interface HarnessCLIOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

export type SessionControlValue = string | boolean
export type SessionControlCategory = 'effort' | 'permission' | 'mode' | 'context' | 'speed' | 'advanced'
export type SessionControlMutability = 'draft' | 'idle' | 'turn'

export interface SessionControlChoice {
  value: string
  label: string
  description?: string
  isDefault?: boolean
}

export type SessionControlDescriptor = {
  id: string
  category: SessionControlCategory | (string & {})
  label: string
  description?: string
  mutable: SessionControlMutability
} & (
  | { type: 'select'; choices: SessionControlChoice[]; defaultValue?: string }
  | { type: 'boolean'; defaultValue?: boolean }
)

export interface SessionControlSelection {
  id: string
  value: SessionControlValue
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
  /** Generic adapter-owned selections. Adapters reject unknown ids/values. */
  controlSelections?: SessionControlSelection[]
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
  /** Provider that serves the model (`anthropic`, `openai`, …). Lets the UI
   *  badge and group models by provider instead of parsing it out of `value`. */
  provider?: string
  /** Concrete model an alias/`default` resolves to, e.g. `claude-opus-4-8`. */
  resolvedModel?: string
  /** Provider-reported maximum input/context tokens. Omitted when unknown. */
  contextWindow?: number
  /** True for a configured off-catalog identifier accepted by the harness. */
  isCustom?: boolean
  supportsEffort?: boolean
  effortLevels?: HarnessEffortLevel[]
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
  isDefault?: boolean
  /** Model-specific traits (effort, context, speed, and future controls). */
  controls?: SessionControlDescriptor[]
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
  /** Point in the session lifecycle at which the adapter can change models. */
  modelSelection: 'draft-only' | 'idle' | 'turn'
  /** Whether sanitized off-catalog model identifiers can reach the harness. */
  customModels: boolean
}

export interface HarnessSkillLocation {
  /** Directory containing one subdirectory per skill. */
  path: string
  /** Native locations are suitable compatibility-link targets. Compatible
   *  locations are read by the harness but owned by another convention. */
  kind: 'native' | 'compatible'
  /** True when this location is AgentKeeper's shared `.agents/skills` store. */
  canonical?: boolean
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
  readonly configuration?: HarnessConfigurationDescriptor
  readonly authentication?: HarnessAuthenticationDescriptor

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
  /** Every skill root this harness discovers, in native-first order. */
  getSkillLocations(scope: 'project' | 'global', projectPath?: string): HarnessSkillLocation[]
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
