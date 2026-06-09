import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { HarnessAdapter, HarnessAuth, HarnessCLIOptions, HarnessEvent, HarnessSessionOptions } from '@agentkeeper/core'
import { resolveClaudeAuth } from '../secrets'

const execFileAsync = promisify(execFile)

export class ClaudeCodeHarnessAdapter implements HarnessAdapter {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'
  readonly defaultModel = 'claude-sonnet-4-6'

  async *runSession(prompt: string, options: HarnessSessionOptions): AsyncIterable<HarnessEvent> {
    const auth = await resolveClaudeAuth()
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
      ...(options.env ?? {}),
    }
    if (auth.type === 'api-key' && auth.key) {
      childEnv['ANTHROPIC_API_KEY'] = auth.key
    }

    const sdkOptions: Parameters<typeof query>[0]['options'] = {
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
      ...(options.resume ? { resume: options.resume } : {}),
      abortController: options.abortController,
      env: childEnv,
      permissionMode: (options.permissionMode ?? 'bypassPermissions') as 'bypassPermissions',
      settingSources: (options.settingSources ?? ['user', 'project']) as ['user', 'project'],
      includePartialMessages: options.includePartialMessages ?? true,
    }

    if (options.systemPrompt || options.preset) {
      sdkOptions!.systemPrompt = {
        type: 'preset',
        preset: (options.preset ?? 'claude_code') as 'claude_code',
        ...(options.systemPrompt ? { append: options.systemPrompt } : {}),
      }
    }

    if (options.allowedTools?.length) {
      sdkOptions!.allowedTools = options.allowedTools
    }

    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkOptions!.mcpServers = options.mcpServers as any
    }

    const promptInput: string | AsyncIterable<unknown> = options.messageQueue ?? prompt

    const q = query({ prompt: promptInput as string, options: sdkOptions })

    if (options.abortController) {
      options.abortController.signal.addEventListener('abort', () => {
        try { q.interrupt?.() } catch { /* ignore */ }
        try { (q as { close?: () => void }).close?.() } catch { /* ignore */ }
      }, { once: true })
    }

    for await (const msg of q) {
      yield msg as unknown as HarnessEvent
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

  getSkillsDir(scope: 'project' | 'global', projectPath?: string): string {
    if (scope === 'project') {
      return path.join(projectPath!, '.claude', 'skills')
    }
    return path.join(os.homedir(), '.claude', 'skills')
  }

  getPluginsDir(): string {
    return path.join(os.homedir(), '.claude', 'plugins')
  }

  getSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json')
  }

  async runCLI(args: string[], options?: HarnessCLIOptions): Promise<string> {
    const { stdout } = await execFileAsync('claude', args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      timeout: options?.timeout,
    })
    return stdout
  }

  async resolveAuth(): Promise<HarnessAuth> {
    const result = await resolveClaudeAuth()
    if (result.type === 'api-key') {
      return { type: 'api-key', key: result.key }
    }
    return { type: 'cli' }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('claude', ['--version'])
      return true
    } catch {
      return false
    }
  }

  encodeCwd(cwd: string): string {
    return cwd.replaceAll('\\', '-').replaceAll('/', '-').replaceAll(':', '-')
  }
}
