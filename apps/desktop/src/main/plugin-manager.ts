import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { app } from 'electron'
import AdmZip from 'adm-zip'
import { PluginManifestSchema, UpdateManifestSchema } from '@agentkeeper/sdk'
import type { PluginManifest, UpdateRelease } from '@agentkeeper/sdk'
import { spawnAndActivate, getActiveHost } from './plugin-loader.js'
import { proxyRegistry } from './plugin-proxy.js'
import { getRawSqlite } from './db/index.js'
import { getPluginEventBus } from './plugins.js'

// ---- helpers ----

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(destDir, true)
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

async function downloadToTmp(url: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `agentkeeper-plugin-${Date.now()}.akp`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
  const buf = await res.arrayBuffer()
  await fsp.writeFile(tmpPath, Buffer.from(buf))
  return tmpPath
}

// ---- main API ----

export async function installPlugin(akpPath: string): Promise<void> {
  const db = getRawSqlite()
  const tmpDir = path.join(os.tmpdir(), `agentkeeper-plugin-extract-${Date.now()}`)
  await fsp.mkdir(tmpDir, { recursive: true })
  try {
    await extractZip(akpPath, tmpDir)
    const manifestRaw = JSON.parse(await fsp.readFile(path.join(tmpDir, 'manifest.json'), 'utf8')) as unknown
    const result = PluginManifestSchema.safeParse(manifestRaw)
    if (!result.success) throw new Error(`Invalid manifest: ${JSON.stringify(result.error.flatten())}`)
    const manifest = result.data

    const existing = db.prepare('SELECT id FROM plugin_registry WHERE id = ?').get(manifest.id)
    if (existing) throw new Error(`Plugin ${manifest.id} is already installed. Use updatePlugin() instead.`)

    const userDataPath = app.getPath('userData')
    const destDir = path.join(userDataPath, 'plugins', 'installed', `${manifest.id}@${manifest.version}`)
    await fsp.mkdir(path.dirname(destDir), { recursive: true })
    await fsp.rename(tmpDir, destDir)

    const manifestJson = JSON.stringify(manifestRaw)
    db.prepare(`
      INSERT INTO plugin_registry (id, name, version, enabled, manifest, source, installed_at)
      VALUES (?, ?, ?, 1, ?, 'local', ?)
    `).run(manifest.id, manifest.name, manifest.version, manifestJson, Date.now())

    await spawnAndActivate(manifest)
    await getActiveHost(manifest.id)?.install()
    getPluginEventBus()?.emit('plugin.installed', { pluginId: manifest.id, version: manifest.version })
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
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

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const av = parse(a), bv = parse(b)
  for (let i = 0; i < 3; i++) {
    const ai = av[i] ?? 0, bi = bv[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}

function satisfiesMin(appVer: string, minVer: string): boolean {
  return !semverGt(minVer, appVer)
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
        res = await fetch(manifest.update_url, { signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
      if (!res.ok) return
      const data = UpdateManifestSchema.safeParse(await res.json())
      if (!data.success) return
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

export async function updatePlugin(pluginId: string, release: UpdateRelease): Promise<void> {
  const db = getRawSqlite()
  const row = db.prepare('SELECT version, manifest FROM plugin_registry WHERE id = ?').get(pluginId) as { version: string; manifest: string } | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  const previousVersion = row.version

  const tmpAkp = await downloadToTmp(release.url)
  try {
    const actualHash = await sha256File(tmpAkp)
    if (actualHash !== release.sha256) throw new Error(`SHA-256 mismatch for ${pluginId}: expected ${release.sha256}, got ${actualHash}`)

    const tmpDir = path.join(os.tmpdir(), `agentkeeper-plugin-extract-${Date.now()}`)
    await fsp.mkdir(tmpDir, { recursive: true })
    try {
      await extractZip(tmpAkp, tmpDir)
      const manifestRaw = JSON.parse(await fsp.readFile(path.join(tmpDir, 'manifest.json'), 'utf8')) as unknown
      const result = PluginManifestSchema.safeParse(manifestRaw)
      if (!result.success) throw new Error('Invalid manifest in update package')
      const manifest = result.data

      // Deactivate current host
      const host = getActiveHost(pluginId)
      if (host) await host.deactivate()
      proxyRegistry.get(pluginId)?.close()
      proxyRegistry.delete(pluginId)

      // Replace directory
      const userDataPath = app.getPath('userData')
      const oldDir = path.join(userDataPath, 'plugins', 'installed', `${pluginId}@${previousVersion}`)
      const newDir = path.join(userDataPath, 'plugins', 'installed', `${pluginId}@${manifest.version}`)
      await fsp.rm(oldDir, { recursive: true, force: true }).catch(() => {})
      await fsp.rename(tmpDir, newDir)

      // Update registry
      db.prepare('UPDATE plugin_registry SET version = ?, manifest = ? WHERE id = ?')
        .run(manifest.version, JSON.stringify(manifestRaw), pluginId)

      // Spawn new version
      await spawnAndActivate(manifest)
      await getActiveHost(pluginId)?.update(previousVersion)
      getPluginEventBus()?.emit('plugin.updated', { pluginId, previousVersion, version: manifest.version })
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  } finally {
    await fsp.unlink(tmpAkp).catch(() => {})
  }
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  const row = db.prepare('SELECT version, source FROM plugin_registry WHERE id = ?').get(pluginId) as { version: string; source: string } | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  if (row.source === 'bundled') throw new Error(`Cannot uninstall bundled plugin ${pluginId}`)

  const host = getActiveHost(pluginId)
  if (host) {
    await host.uninstall()
    await host.deactivate()
  }
  proxyRegistry.get(pluginId)?.close()
  proxyRegistry.delete(pluginId)

  const userDataPath = app.getPath('userData')
  const pluginDir = path.join(userDataPath, 'plugins', 'installed', `${pluginId}@${row.version}`)
  await fsp.rm(pluginDir, { recursive: true, force: true }).catch(() => {})

  db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(pluginId)
  db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(pluginId)
  getPluginEventBus()?.emit('plugin.uninstalled', { pluginId })
}

export async function enablePlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  db.prepare('UPDATE plugin_registry SET enabled = 1 WHERE id = ?').run(pluginId)
  const row = db.prepare('SELECT manifest FROM plugin_registry WHERE id = ?').get(pluginId) as { manifest: string } | undefined
  if (!row) throw new Error(`Plugin ${pluginId} not found`)
  const manifest = PluginManifestSchema.parse(JSON.parse(row.manifest))
  await spawnAndActivate(manifest)
}

export async function disablePlugin(pluginId: string): Promise<void> {
  const db = getRawSqlite()
  db.prepare('UPDATE plugin_registry SET enabled = 0 WHERE id = ?').run(pluginId)
  const host = getActiveHost(pluginId)
  if (host) await host.deactivate()
  proxyRegistry.get(pluginId)?.close()
  proxyRegistry.delete(pluginId)
}

export function listPlugins(): { id: string; name: string; version: string; enabled: number; source: string; manifest: string }[] {
  const db = getRawSqlite()
  return db.prepare('SELECT id, name, version, enabled, source, manifest FROM plugin_registry').all() as { id: string; name: string; version: string; enabled: number; source: string; manifest: string }[]
}
