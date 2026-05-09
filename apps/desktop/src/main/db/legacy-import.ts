import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { type AppDb, getDb } from './index'
import { appState, agencies, costEntries, projects, sessions } from './schema'
import type { PersistedAgency, Session } from '../../shared/ipc-contract'
import type { CostEntry } from '../cost-ledger'
import type { RecentProject } from '../../shared/ipc-contract'

const FLAG = 'jsonFilesImported'

export function runLegacyImport(userDataPath: string): void {
  const db = getDb()
  const existing = db.select().from(appState).where(eq(appState.key, FLAG)).all()
  if (existing.length > 0) return

  db.transaction((tx) => {
    importSessionRegistry(tx, userDataPath)
    importCostLedger(tx, userDataPath)
    importRecentProjects(tx, userDataPath)
    tx.insert(appState).values({ key: FLAG, value: '1' }).onConflictDoNothing().run()
  })

  for (const name of ['session-registry.json', 'cost-ledger.json', 'recent-projects.json']) {
    const src = path.join(userDataPath, name)
    if (fs.existsSync(src)) {
      try { fs.renameSync(src, `${src}.pre-sqlite`) } catch { /* ignore */ }
    }
  }
}

function importSessionRegistry(tx: AppDb, userDataPath: string): void {
  const p = path.join(userDataPath, 'session-registry.json')
  let raw: { sessions?: Record<string, Session>; agencies?: Record<string, PersistedAgency> }
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return }

  for (const s of Object.values(raw.sessions ?? {})) {
    tx.insert(sessions).values({
      localId: s.localId,
      sdkSessionId: s.sdkSessionId ?? null,
      projectPath: s.projectPath,
      worktreePath: s.worktreePath ?? null,
      branch: s.branch ?? null,
      model: s.model ?? null,
      effort: s.effort ?? null,
      permissionMode: s.permissionMode ?? null,
      initialPrompt: s.initialPrompt ?? '',
      roleName: s.roleName ?? null,
      roleId: s.roleId ?? null,
      agencyInstanceId: s.agencyInstanceId ?? null,
      agencyName: s.agencyName ?? null,
      title: s.title ?? null,
      workItemKey: s.workItemKey ?? null,
      workItemTitle: s.workItemTitle ?? null,
      status: s.status ?? 'idle',
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
    }).onConflictDoNothing().run()
  }

  for (const a of Object.values(raw.agencies ?? {})) {
    tx.insert(agencies).values({
      instanceId: a.instanceId,
      agencyId: a.agencyId,
      agencyScope: a.agencyScope,
      agencyName: a.agencyName,
      workItemTitle: a.workItemTitle ?? null,
      initialPrompt: a.initialPrompt ?? '',
      title: a.title ?? null,
      projectPath: a.projectPath,
      worktreePath: a.worktreePath ?? null,
      branch: a.branch ?? null,
      startedAt: a.startedAt,
      lastActivityAt: a.lastActivityAt,
      roleSessionMap: JSON.stringify(a.roleSessionMap ?? {}),
      handoffs: JSON.stringify(a.handoffs ?? {}),
    }).onConflictDoNothing().run()
  }
}

function importCostLedger(tx: AppDb, userDataPath: string): void {
  const p = path.join(userDataPath, 'cost-ledger.json')
  let raw: { entries?: Record<string, CostEntry> }
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return }

  for (const e of Object.values(raw.entries ?? {})) {
    tx.insert(costEntries).values({
      key: e.key,
      date: e.date,
      model: e.model,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheCreationTokens: e.cacheCreationTokens,
      costUsd: e.costUsd,
      recordedAt: e.recordedAt,
    }).onConflictDoNothing().run()
  }
}

function importRecentProjects(tx: AppDb, userDataPath: string): void {
  const p = path.join(userDataPath, 'recent-projects.json')
  let raw: { projects?: RecentProject[]; focusedProjectPath?: string | null }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    raw = Array.isArray(parsed) ? { projects: parsed } : parsed
  } catch { return }

  for (const proj of raw.projects ?? []) {
    tx.insert(projects).values({
      path: proj.path,
      name: proj.name,
      repo: proj.repo ?? null,
      lastOpenedAt: proj.lastOpenedAt,
    }).onConflictDoNothing().run()
  }

  if (raw.focusedProjectPath) {
    tx.insert(appState).values({ key: 'focusedProjectPath', value: raw.focusedProjectPath })
      .onConflictDoNothing().run()
  }
}
