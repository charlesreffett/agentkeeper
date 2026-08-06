export const queryKeys = {
  pricing: {
    table: () => ['pricing', 'table'] as const,
  },
  models: {
    list: (harnessId?: string) => ['models', 'list', harnessId ?? ''] as const,
  },
  settings: {
    all: () => ['settings'] as const,
    app: () => ['settings', 'app'] as const,
    secrets: () => ['settings', 'secrets'] as const,
    github: () => ['settings', 'github'] as const,
  },
  agencies: {
    list: (projectPath?: string | null) => ['agencies', 'list', projectPath ?? null] as const,
  },
  roles: {
    list: (projectPath?: string | null) => ['roles', 'list', projectPath ?? null] as const,
  },
  projects: {
    list: () => ['projects', 'list'] as const,
    focused: () => ['projects', 'focused'] as const,
    pinnedBranches: (projectPath: string) => ['projects', 'pinnedBranches', projectPath] as const,
  },
  git: {
    branches: (projectPath: string) => ['git', 'branches', projectPath] as const,
  },
  sessions: {
    persisted: (projectPath: string | null) => ['sessions', 'persisted', projectPath] as const,
    historical: (projectPath: string | null) => ['sessions', 'historical', projectPath] as const,
    trackedSdkIds: (projectPath: string | null) => ['sessions', 'trackedSdkIds', projectPath] as const,
    transcript: (projectPath: string | null, sdkSessionId: string) =>
      ['sessions', 'transcript', projectPath, sdkSessionId] as const,
  },
  stats: {
    all: () => ['stats', 'all'] as const,
  },
  costs: {
    daily: () => ['costs', 'daily'] as const,
    dailyByProject: () => ['costs', 'dailyByProject'] as const,
  },
  plugins: {
    all: ['plugins'] as const,
    list: () => ['plugins', 'list'] as const,
    updates: () => ['plugins', 'updates'] as const,
  },
  harness: {
    list: () => ['harness', 'list'] as const,
    active: () => ['harness', 'active'] as const,
  },
  performance: {
    summary: (projectPath: string | null, rangeDays: number) =>
      ['performance', 'summary', projectPath ?? '', rangeDays] as const,
  },
}
