import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import { PluginManifestSchema, satisfiesMinimumAppVersion, type PluginManifest } from '@agentkeeper/sdk'
import { PluginHost } from './plugin-host.js'
import { getRawSqlite } from './db/index.js'
import { getPluginEventBus } from './plugins.js'
import type { WorkItemRegistryFull } from './plugins.js'
import { requirePluginFile } from './plugin-paths.js'
import { authoritiesEqual, authorityFromManifest, parseAuthority } from './plugin-authority.js'
import { settingsStore } from './settings.js'

const activeHosts = new Map<string, PluginHost>()
// dormantRegistry: activationEvent → manifests not yet activated
const dormantRegistry = new Map<string, PluginManifest[]>()
let _workItemRegistry: WorkItemRegistryFull | null = null

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
  const row = db.prepare(
    'SELECT version, enabled, manifest, action_required, granted_authority FROM plugin_registry WHERE id = ?',
  ).get(manifest.id) as {
    version: string
    enabled: number
    manifest: string
    action_required: number
    granted_authority: string
  } | undefined
  if (!row) {
    throw new Error(`[plugin-loader] refusing to spawn unregistered plugin: ${manifest.id}`)
  }
  if (row.enabled === 0 || row.action_required === 1) {
    console.info(`[plugin-loader] skipping disabled plugin: ${manifest.id}`)
    return
  }
  const registered = PluginManifestSchema.safeParse(JSON.parse(row.manifest) as unknown)
  if (!registered.success || registered.data.id !== manifest.id || row.version !== manifest.version) {
    throw new Error(`[plugin-loader] manifest does not match the approved registry record: ${manifest.id}`)
  }
  const authority = parseAuthority(row.granted_authority)
  if (!authoritiesEqual(authority, authorityFromManifest(registered.data))) {
    db.prepare('UPDATE plugin_registry SET enabled = 0, action_required = 1 WHERE id = ?').run(manifest.id)
    throw new Error(`[plugin-loader] approved authority does not match manifest: ${manifest.id}`)
  }

  // Check min_app_version
  if (manifest.min_app_version) {
    const appVer = app.getVersion()
    if (!satisfiesMinimumAppVersion(appVer, manifest.min_app_version)) {
      console.warn(`[plugin-loader] plugin ${manifest.id} requires app >= ${manifest.min_app_version}, got ${appVer}`)
      const bus = getPluginEventBus()
      bus?.emit('plugin.unhealthy', { pluginId: manifest.id, reason: `Requires app >= ${manifest.min_app_version}` })
      return
    }
  }

  const entryPath = resolveEntryPath(manifest)

  const bus = getPluginEventBus()
  if (!bus) throw new Error('[plugin-loader] event bus not initialized')

  const entryStat = await fsp.lstat(entryPath)
  if (!entryStat.isFile() || entryStat.isSymbolicLink() || entryStat.size > 20 * 1024 * 1024) {
    throw new Error(`[plugin-loader] invalid backend artifact: ${manifest.id}`)
  }
  const pluginSource = await fsp.readFile(entryPath, 'utf8')
  const host = new PluginHost(
    manifest,
    pluginSource,
    authority,
    bus,
    _workItemRegistry!,
    webContents,
    () => activeHosts.delete(manifest.id),
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
  const db = getRawSqlite()
  const rows = db.prepare(
    'SELECT id, version, manifest, source FROM plugin_registry WHERE enabled = 1 AND action_required = 0',
  ).all() as Array<{ id: string; version: string; manifest: string; source: string }>
  const manifests: PluginManifest[] = []

  // The registry is the consent boundary. Never discover executable packages by
  // walking writable directories: an orphaned/partially-installed directory or a
  // manually dropped package must not become executable merely because it exists.
  for (const row of rows) {
    if (row.source === 'dev' && !settingsStore.get().pluginDeveloperMode) {
      db.prepare('UPDATE plugin_registry SET enabled = 0 WHERE id = ?').run(row.id)
      continue
    }
    try {
      const raw = JSON.parse(row.manifest) as unknown
      const result = PluginManifestSchema.safeParse(raw)
      if (!result.success || result.data.id !== row.id || result.data.version !== row.version) {
        console.warn(`[plugin-loader] invalid approved manifest for ${row.id}`)
        continue
      }
      manifests.push(result.data)
    } catch (error) {
      console.warn(`[plugin-loader] failed to read approved manifest for ${row.id}:`, error)
    }
  }

  buildDormantRegistry(manifests)
  await fireActivationEvent('onStartup', webContents)

  app.on('before-quit', async () => {
    await deactivateAll()
  })
}
