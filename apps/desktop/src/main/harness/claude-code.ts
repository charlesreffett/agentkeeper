import path from 'node:path'
import os from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { HarnessAdapter, HarnessAuth, HarnessAuthDetail, HarnessAvailability, HarnessCapabilities, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { sanitizeCustomModel } from '@agentkeeper/core'
import { resolveClaudeAuth, harnessSecrets } from '../secrets'
import { resolveHarnessEnvironment, resolveHarnessPath } from './configuration'
import { resolveBin, type BinConfig } from './bin'
import { isMissingBinary } from './diagnostics'

const execFileAsync = promisify(execFile)

/** Where the claude binary comes from — resolved per spawn so a settings/env
 *  override applies on the next call without an app restart. */
const CLAUDE_BIN: BinConfig = {
  harnessId: 'claude-code',
  fallbackBins: ['claude'],
  envVar: 'CLAUDE_BIN',
}

/** SDK seam for the session subprocess — the SDK hardcodes the `claude` command
 *  from PATH, so a resolved bin (settings override / CLAUDE_BIN) has to be
 *  injected through spawnClaudeCodeProcess. Falls back to the SDK's own
 *  `options.command` when nothing resolves. */
const spawnClaudeCodeProcess: NonNullable<NonNullable<Parameters<typeof query>[0]['options']>['spawnClaudeCodeProcess']> = ((options: {
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string | undefined>
  signal: AbortSignal
}) => {
  const bin = resolveBin(CLAUDE_BIN) ?? options.command
  // spawn() types stdin/stdout as nullable; stdio defaults to 'pipe' so the
  // streams are always present, satisfying the SDK's SpawnedProcess.
  return spawn(bin, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
  }) as unknown as ReturnType<NonNullable<NonNullable<Parameters<typeof query>[0]['options']>['spawnClaudeCodeProcess']>>
})

/**
 * The desktop distribution intentionally does not package the Agent SDK's
 * ~236 MB native CLI. Supplying a path also prevents the SDK from requiring
 * that optional package before our custom spawn hook gets a chance to select
 * the configured/PATH binary.
 */
function externalClaudeOptions() {
  return {
    pathToClaudeCodeExecutable: resolveBin(CLAUDE_BIN) ?? 'claude',
    spawnClaudeCodeProcess,
  } as const
}

export class ClaudeCodeHarnessAdapter implements HarnessAdapter {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'
  readonly capabilities: HarnessCapabilities = {
    mcpServers: true,
    disallowedTools: true,
    systemPromptAppend: true,
    permissionModes: true,
    effort: true,
    commands: true,
    skills: true,
    agencies: true,
    modelSelection: 'idle',
    customModels: true,
  }
  readonly configuration = {
    fields: [
      { id: 'configDir', label: 'Config directory', type: 'path' as const, env: 'CLAUDE_CONFIG_DIR', placeholder: '~/.claude', description: 'Use a separate Claude Code profile without changing HOME.' },
      { id: 'apiKey', label: 'Anthropic API key', type: 'secret' as const, secret: true as const, env: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-…', description: 'Optional Console API key stored in the OS keychain.' },
    ],
  }
  readonly authentication = {
    login: { command: 'claude', args: ['auth', 'login'], label: 'Authenticate' },
  }

  private async resolvedAuth() {
    const key = await harnessSecrets.get(this.id, 'apiKey')
    if (key) return { type: 'api-key' as const, key }
    return resolveClaudeAuth()
  }

  private childEnv(auth: Awaited<ReturnType<typeof resolveClaudeAuth>>, extra?: Record<string, string>): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
      ...(extra ?? {}),
    }
    if (auth.type === 'api-key' && auth.key) env['ANTHROPIC_API_KEY'] = auth.key
    return env
  }

  /** Model ids are free text until they hit this boundary — sanitize so an
   *  off-pattern value falls back to the SDK default rather than reaching argv. */
  private sanitizedModel(model?: string): string | undefined {
    if (!model) return undefined
    return sanitizeCustomModel(model) ?? undefined
  }

  async runPrompt(prompt: string, options: HarnessSessionOptions): Promise<string> {
    const auth = await this.resolvedAuth()
    const configuredEnv = await resolveHarnessEnvironment(this, options.env)
    const model = this.sanitizedModel(options.model)
    const q = query({
      prompt,
      options: {
        cwd: options.cwd,
        ...(model ? { model } : {}),
        env: this.childEnv(auth, configuredEnv),
        permissionMode: 'bypassPermissions',
        abortController: options.abortController,
        ...externalClaudeOptions(),
      },
    })
    let out = ''
    try {
      for await (const msg of q) {
        const m = msg as { type?: string; subtype?: string; result?: string }
        if (m.type === 'result') {
          if (m.subtype === 'success') return m.result ?? out
          throw new Error(`Prompt failed: ${m.subtype ?? 'error'}`)
        }
      }
    } finally {
      try { (q as { close?: () => void }).close?.() } catch { /* ignore */ }
    }
    return out
  }

  async *runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent> {
    const auth = await this.resolvedAuth()
    const configuredEnv = await resolveHarnessEnvironment(this, options.env)
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
      ...configuredEnv,
    }
    if (auth.type === 'api-key' && auth.key) {
      childEnv['ANTHROPIC_API_KEY'] = auth.key
    }

    const model = this.sanitizedModel(options.model)
    // The SDK forwards an aborted `abortController` to node's child_process
    // abort listener, which emits an unhandled `error` on the claude subprocess
    // (surfaces as an Electron "uncaught exception" dialog on interrupt). Hand
    // the SDK a private controller we never trip; teardown goes through
    // q.interrupt()/q.close() below, which SIGTERM/SIGKILL the child cleanly.
    const sdkAbort = new AbortController()
    const sdkOptions: Parameters<typeof query>[0]['options'] = {
      cwd: options.cwd,
      ...(model ? { model } : {}),
      ...(options.effort ? { effort: options.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
      ...(options.resume ? { resume: options.resume } : {}),
      abortController: sdkAbort,
      env: childEnv,
      permissionMode: (options.permissionMode ?? 'bypassPermissions') as 'bypassPermissions',
      settingSources: (options.settingSources ?? ['user', 'project']) as ['user', 'project'],
      includePartialMessages: options.includePartialMessages ?? true,
      ...externalClaudeOptions(),
    }

    if (options.systemPrompt || options.preset) {
      sdkOptions!.systemPrompt = {
        type: 'preset',
        preset: (options.preset ?? 'claude_code') as 'claude_code',
        ...(options.systemPrompt ? { append: options.systemPrompt } : {}),
      }
    }

    if (options.disallowedTools?.length) {
      sdkOptions!.disallowedTools = options.disallowedTools
    }

    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkOptions!.mcpServers = options.mcpServers as any
    }

    const promptInput: string | AsyncIterable<unknown> = options.messageQueue ?? prompt

    const q = query({ prompt: promptInput as string, options: sdkOptions })

    if (options.abortController) {
      options.abortController.signal.addEventListener('abort', () => {
        // interrupt() is async — a plain try/catch doesn't catch its rejection
        // (e.g. "Operation aborted" when the connection is already tearing
        // down), which otherwise surfaces as an unhandled rejection.
        try { void q.interrupt?.()?.catch(() => { /* ignore */ }) } catch { /* ignore */ }
        try { (q as { close?: () => void }).close?.() } catch { /* ignore */ }
      }, { once: true })
    }

    for await (const msg of q) {
      yield msg as unknown as HarnessEvent
    }
  }

  async getSupportedModels(): Promise<HarnessModelInfo[]> {
    const auth = await this.resolvedAuth()
    const configuredEnv = await resolveHarnessEnvironment(this)
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
      ...configuredEnv,
    }
    if (auth.type === 'api-key' && auth.key) {
      childEnv['ANTHROPIC_API_KEY'] = auth.key
    }

    const abortController = new AbortController()
    const q = query({
      prompt: 'noop',
      options: {
        abortController,
        env: childEnv,
        permissionMode: 'bypassPermissions',
        ...externalClaudeOptions(),
      },
    })
    try {
      const models = await q.supportedModels()
      return models.map((m) => ({
        value: m.value,
        label: m.displayName,
        description: m.description,
        provider: 'Anthropic',
        resolvedModel: m.resolvedModel,
        supportsEffort: m.supportsEffort,
        effortLevels: m.supportedEffortLevels,
        supportsFastMode: m.supportsFastMode,
        supportsAutoMode: m.supportsAutoMode,
        isDefault: m.value === 'default',
      }))
    } finally {
      try { await q.interrupt?.() } catch { /* ignore */ }
      try { (q as { close?: () => void }).close?.() } catch { /* ignore */ }
      abortController.abort()
    }
  }

  getSessionsRoot(): string {
    return path.join(os.homedir(), '.claude', 'projects')
  }

  getCommandsDir(scope: 'project' | 'global', projectPath?: string): string {
    if (scope === 'project') {
      return path.join(projectPath!, '.claude', 'commands')
    }
    return path.join(os.homedir(), '.claude', 'commands')
  }

  getSkillLocations(scope: 'project' | 'global', projectPath?: string) {
    if (scope === 'project') {
      return [{ path: path.join(projectPath!, '.claude', 'skills'), kind: 'native' as const }]
    }
    const configRoot = resolveHarnessPath(this, 'configDir', path.join(os.homedir(), '.claude'))
    return [{ path: path.join(configRoot, 'skills'), kind: 'native' as const }]
  }

  getPluginsDir(): string {
    return path.join(os.homedir(), '.claude', 'plugins')
  }

  getSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json')
  }

  async runCLI(args: string[], options?: HarnessCLIOptions): Promise<string> {
    const bin = resolveBin(CLAUDE_BIN)
    if (!bin) {
      throw new Error(
        "Claude binary not found — install Claude Code, set CLAUDE_BIN, or configure a bin path in settings.",
      )
    }
    const configuredEnv = await resolveHarnessEnvironment(this, options?.env)
    const { stdout } = await execFileAsync(bin, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...configuredEnv },
      timeout: options?.timeout,
    })
    return stdout
  }

  async resolveAuth(): Promise<HarnessAuth> {
    const result = await this.resolvedAuth()
    if (result.type === 'api-key') {
      return { type: 'api-key', key: result.key }
    }
    return { type: 'cli' }
  }

  async probeAuthDetail(): Promise<HarnessAuthDetail> {
    if (await harnessSecrets.has(this.id, 'apiKey')) {
      return { type: 'api-key', status: 'authenticated', detail: 'Anthropic API key stored in the keychain.' }
    }
    try {
      await this.runCLI(['auth', 'status'], { timeout: 5_000 })
      return { type: 'cli', status: 'authenticated', detail: 'Claude Code login is configured.' }
    } catch {
      return { type: 'cli', status: 'unauthenticated', detail: 'Not authenticated — run `claude auth login`.' }
    }
  }

  async probeAvailability(): Promise<HarnessAvailability> {
    const bin = resolveBin(CLAUDE_BIN)
    if (!bin) {
      return {
        available: false,
        reason: "`claude` not found on PATH — install Claude Code or set CLAUDE_BIN.",
      }
    }
    try {
      await execFileAsync(bin, ['--version'])
      return { available: true }
    } catch (error) {
      if (isMissingBinary(error)) {
        return {
          available: false,
          reason: "`claude` not found on PATH — install Claude Code or set CLAUDE_BIN.",
        }
      }
      return {
        available: false,
        reason: `\`claude --version\` failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  encodeCwd(cwd: string): string {
    return cwd.replaceAll('\\', '-').replaceAll('/', '-').replaceAll(':', '-')
  }
}
