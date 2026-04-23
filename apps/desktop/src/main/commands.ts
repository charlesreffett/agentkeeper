import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { SlashCommand } from '../shared/ipc-contract'

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
  return [...project, ...global]
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
