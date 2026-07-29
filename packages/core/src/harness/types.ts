export interface HarnessAuth {
  type: string
  key?: string
  env?: Record<string, string>
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

export type HarnessEvent =
  | { type: 'user'; message: { role: 'user'; content: unknown }; uuid?: string; session_id?: string }
  | { type: 'assistant'; message: { role: 'assistant'; content: unknown; model?: string }; uuid?: string; session_id?: string }
  | { type: 'system'; subtype: string; [key: string]: unknown }
  | { type: 'result'; subtype: string; [key: string]: unknown }
  | { type: 'stream_event'; [key: string]: unknown }

export interface HarnessAdapter {
  readonly id: string
  readonly name: string

  runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent>
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
  isAvailable(): Promise<boolean>
  encodeCwd(cwd: string): string
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
