import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RecentProject } from '../shared/ipc-contract'
import { detectRemoteSources } from './git'

const MAX_RECENT = 20

interface StoreData {
  projects: RecentProject[]
  focusedProjectPath: string | null
}

function filePath() {
  return path.join(app.getPath('userData'), 'recent-projects.json')
}

function read(): StoreData {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      // migrate from old array-only format
      return {
        projects: parsed.map((p) => ({ ...p, repo: p.repo ?? null })),
        focusedProjectPath: null,
      }
    }
    return {
      projects: (parsed.projects ?? []).map((p: RecentProject) => ({
        ...p,
        repo: p.repo ?? null,
      })),
      focusedProjectPath: parsed.focusedProjectPath ?? null,
    }
  } catch {
    return { projects: [], focusedProjectPath: null }
  }
}

function write(data: StoreData) {
  const file = filePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export async function detectGithubRepo(projectPath: string): Promise<string | null> {
  const sources = await detectRemoteSources(projectPath)
  return sources.find((s) => s.type === 'github')?.repo ?? null
}

export const recentProjectsStore = {
  list(): RecentProject[] {
    return read().projects.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  },
  add(project: RecentProject) {
    const data = read()
    const rest = data.projects.filter((p) => p.path !== project.path)
    rest.unshift(project)
    write({ ...data, projects: rest.slice(0, MAX_RECENT) })
  },
  remove(targetPath: string) {
    const data = read()
    write({
      projects: data.projects.filter((p) => p.path !== targetPath),
      focusedProjectPath: data.focusedProjectPath === targetPath ? null : data.focusedProjectPath,
    })
  },
  getFocused(): string | null {
    return read().focusedProjectPath
  },
  setFocused(targetPath: string | null) {
    const data = read()
    write({ ...data, focusedProjectPath: targetPath })
  },
}
