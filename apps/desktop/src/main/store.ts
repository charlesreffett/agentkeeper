import fs from 'node:fs'
import path from 'node:path'
import { asc, desc, eq, max } from 'drizzle-orm'
import type { RecentProject } from '../shared/ipc-contract'
import { detectRemoteSources } from './git'
import { getDb } from './db/index'
import { appState, projects } from './db/schema'

const MAX_RECENT = 20

export async function detectGithubRepo(projectPath: string): Promise<string | null> {
  const sources = await detectRemoteSources(projectPath)
  return sources.find((s) => s.type === 'github')?.repo ?? null
}

export const recentProjectsStore = {
  list(): RecentProject[] {
    return getDb()
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder))
      .limit(MAX_RECENT)
      .all()
      .map((r) => ({ path: r.path, name: r.name, repo: r.repo ?? null, lastOpenedAt: r.lastOpenedAt }))
  },
  add(project: RecentProject) {
    const db = getDb()
    const existing = db.select({ path: projects.path }).from(projects).where(eq(projects.path, project.path)).get()
    const nextSortOrder = (db.select({ value: max(projects.sortOrder) }).from(projects).get()?.value ?? -1) + 1
    db.insert(projects).values({
      path: project.path,
      name: project.name,
      repo: project.repo ?? null,
      lastOpenedAt: project.lastOpenedAt,
      sortOrder: existing ? undefined : nextSortOrder,
    }).onConflictDoUpdate({
      target: projects.path,
      set: { name: project.name, repo: project.repo ?? null, lastOpenedAt: project.lastOpenedAt },
    }).run()

    // Prune beyond MAX_RECENT (keep the most recent).
    const all = db.select({ path: projects.path }).from(projects).orderBy(desc(projects.lastOpenedAt)).all()
    if (all.length > MAX_RECENT) {
      const toDelete = all.slice(MAX_RECENT)
      for (const p of toDelete) {
        db.delete(projects).where(eq(projects.path, p.path)).run()
      }
    }
  },
  remove(targetPath: string) {
    const db = getDb()
    db.delete(projects).where(eq(projects.path, targetPath)).run()
    // Clear focused if it matches the removed project.
    const focused = db.select({ value: appState.value }).from(appState).where(eq(appState.key, 'focusedProjectPath')).get()
    if (focused?.value === targetPath) {
      db.delete(appState).where(eq(appState.key, 'focusedProjectPath')).run()
    }
  },
  reorder(orderedPaths: string[]) {
    const db = getDb()
    const allPaths = db.select({ path: projects.path }).from(projects).orderBy(asc(projects.sortOrder)).all().map((p) => p.path)
    const knownPaths = new Set(allPaths)
    const requested = [...new Set(orderedPaths)].filter((path) => knownPaths.has(path))
    const requestedSet = new Set(requested)
    const order = [...requested, ...allPaths.filter((path) => !requestedSet.has(path))]
    db.transaction((tx) => {
      order.forEach((path, index) => {
        tx.update(projects).set({ sortOrder: index }).where(eq(projects.path, path)).run()
      })
    })
  },
  rename(oldPath: string, newName: string, renameDir: boolean): RecentProject {
    const db = getDb()
    const row = db.select().from(projects).where(eq(projects.path, oldPath)).get()
    if (!row) throw new Error(`Project not found: ${oldPath}`)
    let newPath = oldPath
    if (renameDir) {
      newPath = path.join(path.dirname(oldPath), newName)
      fs.renameSync(oldPath, newPath)
    }
    db.delete(projects).where(eq(projects.path, oldPath)).run()
    db.insert(projects).values({
      path: newPath,
      name: newName,
      repo: row.repo ?? null,
      lastOpenedAt: row.lastOpenedAt,
      sortOrder: row.sortOrder,
    }).onConflictDoUpdate({
      target: projects.path,
      set: { name: newName, repo: row.repo ?? null, lastOpenedAt: row.lastOpenedAt },
    }).run()

    // Update focused path if it pointed at the renamed project.
    const focused = db.select({ value: appState.value }).from(appState).where(eq(appState.key, 'focusedProjectPath')).get()
    if (focused?.value === oldPath) {
      db.update(appState).set({ value: newPath }).where(eq(appState.key, 'focusedProjectPath')).run()
    }

    return { path: newPath, name: newName, repo: row.repo ?? null, lastOpenedAt: row.lastOpenedAt }
  },
  update(oldPath: string, project: RecentProject): RecentProject {
    const db = getDb()
    const row = db.select().from(projects).where(eq(projects.path, oldPath)).get()
    if (!row) throw new Error(`Project not found: ${oldPath}`)
    if (project.path !== oldPath) {
      const existing = db.select({ path: projects.path }).from(projects).where(eq(projects.path, project.path)).get()
      if (existing) throw new Error('That source folder is already used by another project')
    }

    db.transaction((tx) => {
      tx.delete(projects).where(eq(projects.path, oldPath)).run()
      tx.insert(projects).values({
        path: project.path,
        name: project.name,
        repo: project.repo ?? null,
        lastOpenedAt: row.lastOpenedAt,
        sortOrder: row.sortOrder,
      }).run()

      const focused = tx.select({ value: appState.value }).from(appState).where(eq(appState.key, 'focusedProjectPath')).get()
      if (focused?.value === oldPath) {
        tx.update(appState).set({ value: project.path }).where(eq(appState.key, 'focusedProjectPath')).run()
      }
    })

    return { ...project, lastOpenedAt: row.lastOpenedAt }
  },
  getPinnedBranches(targetPath: string): string[] {
    const key = `pinnedBranches:${targetPath}`
    const row = getDb().select({ value: appState.value }).from(appState).where(eq(appState.key, key)).get()
    if (!row?.value) return []
    try {
      const parsed = JSON.parse(row.value) as unknown
      return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === 'string') : []
    } catch {
      return []
    }
  },
  setPinnedBranches(targetPath: string, branches: string[]) {
    const db = getDb()
    const key = `pinnedBranches:${targetPath}`
    if (branches.length === 0) {
      db.delete(appState).where(eq(appState.key, key)).run()
    } else {
      const value = JSON.stringify(branches)
      db.insert(appState).values({ key, value })
        .onConflictDoUpdate({ target: appState.key, set: { value } })
        .run()
    }
  },
  getFocused(): string | null {
    return getDb().select({ value: appState.value }).from(appState).where(eq(appState.key, 'focusedProjectPath')).get()?.value ?? null
  },
  setFocused(targetPath: string | null) {
    const db = getDb()
    if (targetPath === null) {
      db.delete(appState).where(eq(appState.key, 'focusedProjectPath')).run()
    } else {
      db.insert(appState).values({ key: 'focusedProjectPath', value: targetPath })
        .onConflictDoUpdate({ target: appState.key, set: { value: targetPath } })
        .run()
    }
  },
}
