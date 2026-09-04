import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { app } from 'electron'
import keytar from 'keytar'
import { PluginManifestSchema, UpdateManifestSchema } from '@agentkeeper/sdk'
import type { PluginManifest, PluginPermission, UpdateRelease } from '@agentkeeper/sdk'
import { spawnPlugin, activatePlugin, spawnAndActivate, getActiveHost, removeActiveHost } from './plugin-loader.js'
import { getRawSqlite } from './db/index.js'
import { getPluginEventBus } from './plugins.js'
import { requirePluginFile, resolvePluginPath, validatePluginArchiveEntries } from './plugin-paths.js'
import { assertReleaseIdentity, comparePluginVersions, type PluginReleaseIdentity } from './plugin-update-policy.js'
import { extractPluginArchive, readPluginArchiveFile } from './plugin-archive.js'

// ---- helpers ----

export const MAX_AKP_BYTES = 200 * 1024 * 1024
export const MAX_AKP_ENTRIES = 10_000
export const MAX_AKP_COMPRESSION_RATIO = 100
const INSTALL_TOKEN_TTL_MS = 15 * 60 * 1000

export interface PluginAuthority {
  permissions: PluginPermission[]
  networkHosts: string[]
  environmentVariables: string[]
}

interface StagedArchive {
  dir: string
  path: string
  sha256: string
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort()
}

export function pluginAuthority(manifest: PluginManifest): PluginAuthority {
  return {
    permissions: sortedUnique(manifest.permissions),
    networkHosts: sortedUnique(manifest.network?.hosts ?? []),
    environmentVariables: sortedUnique(manifest.environment?.variables ?? []),
  }
}

export function authorityExpansion(granted: PluginAuthority, requested: PluginAuthority): PluginAuthority {
  return {
    permissions: requested.permissions.filter(value => !granted.permissions.includes(value)),
    networkHosts: requested.networkHosts.filter(value => !granted.networkHosts.includes(value)),
    environmentVariables: requested.environmentVariables.filter(value => !granted.environmentVariables.includes(value)),
  }
}

function hasAuthorityExpansion(expansion: PluginAuthority): boolean {
  return expansion.permissions.length > 0
    || expansion.networkHosts.length > 0
    || expansion.environmentVariables.length > 0
}

function parseAuthority(value: string): PluginAuthority {
  try {
    const parsed = JSON.parse(value) as Partial<PluginAuthority>
    return {
      permissions: sortedUnique(Array.isArray(parsed.permissions)
        ? parsed.permissions.filter((item): item is PluginPermission => typeof item === 'string')
        : []),
      networkHosts: sortedUnique(Array.isArray(parsed.networkHosts)
        ? parsed.networkHosts.filter((item): item is string => typeof item === 'string')
        : []),
      environmentVariables: sortedUnique(Array.isArray(parsed.environmentVariables)
        ? parsed.environmentVariables.filter((item): item is string => typeof item === 'string')
        : []),
    }
  } catch {
    return { permissions: [], networkHosts: [], environmentVariables: [] }
  }
}

function assertHttpsUrl(value: string, label: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${label} must be a valid URL`) }
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`)
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`)
  return url
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await extractPluginArchive(zipPath, destDir)
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const s = fs.createReadStream(filePath)
    s.on('error', reject)
    s.on('data', (chunk) => hash.update(chunk))
    s.on('end', () => resolve(hash.digest('hex')))
  })
}

async function createStagingArea(): Promise<{ dir: string; archivePath: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentkeeper-plugin-'))
  await fsp.chmod(dir, 0o700)
  return { dir, archivePath: path.join(dir, 'package.akp') }
}

async function stageLocalArchive(sourcePath: string): Promise<StagedArchive> {
  const { dir, archivePath } = await createStagingArea()
  const hash = crypto.createHash('sha256')
  let source: fsp.FileHandle | undefined
  let destination: fsp.FileHandle | undefined
  try {
    source = await fsp.open(sourcePath, 'r')
    const stat = await source.stat()
    if (!stat.isFile()) throw new Error('Plugin package must be a regular file')
    if (stat.size > MAX_AKP_BYTES) throw new Error('Plugin package exceeds the 200 MiB limit')
    destination = await fsp.open(archivePath, 'wx', 0o600)
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      position += bytesRead
      if (position > MAX_AKP_BYTES) throw new Error('Plugin package exceeds the 200 MiB limit')
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      await destination.write(chunk)
    }
    await destination.sync()
    return { dir, path: archivePath, sha256: hash.digest('hex') }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    await source?.close().catch(() => {})
    await destination?.close().catch(() => {})
  }
}

async function downloadToTmp(urlValue: string): Promise<StagedArchive> {
  const url = assertHttpsUrl(urlValue, 'Plugin package URL')
  const { dir, archivePath } = await createStagingArea()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  let destination: fsp.FileHandle | undefined
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' })
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
    const declaredLength = Number(res.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AKP_BYTES) {
      throw new Error('Plugin package exceeds the 200 MiB limit')
    }
    if (!res.body) throw new Error('Plugin package download returned no body')

    destination = await fsp.open(archivePath, 'wx', 0o600)
    const hash = crypto.createHash('sha256')
    const reader = res.body.getReader()
    let received = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_AKP_BYTES) {
        controller.abort()
        throw new Error('Plugin package exceeds the 200 MiB limit')
      }
      const chunk = Buffer.from(value)
      hash.update(chunk)
      await destination.write(chunk)
    }
    await destination.sync()
    return { dir, path: archivePath, sha256: hash.digest('hex') }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    clearTimeout(timeout)
    await destination?.close().catch(() => {})
  }
}

async function readArchiveManifest(archivePath: string): Promise<{ raw: unknown; manifest: PluginManifest }> {
  const manifestData = await readPluginArchiveFile(archivePath, 'manifest.json', 1024 * 1024)
  const raw = JSON.parse(manifestData.toString('utf8')) as unknown
  const result = PluginManifestSchema.safeParse(raw)
  if (!result.success) throw new Error(`Invalid manifest: ${JSON.stringify(result.error.flatten())}`)
  return { raw, manifest: result.data }
}

async function stopPlugin(pluginId: string): Promise<void> {
  const host = getActiveHost(pluginId)
  try {
    if (host) await host.deactivate()
  } catch (error) {
    console.warn(`[plugin-manager] ${pluginId}: lifecycle shutdown failed; forcing removal`, error)
  } finally {
    removeActiveHost(pluginId)
  }
}

// ---- semver helpers ----

function semverGt(a: string, b: string): boolean {
  return comparePluginVersions(a.replace(/^v/, ''), b.replace(/^v/, '')) > 0
}

function satisfiesMin(appVer: string, minVer: string): boolean {
  return !semverGt(minVer, appVer)
}

// ---- main API ----

async function installStagedPlugin(staged: StagedArchive, expectedRelease?: PluginReleaseIdentity): Promise<void> {
  const db = getRawSqlite()
  const extractedDir = path.join(staged.dir, 'extracted')
  await fsp.mkdir(extractedDir, { mode: 0o700 })
  let destDir: string | undefined
  let registryInserted = false
  let installedId: string | undefined
  try {
    await extractZip(staged.path, extractedDir)
    const manifestRaw = JSON.parse(await fsp.readFile(path.join(extractedDir, 'manifest.json'), 'utf8')) as unknown
    const result = PluginManifestSchema.safeParse(manifestRaw)
    if (!result.success) throw new Error(`Invalid manifest: ${JSON.stringify(result.error.flatten())}`)
    const manifest = result.data
    installedId = manifest.id
    if (expectedRelease) assertReleaseIdentity(expectedRelease, manifest)
    requirePluginFile(extractedDir, manifest.entry, 'Plugin entry')
    if (manifest.renderer) requirePluginFile(extractedDir, manifest.renderer.entry, 'Renderer entry')

    const existing = db.prepare('SELECT id FROM plugin_registry WHERE id = ?').get(manifest.id)
    if (existing) throw new Error(`Plugin ${manifest.id} is already installed. Use updatePlugin() instead.`)

    const userDataPath = app.getPath('userData')
    destDir = path.join(userDataPath, 'plugins', 'installed', `${manifest.id}@${manifest.version}`)
    await fsp.mkdir(path.dirname(destDir), { recursive: true })
    await fsp.rename(extractedDir, destDir)

    const manifestJson = JSON.stringify(manifestRaw)
    db.prepare(`
      INSERT INTO plugin_registry (
        id, name, version, enabled, manifest, source, installed_at, granted_authority, action_required
      ) VALUES (?, ?, ?, 1, ?, 'local', ?, ?, 0)
    `).run(
      manifest.id,
      manifest.name,
      manifest.version,
      manifestJson,
      Date.now(),
      JSON.stringify(pluginAuthority(manifest)),
    )
    registryInserted = true

    try {
      await spawnPlugin(manifest)
      await getActiveHost(manifest.id)?.install()
      await activatePlugin(manifest.id)
    } catch (error) {
      await stopPlugin(manifest.id)
      throw error
    }
    getPluginEventBus()?.emit('plugin.installed', { pluginId: manifest.id, version: manifest.version })
  } catch (err) {
    if (registryInserted) {
      // A failed lifecycle hook must not leave an installed-but-partial record.
      if (installedId) db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(installedId)
    }
    if (destDir) await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

export interface UpdateAvailable {
  pluginId: string
  currentVersion: string
  availableVersion: string
  releaseNotes?: string
  release: UpdateRelease
}

export async function getPluginRendererBundle(
  pluginId: string,
  viewId: string,
): Promise<{ script: string }> {
  const db = getRawSqlite()
  const row = db.prepare(
    'SELECT version, enabled, manifest, dev_path FROM plugin_registry WHERE id = ?',
  ).get(pluginId) as {
    version: string
    enabled: number
    manifest: string
    dev_path: string | null
  } | undefined
  if (!row || row.enabled !== 1) throw new Error('Provider not available')

  const manifest = PluginManifestSchema.parse(JSON.parse(row.manifest) as unknown)
  if (!manifest.permissions.includes('ui') || !manifest.renderer?.views.includes(viewId)) {
    throw new Error('Provider view not available')
  }

  const root = row.dev_path
    ? path.resolve(row.dev_path)
    : path.join(app.getPath('userData'), 'plugins', 'installed', `${pluginId}@${row.version}`)
  const entry = path.resolve(root, manifest.renderer.entry)
  if (entry !== root && !entry.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid provider renderer path')
  }
  const stat = await fsp.stat(entry)
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
    throw new Error('Invalid provider renderer bundle')
  }
  return { script: await fsp.readFile(entry, 'utf8') }
}

export async function checkForUpdates(): Promise<UpdateAvailable[]> {
  const db = getRawSqlite()
  const rows = db.prepare('SELECT id, version, manifest FROM plugin_registry WHERE enabled = 1').all() as { id: string; version: string; manifest: string }[]
  const appVer = app.getVersion()
  const updates: UpdateAvailable[] = []

  await Promise.allSettled(rows.map(async (row) => {
    let manifest: PluginManifest
    try { manifest = PluginManifestSchema.parse(JSON.parse(row.manifest)) } catch { return }
    if (!manifest.update_url) return
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      let res: Response
      try {
        assertHttpsUrl(manifest.update_url, 'Plugin update URL')
        res = await fetch(manifest.update_url, { signal: controller.signal, redirect: 'error' })
      } finally {
        clearTimeout(timeout)
      }
      if (!res.ok) return
      const data = UpdateManifestSchema.safeParse(await res.json())
      if (!data.success || data.data.id !== row.id) return
      const candidates = data.data.releases
        .filter(r => semverGt(r.version, row.version) && (!r.min_app_version || satisfiesMin(appVer, r.min_app_version)))
        .sort((a, b) => semverGt(a.version, b.version) ? -1 : 1)
      const best = candidates[0]
      if (best) {
        updates.push({ pluginId: row.id, currentVersion: row.version, availableVersion: best.version, releaseNotes: best.release_notes, release: best })
      }
    } catch { /* silent — never block */ }
  }))

  return updates
}

export interface PluginUpdateResult {
  actionRequired: boolean
  addedAuthority: PluginAuthority
}

interface PluginRegistrySnapshot {
  name: string
  version: string
  enabled: number
  manifest: string
  source: string
  dev_path: string | null
  granted_authority: string
  action_required: number
}

export async function updatePlugin(pluginId: string, release: UpdateRelease): Promise<PluginUpdateResult> {
  const db = getRawSqlite()
  const row = db.prepare(`
    SELECT name, version, enabled, manifest, source, dev_path, granted_authority, action_required
    FROM plugin_registry WHERE id = ?
  `).get(pluginId) as PluginRegistrySnapshot | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  const previousVersion = row.version

  const staged = await downloadToTmp(release.url)
  try {
    if (staged.sha256 !== release.sha256.toLowerCase()) {
      throw new Error(`SHA-256 mismatch for ${pluginId}: expected ${release.sha256}, got ${staged.sha256}`)
    }

    const extractedDir = path.join(staged.dir, 'extracted')
    await fsp.mkdir(extractedDir, { mode: 0o700 })
    let newDir: string | undefined
    let registryUpdated = false
    let oldStopped = false
    try {
      await extractZip(staged.path, extractedDir)
      const manifestRaw = JSON.parse(await fsp.readFile(path.join(extractedDir, 'manifest.json'), 'utf8')) as unknown
      const result = PluginManifestSchema.safeParse(manifestRaw)
      if (!result.success) throw new Error('Invalid manifest in update package')
      const manifest = result.data
      assertReleaseIdentity({ id: pluginId, version: release.version }, manifest, previousVersion)
      requirePluginFile(extractedDir, manifest.entry, 'Plugin entry')
      if (manifest.renderer) requirePluginFile(extractedDir, manifest.renderer.entry, 'Renderer entry')

      const granted = parseAuthority(row.granted_authority)
      const addedAuthority = authorityExpansion(granted, pluginAuthority(manifest))
      const actionRequired = hasAuthorityExpansion(addedAuthority)

      const userDataPath = app.getPath('userData')
      const oldDir = path.join(userDataPath, 'plugins', 'installed', `${pluginId}@${previousVersion}`)
      newDir = path.join(userDataPath, 'plugins', 'installed', `${pluginId}@${manifest.version}`)
      await fsp.mkdir(path.dirname(newDir), { recursive: true })
      await fsp.rename(extractedDir, newDir)

      await stopPlugin(pluginId)
      oldStopped = true

      db.prepare(`
        UPDATE plugin_registry
        SET name = ?, version = ?, enabled = ?, manifest = ?, action_required = ?
        WHERE id = ?
      `).run(
        manifest.name,
        manifest.version,
        actionRequired ? 0 : row.enabled,
        JSON.stringify(manifestRaw),
        actionRequired ? 1 : 0,
        pluginId,
      )
      registryUpdated = true

      if (row.enabled === 1 && !actionRequired) {
        await spawnAndActivate(manifest)
        await getActiveHost(pluginId)?.update(previousVersion)
      }

      await fsp.rm(oldDir, { recursive: true, force: true }).catch((error) => {
        console.warn(`[plugin-manager] ${pluginId}: could not remove superseded version`, error)
      })
      getPluginEventBus()?.emit('plugin.updated', { pluginId, previousVersion, version: manifest.version })

      return { actionRequired, addedAuthority }
    } catch (error) {
      if (registryUpdated) {
        await stopPlugin(pluginId)
        db.prepare(`
          UPDATE plugin_registry
          SET name = ?, version = ?, enabled = ?, manifest = ?, source = ?, dev_path = ?,
              granted_authority = ?, action_required = ?
          WHERE id = ?
        `).run(
          row.name,
          row.version,
          row.enabled,
          row.manifest,
          row.source,
          row.dev_path,
          row.granted_authority,
          row.action_required,
          pluginId,
        )
      }
      if (newDir) await fsp.rm(newDir, { recursive: true, force: true }).catch(() => {})

      if (oldStopped && row.enabled === 1) {
        try {
          const oldManifest = PluginManifestSchema.parse(JSON.parse(row.manifest) as unknown)
          await spawnAndActivate(oldManifest)
        } catch (rollbackError) {
          db.prepare('UPDATE plugin_registry SET enabled = 0 WHERE id = ?').run(pluginId)
          console.error(`[plugin-manager] ${pluginId}: update rollback could not reactivate the previous version`, rollbackError)
        }
      }
      throw error
    }
  } finally {
    await fsp.rm(staged.dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---- two-phase install (prepare → confirm/cancel) ----

interface PendingAkpInstall {
  kind: 'akp'
  staged: StagedArchive
  sha256: string
  createdAt: number
  expectedRelease?: PluginReleaseIdentity
}

interface PendingDevInstall {
  kind: 'dev'
  devPath: string
  manifestHash: string
  createdAt: number
}

type PendingInstall = PendingAkpInstall | PendingDevInstall

const pendingInstalls = new Map<string, PendingInstall>()

export async function prepareAkpInstall(opts: { filePath?: string; manifestUrl?: string }): Promise<{ manifest: PluginManifest; token: string }> {
  if (Boolean(opts.filePath) === Boolean(opts.manifestUrl)) {
    throw new Error('Provide exactly one plugin file or update manifest URL')
  }

  let staged: StagedArchive
  let expectedRelease: PluginReleaseIdentity | undefined

  if (opts.filePath) {
    staged = await stageLocalArchive(opts.filePath)
  } else if (opts.manifestUrl) {
    const manifestUrl = assertHttpsUrl(opts.manifestUrl, 'Plugin update manifest URL')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let res: Response
    try {
      res = await fetch(manifestUrl, { signal: controller.signal, redirect: 'error' })
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) throw new Error(`Failed to fetch plugin manifest: ${res.status}`)
    const data = UpdateManifestSchema.safeParse(await res.json())
    if (!data.success) throw new Error('URL did not return a valid plugin update manifest')
    const appVer = app.getVersion()
    const release = data.data.releases
      .filter(r => !r.min_app_version || satisfiesMin(appVer, r.min_app_version))
      .sort((a, b) => (semverGt(a.version, b.version) ? -1 : 1))[0]
    if (!release) throw new Error('No compatible release found in update manifest')
    expectedRelease = { id: data.data.id, version: release.version }
    staged = await downloadToTmp(release.url)
    if (staged.sha256 !== release.sha256.toLowerCase()) {
      await fsp.rm(staged.dir, { recursive: true, force: true }).catch(() => {})
      throw new Error(`SHA-256 mismatch: expected ${release.sha256}, got ${staged.sha256}`)
    }
  } else {
    throw new Error('Must provide filePath or manifestUrl')
  }

  let manifest: PluginManifest
  try {
    manifest = (await readArchiveManifest(staged.path)).manifest
    if (expectedRelease) assertReleaseIdentity(expectedRelease, manifest)
  } catch (err) {
    await fsp.rm(staged.dir, { recursive: true, force: true }).catch(() => {})
    throw err
  }

  const token = crypto.randomUUID()
  pendingInstalls.set(token, { kind: 'akp', staged, sha256: staged.sha256, createdAt: Date.now(), expectedRelease })
  return { manifest, token }
}

export async function prepareDevPluginInstall(devPath: string): Promise<{ manifest: PluginManifest; token: string }> {
  const resolvedPath = path.resolve(devPath)
  const manifestPath = path.join(resolvedPath, 'manifest.json')
  const manifestRaw = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as unknown
  const result = PluginManifestSchema.safeParse(manifestRaw)
  if (!result.success) throw new Error(`Invalid manifest: ${JSON.stringify(result.error.flatten())}`)
  requirePluginFile(resolvedPath, result.data.entry, 'Plugin entry')
  if (result.data.renderer) requirePluginFile(resolvedPath, result.data.renderer.entry, 'Renderer entry')

  const token = crypto.randomUUID()
  pendingInstalls.set(token, {
    kind: 'dev',
    devPath: resolvedPath,
    manifestHash: await sha256File(manifestPath),
    createdAt: Date.now(),
  })
  return { manifest: result.data, token }
}

export async function confirmAkpInstall(token: string): Promise<void> {
  const pending = pendingInstalls.get(token)
  if (!pending) throw new Error('No pending install found — it may have expired')
  pendingInstalls.delete(token)
  try {
    if (Date.now() - pending.createdAt > INSTALL_TOKEN_TTL_MS) {
      throw new Error('Pending install expired; review the package again')
    }
    if (pending.kind === 'dev') {
      const manifestPath = path.join(pending.devPath, 'manifest.json')
      if (await sha256File(manifestPath) !== pending.manifestHash) {
        throw new Error('The development plugin manifest changed after review')
      }
      const raw = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as unknown
      const manifest = PluginManifestSchema.parse(raw)
      await loadDevPlugin(pending.devPath, pluginAuthority(manifest))
      return
    }

    const actualHash = await sha256File(pending.staged.path)
    if (actualHash !== pending.sha256) throw new Error('The staged plugin package changed after review')
    await installStagedPlugin(pending.staged, pending.expectedRelease)
  } finally {
    if (pending.kind === 'akp') {
      await fsp.rm(pending.staged.dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function cancelAkpInstall(token: string): void {
  const pending = pendingInstalls.get(token)
  if (!pending) return
  pendingInstalls.delete(token)
  if (pending.kind === 'akp') {
    void fsp.rm(pending.staged.dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  const row = db.prepare('SELECT version, source FROM plugin_registry WHERE id = ?').get(pluginId) as { version: string; source: string } | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  if (row.source === 'bundled') throw new Error(`Cannot uninstall bundled plugin ${pluginId}`)

  // Dev plugins have a file watcher; close it before touching the host so a
  // mid-uninstall file event can't re-spawn the plugin.
  if (row.source === 'dev') {
    devWatchers.get(pluginId)?.close()
    devWatchers.delete(pluginId)
  }

  const host = getActiveHost(pluginId)
  if (host) {
    try {
      await host.uninstall()
    } catch (error) {
      // Lifecycle callbacks are advisory. A plugin must not be able to veto or
      // indefinitely block a host-owned control action.
      console.warn(`[plugin-manager] ${pluginId}: uninstall hook failed`, error)
    }
  }
  await stopPlugin(pluginId)

  // PluginHost stores plugin credentials under a per-plugin keytar service.
  // Clear every account before releasing the ID for reuse.
  const keychainService = `agentkeeper:${pluginId}`
  const credentials = await keytar.findCredentials(keychainService)
  await Promise.all(credentials.map(({ account }) => keytar.deletePassword(keychainService, account)))

  // Remove credentials written through the older secrets adapter as well.
  const legacyService = 'orchestral-ai'
  const legacyPrefix = `plugin:${pluginId}:`
  const legacyCredentials = await keytar.findCredentials(legacyService)
  await Promise.all(legacyCredentials
    .filter(({ account }) => account.startsWith(legacyPrefix))
    .map(({ account }) => keytar.deletePassword(legacyService, account)))

  const userDataPath = app.getPath('userData')
  const pluginDir = path.join(userDataPath, 'plugins', 'installed', `${pluginId}@${row.version}`)
  await fsp.rm(pluginDir, { recursive: true, force: true }).catch(() => {})

  db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(pluginId)
  db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(pluginId)
  getPluginEventBus()?.emit('plugin.uninstalled', { pluginId })
}

export async function enablePlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  const row = db.prepare(`
    SELECT manifest, dev_path, granted_authority, action_required
    FROM plugin_registry WHERE id = ?
  `).get(pluginId) as {
    manifest: string
    dev_path: string | null
    granted_authority: string
    action_required: number
  } | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  if (row.action_required === 1) {
    throw new Error('Plugin permissions changed. Review and approve them before enabling this plugin.')
  }

  // For bundled/dev plugins, re-read manifest from disk to recover from stale DB values
  let manifestRaw: unknown = JSON.parse(row.manifest)
  if (row.dev_path) {
    try {
      const fresh = JSON.parse(fs.readFileSync(path.join(row.dev_path, 'manifest.json'), 'utf8'))
      manifestRaw = fresh
      db.prepare('UPDATE plugin_registry SET manifest = ? WHERE id = ?')
        .run(JSON.stringify(fresh), pluginId)
    } catch { /* keep manifestRaw from DB */ }
  }

  const result = PluginManifestSchema.safeParse(manifestRaw)
  if (!result.success) {
    console.warn(`[plugin-manager] ${pluginId}: invalid manifest, enabled in DB only`)
    return
  }
  const manifest = result.data
  const expansion = authorityExpansion(parseAuthority(row.granted_authority), pluginAuthority(manifest))
  if (hasAuthorityExpansion(expansion)) {
    db.prepare('UPDATE plugin_registry SET enabled = 0, manifest = ?, action_required = 1 WHERE id = ?')
      .run(JSON.stringify(manifestRaw), pluginId)
    throw new Error('Plugin permissions changed. Review and approve them before enabling this plugin.')
  }

  db.prepare('UPDATE plugin_registry SET enabled = 1 WHERE id = ?').run(pluginId)

  // Skip spawning if the entry file doesn't exist (e.g. bundled plugin not yet built)
  const pluginRoot = row.dev_path
    ? row.dev_path
    : path.join(app.getPath('userData'), 'plugins', 'installed', `${pluginId}@${manifest.version}`)
  const entryFullPath = resolvePluginPath(pluginRoot, manifest.entry, 'Plugin entry')

  if (!fs.existsSync(entryFullPath)) {
    console.info(`[plugin-manager] ${pluginId}: entry not found at ${entryFullPath}, enabled in DB only`)
    return
  }
  requirePluginFile(pluginRoot, manifest.entry, 'Plugin entry')

  await spawnAndActivate(manifest)
}

export async function approvePluginPermissions(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  const row = db.prepare('SELECT manifest FROM plugin_registry WHERE id = ?').get(pluginId) as
    { manifest: string } | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  const manifest = PluginManifestSchema.parse(JSON.parse(row.manifest) as unknown)
  db.prepare('UPDATE plugin_registry SET granted_authority = ?, action_required = 0 WHERE id = ?')
    .run(JSON.stringify(pluginAuthority(manifest)), pluginId)
  await enablePlugin(pluginId)
}

export async function disablePlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  db.prepare('UPDATE plugin_registry SET enabled = 0 WHERE id = ?').run(pluginId)
  const host = getActiveHost(pluginId)
  try {
    if (host) await host.deactivate()
  } finally {
    removeActiveHost(pluginId)
  }
}

export function listPlugins(): Array<{
  id: string
  name: string
  version: string
  enabled: number
  source: string
  manifest: string
  action_required: number
  granted_authority: string
}> {
  const db = getRawSqlite()
  return db.prepare(`
    SELECT id, name, version, enabled, source, manifest, action_required, granted_authority
    FROM plugin_registry
  `).all() as Array<{
    id: string
    name: string
    version: string
    enabled: number
    source: string
    manifest: string
    action_required: number
    granted_authority: string
  }>
}

const devWatchers = new Map<string, FSWatcher>()

export async function loadDevPlugin(dirPath: string, approvedAuthority?: PluginAuthority): Promise<void> {
  const db = getRawSqlite()
  const manifestPath = path.join(dirPath, 'manifest.json')
  const manifestRaw = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
  const result = PluginManifestSchema.safeParse(manifestRaw)
  if (!result.success) throw new Error(`Invalid manifest: ${JSON.stringify(result.error.flatten())}`)
  const manifest = result.data
  const authority = pluginAuthority(manifest)
  if (approvedAuthority && JSON.stringify(approvedAuthority) !== JSON.stringify(authority)) {
    throw new Error('Development plugin authority changed after review')
  }
  requirePluginFile(dirPath, manifest.entry, 'Plugin entry')
  if (manifest.renderer) requirePluginFile(dirPath, manifest.renderer.entry, 'Renderer entry')

  // Deactivate any previous dev instance
  const existing = getActiveHost(manifest.id)
  if (existing) {
    await existing.deactivate()
  }
  devWatchers.get(manifest.id)?.close()
  devWatchers.delete(manifest.id)

  // Upsert plugin_registry row with source='dev'
  const row = db.prepare('SELECT id FROM plugin_registry WHERE id = ?').get(manifest.id)
  if (row) {
    db.prepare("UPDATE plugin_registry SET version=?, manifest=?, source='dev', enabled=1, dev_path=?, granted_authority=?, action_required=0 WHERE id=?")
      .run(manifest.version, JSON.stringify(manifestRaw), dirPath, JSON.stringify(authority), manifest.id)
  } else {
    db.prepare(`INSERT INTO plugin_registry (id, name, version, enabled, manifest, source, installed_at, dev_path, granted_authority, action_required)
      VALUES (?, ?, ?, 1, ?, 'dev', ?, ?, ?, 0)`)
      .run(manifest.id, manifest.name, manifest.version, JSON.stringify(manifestRaw), Date.now(), dirPath, JSON.stringify(authority))
  }

  await spawnAndActivate(manifest)

  // File watcher with 300ms debounce
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const watcher = watch(dirPath, { recursive: true }, (_eventType, filename) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      console.info(`[plugin-dev:${manifest.id}] change detected (${filename ?? '?'}), reloading…`)
      try {
        const host = getActiveHost(manifest.id)
        if (host) await host.deactivate()
        // Re-read manifest in case it changed
        const freshRaw = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
        const freshResult = PluginManifestSchema.safeParse(freshRaw)
        if (!freshResult.success) { console.error(`[plugin-dev:${manifest.id}] manifest invalid after reload`); return }
        if (JSON.stringify(pluginAuthority(freshResult.data)) !== JSON.stringify(authority)) {
          db.prepare('UPDATE plugin_registry SET enabled = 0, action_required = 1 WHERE id = ?').run(manifest.id)
          console.warn(`[plugin-dev:${manifest.id}] authority changed; native review is required`)
          return
        }
        db.prepare('UPDATE plugin_registry SET version = ?, manifest = ? WHERE id = ?')
          .run(freshResult.data.version, JSON.stringify(freshRaw), manifest.id)
        await spawnAndActivate(freshResult.data)
        console.info(`[plugin-dev:${manifest.id}] reload complete`)
      } catch (err) {
        console.error(`[plugin-dev:${manifest.id}] reload failed:`, err)
      }
    }, 300)
  })
  devWatchers.set(manifest.id, watcher)
}

export async function unloadDevPlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  devWatchers.get(pluginId)?.close()
  devWatchers.delete(pluginId)
  const host = getActiveHost(pluginId)
  if (host) await host.deactivate()
  db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(pluginId)
}

// Call on app quit to clear ephemeral dev rows
export function clearDevPluginRegistry(): void {
  try {
    const db = getRawSqlite()
    const tableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_registry'",
    ).get()
    if (tableExists) {
      db.prepare("DELETE FROM plugin_registry WHERE source = 'dev'").run()
    }
  } catch (err) {
    // Shutdown cleanup is best-effort and must not mask an earlier startup error.
    console.warn('[plugin-dev] failed to clear registry during shutdown:', err)
  }
}
