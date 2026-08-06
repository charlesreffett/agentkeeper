import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Anthropic from '@anthropic-ai/sdk'
import { isGeneralProject, type SlashCommand } from '../shared/ipc-contract'
import { resolveClaudeAuth } from './secrets'
import { getHarness } from './harness/index'

function nameFromBody(body: string, id: string): string {
  const match = body.match(/^#\s+(.+)$/m)
  return match ? match[1]!.trim() : id
}

async function listScope(
  scope: 'project' | 'global',
  projectPath: string | null,
): Promise<SlashCommand[]> {
  const dir = getHarness().getCommandsDir(scope, projectPath ?? undefined)
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

/** Parse YAML frontmatter name/description from a SKILL.md file. */
function parseSkillMeta(body: string): { name: string; description: string } {
  const fm = body.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fm) return { name: '', description: '' }
  const nameMatch = fm[1]!.match(/^name:\s*(.+)$/m)
  const descMatch = fm[1]!.match(/^description:\s*[>|]?\s*\n?([\s\S]*?)(?=\n\w|\n---|\s*$)/m)
  return {
    name: nameMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
  }
}

/** Enumerate skills contributed by installed Claude Code plugins. */
async function listPluginCommands(): Promise<SlashCommand[]> {
  const installedPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json')
  let installed: { version: number; plugins: Record<string, Array<{ installPath: string }>> }
  try {
    const raw = await fs.readFile(installedPath, 'utf8')
    installed = JSON.parse(raw)
  } catch {
    return []
  }

  const results: SlashCommand[] = []
  for (const [pluginKey, installs] of Object.entries(installed.plugins ?? {})) {
    const pluginName = pluginKey.split('@')[0] ?? pluginKey
    for (const inst of installs) {
      // Walk <installPath>/plugins/*/skills/*/SKILL.md
      const pluginsRoot = path.join(inst.installPath, 'plugins')
      let pluginDirs: string[]
      try {
        pluginDirs = await fs.readdir(pluginsRoot)
      } catch {
        continue
      }
      for (const pluginDir of pluginDirs) {
        const skillsRoot = path.join(pluginsRoot, pluginDir, 'skills')
        let skillDirs: string[]
        try {
          skillDirs = await fs.readdir(skillsRoot)
        } catch {
          continue
        }
        for (const skillDir of skillDirs) {
          const skillFile = path.join(skillsRoot, skillDir, 'SKILL.md')
          try {
            const body = await fs.readFile(skillFile, 'utf8')
            const { name, description } = parseSkillMeta(body)
            results.push({
              id: skillDir,
              scope: 'plugin',
              path: skillFile,
              name: name || skillDir,
              body: description || body.replace(/^---[\s\S]*?---\s*\n?/, '').trimEnd(),
              pluginName,
            })
          } catch {
            // skip unreadable
          }
        }
      }
    }
  }
  return results
}

export async function listCommands(projectPath: string | null): Promise<SlashCommand[]> {
  const [project, global, plugin] = await Promise.all([
    // General chats have no project directory — only global commands apply.
    isGeneralProject(projectPath) ? [] : listScope('project', projectPath),
    listScope('global', projectPath),
    listPluginCommands(),
  ])
  return [...project, ...global, ...plugin]
}

/**
 * Expand a slash-command input into the command body, mirroring the renderer's
 * `resolveBody`: leading `/<id>` is matched against the project's commands and
 * replaced by its body, with `$ARGUMENTS` substituted by the text after the id.
 * Non-command text (or an unknown id) passes through unchanged.
 */
export async function expandCommandInput(projectPath: string | null, text: string): Promise<string> {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('/')) return text
  const match = trimmed.match(/^\/(\S+)\s*([\s\S]*)$/)
  if (!match) return text
  const [, id, args] = match
  const commands = await listCommands(projectPath)
  const cmd = commands.find((c) => c.id === id)
  if (!cmd) return text
  return cmd.body.replace(/\$ARGUMENTS/g, args ?? '').trim()
}

export async function saveCommand(
  scope: 'project' | 'global',
  projectPath: string,
  id: string,
  body: string,
): Promise<SlashCommand> {
  const dir = getHarness().getCommandsDir(scope, projectPath)
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

const COMMAND_GENERATION_SYSTEM = `You generate agent slash command files. Output ONLY the markdown body starting with the H1 heading. No explanation, no code fences, no prose before or after.

Format:
# Command Title

Description of what this command does and when to use it.

## Instructions

Step-by-step instructions for the agent to follow when this command is invoked.
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
  const userContent = `Create an agent slash command that does the following: ${prompt}`

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
    const stdout = await getHarness().runCLI(['-p', fullPrompt], { cwd: os.homedir(), timeout: 60_000 })
    return validateGeneratedCommand(stdout)
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : 'CLI failed — check your login.',
    )
  }
}
