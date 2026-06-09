export const queryKeys = {
  pricing: {
    table: () => ['pricing', 'table'] as const,
  },
  settings: {
    all: () => ['settings'] as const,
    app: () => ['settings', 'app'] as const,
    secrets: () => ['settings', 'secrets'] as const,
    github: () => ['settings', 'github'] as const,
  },
  agencies: {
    list: (projectPath?: string) => ['agencies', 'list', projectPath ?? ''] as const,
  },
  roles: {
    list: (projectPath?: string) => ['roles', 'list', projectPath ?? ''] as const,
  },
  projects: {
    list: () => ['projects', 'list'] as const,
    focused: () => ['projects', 'focused'] as const,
  },
  sessions: {
    persisted: (projectPath: string) => ['sessions', 'persisted', projectPath] as const,
    historical: (projectPath: string) => ['sessions', 'historical', projectPath] as const,
    trackedSdkIds: (projectPath: string) => ['sessions', 'trackedSdkIds', projectPath] as const,
    transcript: (projectPath: string, sdkSessionId: string) =>
      ['sessions', 'transcript', projectPath, sdkSessionId] as const,
  },
  stats: {
    all: () => ['stats', 'all'] as const,
  },
  costs: {
    daily: () => ['costs', 'daily'] as const,
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
}
