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
  },
  stats: {
    all: () => ['stats', 'all'] as const,
  },
  costs: {
    daily: () => ['costs', 'daily'] as const,
  },
}
