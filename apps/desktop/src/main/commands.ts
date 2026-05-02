import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import type { SlashCommand } from '../shared/ipc-contract'
import { resolveClaudeAuth } from './secrets'

const AGENT_COMMANDS: SlashCommand[] = [
  { id: 'bug',           scope: 'agent', path: '', name: 'Open a bug report',                    body: '/bug' },
  { id: 'clear',         scope: 'agent', path: '', name: 'Clear conversation history',            body: '/clear' },
  { id: 'compact',       scope: 'agent', path: '', name: 'Compact conversation',                  body: '/compact $ARGUMENTS' },
  { id: 'config',        scope: 'agent', path: '', name: 'Open Claude Code settings',             body: '/config' },
  { id: 'cost',          scope: 'agent', path: '', name: 'Show token usage and cost',             body: '/cost' },
  { id: 'doctor',        scope: 'agent', path: '', name: 'Check configuration health',            body: '/doctor' },
  { id: 'help',          scope: 'agent', path: '', name: 'Show help',                             body: '/help' },
  { id: 'logout',        scope: 'agent', path: '', name: 'Log out of Claude',                     body: '/logout' },
  { id: 'memory',        scope: 'agent', path: '', name: 'View and manage memory',                body: '/memory' },
  { id: 'mcp',           scope: 'agent', path: '', name: 'List MCP servers and tools',            body: '/mcp' },
  { id: 'model',         scope: 'agent', path: '', name: 'Switch the active model',               body: '/model $ARGUMENTS' },
  { id: 'pr_comments',   scope: 'agent', path: '', name: 'Show PR comments for the current branch', body: '/pr_comments' },
  { id: 'release-notes', scope: 'agent', path: '', name: 'Show release notes',                    body: '/release-notes' },
  { id: 'status',        scope: 'agent', path: '', name: 'Show agent status',                     body: '/status' },
  { id: 'terminal-setup',scope: 'agent', path: '', name: 'Set up terminal integration',           body: '/terminal-setup' },
  { id: 'vim',           scope: 'agent', path: '', name: 'Toggle vim keybindings',                body: '/vim' },
]

const PROJECT_COMMANDS_DIR = '.claude/commands'
const GLOBAL_COMMANDS_DIR = '.claude/commands'

function projectCommandsDir(projectPath: string): string {
  return path.join(projectPath, PROJECT_COMMANDS_DIR)
}

function globalCommandsDir(): string {
  return path.join(os.homedir(), GLOBAL_COMMANDS_DIR)
}

function commandsDir(scope: 'project' | 'global', projectPath: string): string {
  return scope === 'project' ? projectCommandsDir(projectPath) : globalCommandsDir()
}

function nameFromBody(body: string, id: string): string {
  const match = body.match(/^#\s+(.+)$/m)
  return match ? match[1]!.trim() : id
}

async function listScope(
  scope: 'project' | 'global',
  projectPath: string,
): Promise<SlashCommand[]> {
  const dir = commandsDir(scope, projectPath)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const mdFiles = entries.filter((e) => e.endsWith('.md'))
  const results: SlashCommand[] = []
  for (const filename of mdFiles) {
    const full = path.join(dir, filename)
    const id = filename.replace(/\.md$/, '')
    try {
      const body = await fs.readFile(full, 'utf8')
      results.push({
        id,
        scope,
        path: full,
        name: nameFromBody(body, id),
        body: body.trimEnd(),
      })
    } catch {
      // skip unreadable files
    }
  }
  return results
}

export async function listCommands(projectPath: string): Promise<SlashCommand[]> {
  const [project, global] = await Promise.all([
    listScope('project', projectPath),
    listScope('global', projectPath),
  ])
  return [...project, ...global, ...AGENT_COMMANDS]
}

export async function saveCommand(
  scope: 'project' | 'global',
  projectPath: string,
  id: string,
  body: string,
): Promise<SlashCommand> {
  const dir = commandsDir(scope, projectPath)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${id}.md`)
  const content = body.trimEnd() + '\n'
  await fs.writeFile(filePath, content, 'utf8')
  return {
    id,
    scope,
    path: filePath,
    name: nameFromBody(content, id),
    body: content.trimEnd(),
  }
}

export async function removeCommand(cmd: SlashCommand): Promise<void> {
  try {
    await fs.unlink(cmd.path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

const execFileAsync = promisify(execFile)

const COMMAND_GENERATION_SYSTEM = `You generate Claude Code slash command files. Output ONLY the markdown body starting with the H1 heading. No explanation, no code fences, no prose before or after.

Format:
# Command Title

Description of what this command does and when to use it.

## Instructions

Step-by-step instructions for Claude to follow when this command is invoked.
Use $ARGUMENTS anywhere the user's input after the slash command should be substituted.

Rules:
- Start with exactly one H1 heading (becomes the display name)
- Use $ARGUMENTS where the user's typed input belongs
- Be specific and actionable
- Output plain markdown only`

function validateGeneratedCommand(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('#')) {
    throw new Error('Generation returned unexpected format — try rephrasing the prompt.')
  }
  return trimmed
}

export async function generateCommandContent(prompt: string): Promise<string> {
  const auth = await resolveClaudeAuth()
  const userContent = `Create a Claude Code slash command that does the following: ${prompt}`

  if (auth.type === 'api-key') {
    const client = new Anthropic({ apiKey: auth.key })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: COMMAND_GENERATION_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    })
    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    return validateGeneratedCommand(text)
  }

  // Pro/Max plan path — picks up `claude login` credentials
  const fullPrompt = `${COMMAND_GENERATION_SYSTEM}\n\n${userContent}`
  try {
    const result = await execFileAsync('claude', ['-p', fullPrompt], {
      cwd: os.homedir(),
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    return validateGeneratedCommand(result.stdout)
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : 'claude CLI failed — check your login.',
    )
  }
}
