import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HarnessAdapter, HarnessAuth, HarnessAuthDetail, HarnessAvailability, HarnessCapabilities, HarnessCLIOptions, HarnessEvent, HarnessModelInfo, HarnessSessionOptions } from '@agentkeeper/core'
import { sanitizeCustomModel } from '@agentkeeper/core'
import { resolveBin, type BinConfig } from './bin'
import { jsonLines, spawnHarnessProcess, waitForExit } from './cli-process'
import { resolveHarnessEnvironment, resolveHarnessPath } from './configuration'

const execFileAsync = promisify(execFile)
const CODEX_BIN: BinConfig = { harnessId: 'codex', fallbackBins: ['codex'], envVar: 'CODEX_BIN' }

export class CodexHarnessAdapter implements HarnessAdapter {
  readonly id = 'codex'
  readonly name = 'Codex'
  readonly capabilities: HarnessCapabilities = {
    mcpServers: false, disallowedTools: false, systemPromptAppend: true,
    permissionModes: true, effort: true, commands: false, skills: true,
    agencies: false, modelSelection: 'turn', customModels: true,
  }
  readonly configuration = {
    fields: [
      { id: 'home', label: 'Codex home', type: 'path' as const, env: 'CODEX_HOME', placeholder: '~/.codex', description: 'Use a separate Codex profile.' },
      { id: 'apiKey', label: 'OpenAI API key', type: 'secret' as const, secret: true as const, env: 'OPENAI_API_KEY', placeholder: 'sk-…', description: 'Optional API key stored in the OS keychain.' },
    ],
  }
  readonly authentication = { login: { command: 'codex', args: ['login'], label: 'Authenticate' } }

  private bin(): string {
    const bin = resolveBin(CODEX_BIN)
    if (!bin) throw new Error('Codex binary not found — install `codex`, set CODEX_BIN, or configure a bin path in settings.')
    return bin
  }

  private args(prompt: string, options: HarnessSessionOptions): string[] {
    const args = ['exec']
    if (options.resume) args.push('resume', options.resume)
    args.push('--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox')
    const model = options.model && sanitizeCustomModel(options.model)
    if (model && model !== 'default') args.push('--model', model)
    if (options.effort) args.push('--config', `model_reasoning_effort=${JSON.stringify(options.effort)}`)
    const composed = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt
    args.push(composed)
    return args
  }

  async *runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent> {
    const env = await resolveHarnessEnvironment(this, options.env)
    const turnPrompt = await promptForTurn(prompt, options.messageQueue)
    const child = spawnHarnessProcess(this.bin(), this.args(turnPrompt, options), { cwd: options.cwd, env, signal: options.abortController?.signal })
    // A prompt is always supplied as an argument. Closing stdin prevents the
    // CLI from silently waiting for input if the prompt is empty or rejected.
    child.stdin.end()
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    // Attach exit listeners before reading stdout: short-lived failures can
    // otherwise exit before waitForExit subscribes and leave the UI hanging.
    const exit = waitForExit(child).then(
      () => ({ error: null as Error | null }),
      (error: unknown) => ({ error: error instanceof Error ? error : new Error(String(error)) }),
    )
    let sessionId: string | undefined
    let finalText = ''
    for await (const raw of jsonLines(child.stdout)) {
      const event = raw as { type?: string; thread_id?: string; item?: { type?: string; text?: string } }
      if (event.type === 'thread.started') {
        sessionId = event.thread_id
        yield { type: 'system', subtype: 'init', session_id: sessionId }
      } else if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        finalText = event.item.text ?? ''
        yield { type: 'assistant', session_id: sessionId, message: { role: 'assistant', content: [{ type: 'text', text: finalText }], model: options.model } }
      } else {
        yield { type: 'stream_event', provider: 'codex', event: raw }
      }
    }
    const outcome = await exit
    if (outcome.error) {
      const detail = stderr.trim()
      throw new Error(detail ? `${outcome.error.message}: ${detail}` : outcome.error.message)
    }
    yield { type: 'result', subtype: 'success', session_id: sessionId, result: finalText }
  }

  async runPrompt(prompt: string, options: HarnessSessionOptions): Promise<string> {
    let text = ''
    for await (const event of this.runSession(prompt, options)) {
      if (event.type === 'result' && typeof event.result === 'string') text = event.result
    }
    return text
  }

  async getSupportedModels(): Promise<HarnessModelInfo[]> {
    return [
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'OpenAI', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], isDefault: true },
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'OpenAI', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'OpenAI', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'gpt-5.5', label: 'GPT-5.5', provider: 'OpenAI', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh'] },
      { value: 'gpt-5.4', label: 'GPT-5.4', provider: 'OpenAI', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh'] },
    ]
  }

  getSessionsRoot() { return path.join(os.homedir(), '.codex', 'sessions') }
  getCommandsDir(scope: 'project' | 'global', projectPath?: string) { return scope === 'project' ? path.join(projectPath!, '.codex', 'prompts') : path.join(os.homedir(), '.codex', 'prompts') }
  getSkillLocations(scope: 'project' | 'global', projectPath?: string) {
    const canonical = scope === 'project'
      ? path.join(projectPath!, '.agents', 'skills')
      : path.join(os.homedir(), '.agents', 'skills')
    if (scope === 'project') {
      return [{ path: canonical, kind: 'native' as const, canonical: true }]
    }
    const codexRoot = resolveHarnessPath(this, 'home', path.join(os.homedir(), '.codex'))
    return [
      { path: canonical, kind: 'native' as const, canonical: true },
      { path: path.join(codexRoot, 'skills'), kind: 'compatible' as const },
    ]
  }
  getPluginsDir() { return path.join(os.homedir(), '.codex', 'plugins') }
  getSettingsPath() { return path.join(os.homedir(), '.codex', 'config.toml') }
  encodeCwd(cwd: string) { return cwd.replaceAll('/', '-') }
  async runCLI(args: string[], options?: HarnessCLIOptions) { const env = await resolveHarnessEnvironment(this, options?.env); return (await execFileAsync(this.bin(), args, { cwd: options?.cwd, env: { ...process.env, ...env }, timeout: options?.timeout })).stdout }
  async resolveAuth(): Promise<HarnessAuth> { return { type: 'cli' } }
  async probeAuthDetail(): Promise<HarnessAuthDetail> {
    try { await this.runCLI(['login', 'status'], { timeout: 5_000 }); return { type: 'cli', status: 'authenticated', detail: 'Codex login is configured.' } }
    catch { return { type: 'cli', status: 'unauthenticated', detail: 'Not authenticated — run `codex login`.' } }
  }
  async probeAvailability(): Promise<HarnessAvailability> {
    try { await this.runCLI(['--version']); return { available: true } }
    catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error) } }
  }
}

/** AgentKeeper feeds live-session turns through messageQueue. Codex exec is
 * one-shot, so consume exactly one queued user message for this process; a
 * later turn is resumed in a fresh process by the session layer. */
export async function promptForTurn(
  fallback: string,
  messageQueue?: HarnessSessionOptions['messageQueue'],
): Promise<string> {
  if (!messageQueue) return fallback
  for await (const message of messageQueue) {
    return extractText(message.message?.content)
  }
  return fallback
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const value = block as Record<string, unknown>
      return value['type'] === 'text' && typeof value['text'] === 'string'
        ? [value['text']]
        : []
    })
    .join('\n')
}
