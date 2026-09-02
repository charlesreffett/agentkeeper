import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import { PluginManifestSchema, type PluginManifest } from '@agentkeeper/sdk'
import { PluginHost } from './plugin-host.js'
import { createPluginProxy, createDenyAllProxy } from './plugin-proxy.js'
import { getRawSqlite } from './db/index.js'
import { getPluginEventBus } from './plugins.js'
import type { WorkItemRegistryFull } from './plugins.js'
import { requirePluginFile } from './plugin-paths.js'

const activeHosts = new Map<string, PluginHost>()
// dormantRegistry: activationEvent → manifests not yet activated
const dormantRegistry = new Map<string, PluginManifest[]>()
let _workItemRegistry: WorkItemRegistryFull | null = null

export async function scanPluginDirectories(userDataPath: string): Promise<PluginManifest[]> {
  const dirs = [
    path.join(userDataPath, 'plugins', 'installed'),
    path.join(userDataPath, 'plugins', 'dev'),
  ]
  const manifests: PluginManifest[] = []
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(dir, entry.name, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const result = PluginManifestSchema.safeParse(raw)
        if (!result.success) {
          console.warn(`[plugin-loader] invalid manifest at ${manifestPath}:`, result.error.flatten())
          continue
        }
        manifests.push(result.data)
      } catch (err) {
        console.warn(`[plugin-loader] failed to read ${manifestPath}:`, err)
      }
    }
  }
  return manifests
}

export function buildDormantRegistry(manifests: PluginManifest[]): void {
  dormantRegistry.clear()
  for (const manifest of manifests) {
    for (const event of manifest.activation_events) {
      const list = dormantRegistry.get(event) ?? []
      list.push(manifest)
      dormantRegistry.set(event, list)
    }
  }
}

export async function spawnPlugin(manifest: PluginManifest, webContents?: Electron.WebContents): Promise<void> {
  const db = getRawSqlite()
  const row = db.prepare('SELECT enabled FROM plugin_registry WHERE id = ?').get(manifest.id) as { enabled: number } | undefined
  if (row && row.enabled === 0) {
    console.info(`[plugin-loader] skipping disabled plugin: ${manifest.id}`)
    return
  }

  // Check min_app_version
  if (manifest.min_app_version) {
    const appVer = app.getVersion()
    if (!satisfiesMinVersion(appVer, manifest.min_app_version)) {
      console.warn(`[plugin-loader] plugin ${manifest.id} requires app >= ${manifest.min_app_version}, got ${appVer}`)
      const bus = getPluginEventBus()
      bus?.emit('plugin.unhealthy', { pluginId: manifest.id, reason: `Requires app >= ${manifest.min_app_version}` })
      return
    }
  }

  const entryPath = resolveEntryPath(manifest)

  const hasNetwork = manifest.permissions.includes('network')
  const proxy = hasNetwork
    ? await createPluginProxy(manifest.id, manifest.network?.hosts ?? [])
    : createDenyAllProxy(manifest.id)

  const bus = getPluginEventBus()
  if (!bus) throw new Error('[plugin-loader] event bus not initialized')

  const host = new PluginHost(
    manifest,
    entryPath,
    proxy.url,
    bus,
    _workItemRegistry!,
    webContents,
  )

  await host.spawn()
  activeHosts.set(manifest.id, host)
}

export async function activatePlugin(pluginId: string): Promise<void> {
  const host = activeHosts.get(pluginId)
  if (!host) throw new Error(`[plugin-loader] no spawned host for plugin: ${pluginId}`)
  const db = getRawSqlite()
  const configRows = db.prepare('SELECT key, value FROM plugin_storage WHERE plugin_id = ?').all(pluginId) as { key: string; value: string }[]
  const config: Record<string, unknown> = Object.fromEntries(configRows.map(r => [r.key, JSON.parse(r.value) as unknown]))
  await host.activate(config)
}

export async function spawnAndActivate(manifest: PluginManifest, webContents?: Electron.WebContents): Promise<void> {
  await spawnPlugin(manifest, webContents)
  if (activeHosts.has(manifest.id)) {
    await activatePlugin(manifest.id)
  }
}

function resolveEntryPath(manifest: PluginManifest): string {
  // Try dev_path first (dev-loaded plugins)
  const db = getRawSqlite()
  const row = db.prepare('SELECT dev_path, source FROM plugin_registry WHERE id = ?').get(manifest.id) as { dev_path: string | null; source: string } | undefined
  if (row?.dev_path) {
    return requirePluginFile(row.dev_path, manifest.entry, 'Plugin entry')
  }
  // Installed: plugins/installed/{id}@{version}/
  const userDataPath = app.getPath('userData')
  const installedDir = path.join(userDataPath, 'plugins', 'installed', `${manifest.id}@${manifest.version}`)
  return requirePluginFile(installedDir, manifest.entry, 'Plugin entry')
}

function satisfiesMinVersion(appVer: string, minVer: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const a = parse(appVer)
  const b = parse(minVer)
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

export async function fireActivationEvent(event: string, webContents?: Electron.WebContents): Promise<void> {
  const toActivate = dormantRegistry.get(event) ?? []
  if (toActivate.length === 0) return
  dormantRegistry.delete(event)
  const results = await Promise.allSettled(toActivate.map(m => spawnAndActivate(m, webContents)))
  for (const r of results) {
    if (r.status === 'rejected') console.error('[plugin-loader] activation error:', r.reason)
  }
}

export async function deactivateAll(): Promise<void> {
  const results = await Promise.allSettled([...activeHosts.values()].map(h => h.deactivate()))
  for (const r of results) {
    if (r.status === 'rejected') console.error('[plugin-loader] deactivation error:', r.reason)
  }
  activeHosts.clear()
}

export function getActiveHost(pluginId: string): PluginHost | undefined {
  return activeHosts.get(pluginId)
}

export function removeActiveHost(pluginId: string): void {
  activeHosts.delete(pluginId)
}

export function setWebContentsOnActiveHosts(wc: Electron.WebContents): void {
  for (const host of activeHosts.values()) {
    host.setWebContents(wc)
  }
}

export async function initPluginLoader(
  workItemRegistry: WorkItemRegistryFull,
  webContents?: Electron.WebContents,
): Promise<void> {
  _workItemRegistry = workItemRegistry
  const userDataPath = app.getPath('userData')
  const manifests = await scanPluginDirectories(userDataPath)

  // Also activate DB-registered plugins with dev_path (bundled and dev-loaded)
  const db = getRawSqlite()
  const devRows = db.prepare(
    "SELECT manifest, dev_path FROM plugin_registry WHERE enabled = 1 AND dev_path IS NOT NULL"
  ).all() as { manifest: string; dev_path: string }[]

  for (const row of devRows) {
    try {
      const raw = JSON.parse(row.manifest) as unknown
      const result = PluginManifestSchema.safeParse(raw)
      if (!result.success) continue
      const m = result.data
      if (manifests.some(existing => existing.id === m.id)) continue
      const entryFull = path.join(row.dev_path, m.entry)
      if (!fs.existsSync(entryFull)) continue
      manifests.push(m)
    } catch { /* skip malformed rows */ }
  }

  buildDormantRegistry(manifests)
  await fireActivationEvent('onStartup', webContents)

  app.on('before-quit', async () => {
    await deactivateAll()
  })
}
