import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { isGeneralProject, type SlashCommand } from '../shared/ipc-contract'
import { getHarness, harnessRegistry } from './harness/index'

const VALID_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const canonicalDir = (scope: 'project' | 'global', project: string) => scope === 'project' ? path.join(project, '.agents', 'commands') : path.join(os.homedir(), '.agents', 'commands')
const within = (root: string, candidate: string) => { const rel = path.relative(path.resolve(root), path.resolve(candidate)); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)) }
const title = (body: string, id: string) => body.match(/^#\s+(.+)$/m)?.[1]?.trim() || id
type Root = { path: string; harnessIds: Set<string> }

function roots(scope: 'project' | 'global', project: string): Root[] {
  const result = new Map<string, Root>()
  const canonical = path.resolve(canonicalDir(scope, project))
  result.set(canonical, { path: canonical, harnessIds: new Set() })
  for (const harness of harnessRegistry.list()) {
    if (!harness.capabilities.commands) continue
    for (const location of harness.getCommandLocations(scope, project)) {
      const key = path.resolve(location.path)
      const root = result.get(key) ?? { path: key, harnessIds: new Set<string>() }
      root.harnessIds.add(harness.id); result.set(key, root)
    }
  }
  return [...result.values()]
}

const availability = new Map<string, { until: number; value: boolean }>()
async function installedHarnesses() {
  return (await Promise.all(harnessRegistry.list().map(async harness => {
    if (!harness.capabilities.commands) return null
    const cached = availability.get(harness.id)
    if (cached && cached.until > Date.now()) return cached.value ? harness : null
    let value = false; try { value = (await harness.probeAvailability()).available } catch { /* unavailable */ }
    availability.set(harness.id, { value, until: Date.now() + 30_000 }); return value ? harness : null
  }))).filter((h): h is NonNullable<typeof h> => h !== null)
}

export type CommandLinkResult = { path: string; status: 'created' | 'linked' | 'conflict' }
export async function reconcileCommandLinks(file: string, targets: string[]): Promise<CommandLinkResult[]> {
  const canonical = path.resolve(await fs.realpath(file)); const result: CommandLinkResult[] = []
  for (const root of new Set(targets.map(target => path.resolve(target)))) {
    const destination = path.join(root, path.basename(file))
    try { result.push({ path: destination, status: path.resolve(await fs.realpath(destination)) === canonical ? 'linked' : 'conflict' }); continue } catch { /* inspect lstat */ }
    try { await fs.lstat(destination); result.push({ path: destination, status: 'conflict' }); continue } catch { /* absent */ }
    await fs.mkdir(root, { recursive: true })
    const physicalRoot = await fs.realpath(root)
    const target = process.platform === 'win32' ? canonical : path.relative(physicalRoot, canonical)
    try { await fs.symlink(target, destination, 'file'); result.push({ path: destination, status: 'created' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; result.push({ path: destination, status: 'conflict' }) }
  }
  return result
}

async function reconcile(scope: 'project' | 'global', project: string) {
  const canonical = canonicalDir(scope, project); let files: string[]
  try { files = await fs.readdir(canonical) } catch { return }
  const targets = new Set<string>()
  for (const harness of await installedHarnesses()) {
    const locations = harness.getCommandLocations(scope, project)
    if (locations.some(l => l.canonical || path.resolve(l.path) === path.resolve(canonical))) continue
    locations.filter(l => l.representation === 'markdown').forEach(l => targets.add(l.path))
  }
  await Promise.all(files.filter(f => f.endsWith('.md') && VALID_ID.test(f.slice(0, -3))).map(f => reconcileCommandLinks(path.join(canonical, f), [...targets]).catch(() => [])))
}

async function listScope(scope: 'project' | 'global', project: string): Promise<SlashCommand[]> {
  await reconcile(scope, project)
  const canonical = path.resolve(canonicalDir(scope, project)); const found = new Map<string, SlashCommand>()
  for (const root of roots(scope, project)) {
    let files: string[]; try { files = await fs.readdir(root.path) } catch { continue }
    for (const file of files) {
      if (!file.endsWith('.md') || !VALID_ID.test(file.slice(0, -3))) continue
      const registered = path.join(root.path, file)
      try {
        if (!(await fs.stat(registered)).isFile()) continue
        const physical = path.resolve(await fs.realpath(registered)); const body = (await fs.readFile(physical, 'utf8')).trimEnd()
        const old = found.get(physical)
        if (old) { if (!old.locations.includes(registered)) old.locations.push(registered); old.harnessIds = [...new Set([...old.harnessIds, ...root.harnessIds])].sort(); continue }
        const id = file.slice(0, -3)
        found.set(physical, { id, scope, ...(scope === 'project' ? { projectPath: project } : {}), path: physical, locations: [registered], harnessIds: [...root.harnessIds].sort(), shared: within(canonical, physical), conflict: false, representation: 'markdown', name: title(body, id), body })
      } catch { /* broken or unreadable */ }
    }
  }
  const commands = [...found.values()]; const counts = new Map<string, number>()
  commands.forEach(c => counts.set(c.id, (counts.get(c.id) ?? 0) + 1)); commands.forEach(c => { c.conflict = (counts.get(c.id) ?? 0) > 1 })
  return commands.sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path))
}

async function plugins(): Promise<SlashCommand[]> {
  if (getHarness().id !== 'claude-code') return []
  let installed: { plugins: Record<string, Array<{ installPath: string }>> }
  try { installed = JSON.parse(await fs.readFile(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) } catch { return [] }
  const result: SlashCommand[] = []
  for (const [key, installs] of Object.entries(installed.plugins ?? {})) for (const install of installs) {
    let pluginDirs: string[]; try { pluginDirs = await fs.readdir(path.join(install.installPath, 'plugins')) } catch { continue }
    for (const plugin of pluginDirs) {
      const skillRoot = path.join(install.installPath, 'plugins', plugin, 'skills'); let ids: string[]
      try { ids = await fs.readdir(skillRoot) } catch { continue }
      for (const id of ids) try {
        const file = path.join(skillRoot, id, 'SKILL.md'); const source = await fs.readFile(file, 'utf8')
        const name = source.match(/^name:\s*(.+)$/m)?.[1]?.trim() || id; const description = source.match(/^description:\s*(.+)$/m)?.[1]?.trim()
        result.push({ id, scope: 'plugin', path: file, locations: [file], harnessIds: ['claude-code'], shared: false, conflict: false, name, body: description || source.replace(/^---[\s\S]*?---\s*\n?/, '').trimEnd(), pluginName: key.split('@')[0] })
      } catch { /* malformed */ }
    }
  }
  return result
}

export async function listCommands(project: string | null): Promise<SlashCommand[]> {
  const owner = project ?? ''; const [projectCommands, global, plugin] = await Promise.all([isGeneralProject(project) ? [] : listScope('project', owner), listScope('global', owner), plugins()])
  return [...projectCommands, ...global, ...plugin].sort((a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id) || a.path.localeCompare(b.path))
}

export function resolveCommand(commands: SlashCommand[], id: string): SlashCommand | null {
  for (const scope of ['project', 'global'] as const) {
    const scoped = commands.filter(c => c.scope === scope && c.id === id); if (!scoped.length) continue
    const shared = scoped.filter(c => c.shared); if (shared.length === 1) return shared[0]!
    if (shared.length > 1 || scoped.length > 1) throw new Error(`Command /${id} is ambiguous; choose a specific command source.`)
    return scoped[0]!
  }
  return commands.find(c => c.scope === 'plugin' && c.id === id) ?? null
}

export async function expandCommandInput(project: string | null, text: string): Promise<string> {
  const match = text.trimStart().match(/^\/(\S+)\s*([\s\S]*)$/); if (!match) return text
  const command = resolveCommand(await listCommands(project), match[1]!); return command ? command.body.replace(/\$ARGUMENTS/g, match[2] ?? '').trim() : text
}

async function atomicWrite(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = path.join(path.dirname(file), `.agentkeeper-${randomUUID()}.tmp`)
  try { await fs.writeFile(temporary, content, 'utf8'); await fs.rename(temporary, file) } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
}

export async function saveCommand(scope: 'project' | 'global', project: string, id: string, body: string, existing?: SlashCommand): Promise<SlashCommand> {
  if (!VALID_ID.test(id)) throw new Error('Command ID must use lowercase letters, numbers, and single hyphens.')
  if (existing && !existing.shared) {
    if (existing.scope === 'plugin' || existing.id !== id || existing.scope !== scope) throw new Error('Command identity cannot be changed while editing.')
    const owner = scope === 'project' ? existing.projectPath ?? project : project
    const current = (await listCommands(owner)).find(c => c.scope === scope && c.path === path.resolve(existing.path))
    if (!current) throw new Error('Command is no longer installed.')
    await atomicWrite(current.path, body.trimEnd() + '\n')
    return { ...current, name: title(body, id), body: body.trimEnd() }
  }
  const file = path.join(canonicalDir(scope, project), `${id}.md`); await atomicWrite(file, body.trimEnd() + '\n'); await reconcile(scope, project)
  return { id, scope, ...(scope === 'project' ? { projectPath: project } : {}), path: path.resolve(file), locations: [file], harnessIds: [], shared: true, conflict: false, representation: 'markdown', name: title(body, id), body: body.trimEnd() }
}

export async function removeCommand(project: string, selected: SlashCommand) {
  if (selected.scope === 'plugin') throw new Error('Plugin commands are read-only.')
  const owner = selected.scope === 'project' ? selected.projectPath ?? project : project
  const found = (await listCommands(owner)).find(c => c.scope === selected.scope && c.path === path.resolve(selected.path)); if (!found) throw new Error('Command is no longer installed.')
  const allowed = roots(found.scope as 'project' | 'global', owner).map(r => r.path); const canonical = canonicalDir(found.scope as 'project' | 'global', owner)
  for (const location of [...found.locations].sort((a, b) => Number(within(canonical, a)) - Number(within(canonical, b)))) {
    if (!allowed.some(root => within(root, location))) throw new Error('Refusing to remove a command outside registered command directories.')
    await fs.unlink(location).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
  }
}

export async function adoptCommand(project: string, selected: SlashCommand, backupBase: string) {
  if (selected.scope === 'plugin') throw new Error('Plugin commands are read-only.')
  const owner = selected.scope === 'project' ? selected.projectPath ?? project : project
  const found = (await listCommands(owner)).find(c => c.scope === selected.scope && c.path === path.resolve(selected.path)); if (!found) throw new Error('Command is no longer installed.')
  if (found.shared) return; if (found.conflict) throw new Error('Resolve the same-ID conflict before making this command shared.')
  const allowed = roots(found.scope as 'project' | 'global', owner).map(r => r.path); const source = found.locations.find(l => allowed.some(r => within(r, l))); if (!source) throw new Error('Command is outside registered command directories.')
  const destination = path.join(canonicalDir(found.scope as 'project' | 'global', owner), `${found.id}.md`)
  try { await fs.lstat(destination); throw new Error(`A shared command named '${found.id}' already exists.`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const token = `${Date.now()}-${randomUUID()}`; const backup = path.join(backupBase, 'command-backups', found.scope, token, `${found.id}.md`)
  await atomicWrite(destination, await fs.readFile(source, 'utf8')); let moved = false
  try { await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.rename(source, backup); moved = true; const linked = await reconcileCommandLinks(destination, [path.dirname(source)]); if (linked[0]?.status === 'conflict') throw new Error('Could not create compatibility link.'); await reconcile(found.scope as 'project' | 'global', owner) }
  catch (error) { if (moved) { await fs.unlink(source).catch(() => {}); await fs.rename(backup, source).catch(() => {}) }; await fs.unlink(destination).catch(() => {}); throw error }
}

const GENERATION_PROMPT = 'Generate an agent slash command as Markdown. Output only Markdown beginning with one H1. Use $ARGUMENTS for invocation arguments.'
export async function generateCommandContent(prompt: string): Promise<string> {
  const output = (await getHarness().runPrompt(`${GENERATION_PROMPT}\n\n${prompt}`, { cwd: os.homedir() })).trim()
  if (!output.startsWith('#')) throw new Error('Generation returned unexpected format — try rephrasing the prompt.'); return output
}
