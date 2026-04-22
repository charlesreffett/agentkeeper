import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RecentProject } from '../shared/ipc-contract'

const MAX_RECENT = 20

function filePath() {
  return path.join(app.getPath('userData'), 'recent-projects.json')
}

function read(): RecentProject[] {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(projects: RecentProject[]) {
  const file = filePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(projects, null, 2))
}

export const recentProjectsStore = {
  list(): RecentProject[] {
    return read().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  },
  add(project: RecentProject) {
    const current = read().filter((p) => p.path !== project.path)
    current.unshift(project)
    write(current.slice(0, MAX_RECENT))
  },
  remove(targetPath: string) {
    write(read().filter((p) => p.path !== targetPath))
  },
}
