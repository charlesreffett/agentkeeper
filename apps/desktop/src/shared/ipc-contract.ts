// Shared between main, preload, and renderer. Pure types/constants only — no
// runtime imports from Electron or Node.

export interface RecentProject {
  path: string
  name: string
  lastOpenedAt: number
}

export interface OrchestralApi {
  project: {
    pick: () => Promise<RecentProject | null>
    recent: {
      list: () => Promise<RecentProject[]>
      remove: (path: string) => Promise<void>
    }
  }
}

export const IPC_CHANNELS = {
  projectPick: 'project:pick',
  projectRecentList: 'project:recent:list',
  projectRecentRemove: 'project:recent:remove',
} as const
