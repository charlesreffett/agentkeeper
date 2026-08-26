import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { HarnessAdapter, HarnessAuth, HarnessAuthDetail, HarnessAvailability, HarnessCapabilities, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { sanitizeCustomModel } from '@agentkeeper/core'
import { resolveBin, type BinConfig } from './bin'
import { spawnHarnessProcess } from './cli-process'

const execFileAsync = promisify(execFile)

type RpcMessage = { jsonrpc?: string; id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }

class AcpConnection {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  readonly updates: RpcMessage[] = []
  private waiters: Array<() => void> = []

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      let message: RpcMessage
      try { message = JSON.parse(line) as RpcMessage } catch { return }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message ?? 'ACP request failed'))
        else pending.resolve(message.result)
        return
      }
      if (message.id !== undefined && message.method === 'session/request_permission') {
        const options = (message.params?.options as Array<{ optionId?: string }> | undefined) ?? []
        this.write({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'selected', optionId: options[0]?.optionId } } })
        return
      }
      this.updates.push(message)
      this.waiters.splice(0).forEach((wake) => wake())
    })
  }

  private write(message: RpcMessage) { this.child.stdin.write(`${JSON.stringify(message)}\n`) }
  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.write({ jsonrpc: '2.0', id, method, params })
    return promise
  }
  async takeUpdate(): Promise<RpcMessage> {
    while (!this.updates.length) await new Promise<void>((resolve) => this.waiters.push(resolve))
    return this.updates.shift()!
  }
  pushUpdate(message: RpcMessage) {
    this.updates.push(message)
    this.waiters.splice(0).forEach((wake) => wake())
  }
  notify(method: string, params: Record<string, unknown>) { this.write({ jsonrpc: '2.0', method, params }) }
}

type AcpHarnessConfig = {
  id: 'cursor' | 'grok'
  name: string
  bin: BinConfig
  args: string[]
  authMethod: string
  defaultModel: string
  provider: string
  login: { command: string; args: string[] }
}

export function modelsFromAcp(value: unknown, fallback: HarnessModelInfo): HarnessModelInfo[] {
  if (!value || typeof value !== 'object') return [fallback]
  const root = value as Record<string, unknown>
  const nested = root.models
  const state = nested && !Array.isArray(nested) && typeof nested === 'object'
    ? nested as Record<string, unknown>
    : root
  const list = (Array.isArray(root.models) ? root.models : state.availableModels ?? state.models) as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(list) || !list.length) return [fallback]
  const current = String(state.currentModelId ?? state.currentValue ?? '')
  return list.map((model) => {
    const value = String(model.modelId ?? model.value ?? '')
    return { value, label: String(model.name ?? model.label ?? value), description: typeof model.description === 'string' ? model.description : undefined, provider: fallback.provider, isDefault: value === current }
  }).filter((model) => !!model.value)
}

export class AcpHarnessAdapter implements HarnessAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: HarnessCapabilities = {
    mcpServers: true, disallowedTools: false, systemPromptAppend: true,
    permissionModes: true, effort: false, commands: false, skills: true,
    agencies: false, modelSelection: 'turn', customModels: true,
  }
  readonly authentication: HarnessAdapter['authentication']
  constructor(private config: AcpHarnessConfig) {
    this.id = config.id
    this.name = config.name
    this.authentication = { login: { ...config.login, label: 'Authenticate' } }
  }

  private bin(): string {
    const bin = resolveBin(this.config.bin)
    if (!bin) throw new Error(`${this.name} binary not found — install \`${this.config.bin.fallbackBins[0]}\` or configure its bin path in settings.`)
    return bin
  }
  private async connect(cwd: string, env?: Record<string, string>, signal?: AbortSignal) {
    const child = spawnHarnessProcess(this.bin(), this.config.args, { cwd, env, signal })
    const connection = new AcpConnection(child)
    const initialized = await connection.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'agentkeeper', title: 'AgentKeeper', version: '0.1.0' },
    }) as Record<string, unknown>
    const authMethods = initialized.authMethods as Array<{ id?: string }> | undefined
    if (authMethods?.some((method) => method.id === this.config.authMethod)) {
      await connection.request('authenticate', { methodId: this.config.authMethod })
    }
    return { child, connection, initialized }
  }

  async *runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent> {
    const { child, connection } = await this.connect(options.cwd, options.env, options.abortController?.signal)
    const setup = await connection.request(options.resume ? 'session/load' : 'session/new', options.resume
      ? { sessionId: options.resume, cwd: options.cwd, mcpServers: [] }
      : { cwd: options.cwd, mcpServers: [] }) as Record<string, unknown>
    const sessionId = String(setup.sessionId)
    const model = options.model && sanitizeCustomModel(options.model)
    if (model && model !== 'default') await connection.request('session/set_model', { sessionId, modelId: model })
    yield { type: 'system', subtype: 'init', session_id: sessionId }
    const text = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt
    const completion = connection.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
    let done = false
    void completion.finally(() => { done = true; connection.pushUpdate({ method: '__done' }) })
    let finalText = ''
    while (!done || connection.updates.length) {
      const message = await connection.takeUpdate()
      if (message.method === '__done') continue
      const update = message.params?.update as Record<string, unknown> | undefined
      if (message.method === 'session/update' && update?.sessionUpdate === 'agent_message_chunk') {
        const content = update.content as { type?: string; text?: string } | undefined
        if (content?.text) {
          finalText += content.text
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: content.text } }, session_id: sessionId }
        }
      } else yield { type: 'stream_event', provider: this.id, event: message }
    }
    await completion
    yield { type: 'assistant', session_id: sessionId, message: { role: 'assistant', content: [{ type: 'text', text: finalText }], model: options.model } }
    yield { type: 'result', subtype: 'success', session_id: sessionId, result: finalText }
    child.kill()
  }

  async runPrompt(prompt: string, options: HarnessSessionOptions) {
    let result = ''
    for await (const event of this.runSession(prompt, options)) if (event.type === 'result' && typeof event.result === 'string') result = event.result
    return result
  }
  async getSupportedModels(): Promise<HarnessModelInfo[]> {
    const fallback = { value: this.config.defaultModel, label: this.config.defaultModel === 'grok-build' ? 'Grok Build' : 'Default', provider: this.config.provider, isDefault: true }
    const { child, connection, initialized } = await this.connect(process.cwd())
    try {
      if (this.id === 'cursor') {
        const result = await connection.request('cursor/list_available_models', {})
        return modelsFromAcp(result, fallback)
      }
      const setup = await connection.request('session/new', { cwd: process.cwd(), mcpServers: [] }) as Record<string, unknown>
      return modelsFromAcp(setup.models ?? initialized.models, fallback)
    } finally { child.kill() }
  }
  getSessionsRoot() { return path.join(os.homedir(), `.${this.id}`, 'sessions') }
  getCommandsDir(scope: 'project' | 'global', projectPath?: string) { return scope === 'project' ? path.join(projectPath!, '.agents', 'commands') : path.join(os.homedir(), '.agents', 'commands') }
  getSkillsDir(scope: 'project' | 'global', projectPath?: string) { return scope === 'project' ? path.join(projectPath!, '.agents', 'skills') : path.join(os.homedir(), '.agents', 'skills') }
  getPluginsDir() { return path.join(os.homedir(), `.${this.id}`, 'plugins') }
  getSettingsPath() { return path.join(os.homedir(), `.${this.id}`, 'config.json') }
  encodeCwd(cwd: string) { return cwd.replaceAll('/', '-') }
  async runCLI(args: string[], options?: HarnessCLIOptions) { return (await execFileAsync(this.bin(), args, { cwd: options?.cwd, env: { ...process.env, ...options?.env }, timeout: options?.timeout })).stdout }
  async resolveAuth(): Promise<HarnessAuth> { return { type: 'cli' } }
  async probeAuthDetail(): Promise<HarnessAuthDetail> { return { type: 'cli', status: 'unknown', detail: `Relies on ${this.name}’s own login.` } }
  async probeAvailability(): Promise<HarnessAvailability> { try { await this.runCLI(['--version']); return { available: true } } catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error) } } }
}

export const cursorHarness = new AcpHarnessAdapter({ id: 'cursor', name: 'Cursor', bin: { harnessId: 'cursor', fallbackBins: ['cursor-agent'], envVar: 'CURSOR_AGENT_BIN' }, args: ['acp'], authMethod: 'cursor_login', defaultModel: 'default', provider: 'Cursor', login: { command: 'cursor-agent', args: ['login'] } })
export const grokHarness = new AcpHarnessAdapter({ id: 'grok', name: 'Grok', bin: { harnessId: 'grok', fallbackBins: ['grok'], envVar: 'GROK_BIN' }, args: ['agent', 'stdio'], authMethod: 'cached_token', defaultModel: 'grok-build', provider: 'xAI', login: { command: 'grok', args: ['login'] } })
