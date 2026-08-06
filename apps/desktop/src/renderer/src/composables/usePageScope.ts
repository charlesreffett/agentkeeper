import { computed, ref, watch, type Ref } from 'vue'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { projectColor } from '@/lib/projectColor'

/** Sentinel scope values. Real project scopes are the project's own `path`. */
export const SCOPE_ALL = 'all'
export const SCOPE_GLOBAL = 'global'

export type PageScope = string

export interface ScopeOption {
  value: PageScope
  label: string
  kind: 'all' | 'global' | 'project' | 'new'
  color?: string
  path?: string
}

export interface PageScopeConfig {
  /** Show the "Global" (scope: 'global') option — for pages that split
   *  global vs project items (roles, agencies, skills, commands, settings). */
  includeGlobal?: boolean
  /** Initial scope when nothing is persisted. Defaults to Global when the
   *  page splits global/project, otherwise All. */
  defaultScope?: PageScope
}

const STORAGE_PREFIX = 'scope.'

function readStored(pageId: string): PageScope | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + pageId)
  } catch {
    return null
  }
}

function writeStored(pageId: string, value: PageScope): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + pageId, value)
  } catch {
    // localStorage unavailable — scope stays session-only.
  }
}

/**
 * Per-page context scope, persisted to localStorage keyed by `pageId`.
 * Replaces the app-wide focused-project knob: each page owns its own filter.
 */
export function usePageScope(pageId: string, config: PageScopeConfig = {}) {
  const { includeGlobal = false } = config
  const defaultScope = config.defaultScope ?? (includeGlobal ? SCOPE_GLOBAL : SCOPE_ALL)

  const { projects, pickAndAdd } = useProjectsQuery()

  const scope: Ref<PageScope> = ref(readStored(pageId) ?? defaultScope)

  watch(scope, (v) => writeStored(pageId, v))

  function setScope(next: PageScope): void {
    scope.value = next
  }

  /** Add a project via the OS picker, then switch scope to it. */
  async function pickAndAdd_(): Promise<void> {
    const before = new Set(projects.value.map((p) => p.path))
    await pickAndAdd()
    const added = projects.value.find((p) => !before.has(p.path))
    if (added) setScope(added.path)
  }

  const options = computed<ScopeOption[]>(() => {
    const opts: ScopeOption[] = [{ value: SCOPE_ALL, label: 'All', kind: 'all' }]
    if (includeGlobal) opts.push({ value: SCOPE_GLOBAL, label: 'Global', kind: 'global' })
    for (const p of [...projects.value].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))) {
      opts.push({ value: p.path, label: p.name, kind: 'project', color: projectColor(p.name), path: p.path })
    }
    opts.push({ value: '__new__', label: 'New project…', kind: 'new' })
    return opts
  })

  const isAll = computed(() => scope.value === SCOPE_ALL)
  const isGlobal = computed(() => scope.value === SCOPE_GLOBAL)
  const isProject = computed(
    () => !isAll.value && !isGlobal.value,
  )

  const currentProject = computed(() =>
    isProject.value ? projects.value.find((p) => p.path === scope.value) ?? null : null,
  )

  /** Discriminator for query keys. Stable string per scope. */
  const scopePath = computed<string>(() => scope.value)

  const label = computed(() => {
    if (isAll.value) return 'All'
    if (isGlobal.value) return 'Global'
    return currentProject.value?.name ?? 'All'
  })

  const color = computed(() =>
    isProject.value && currentProject.value ? projectColor(currentProject.value.name) : null,
  )

  /** Scope target for save/create mutations that take { scope, path }. */
  const scopeTarget = computed<{ scope: 'global' | 'project'; path?: string }>(() =>
    isProject.value && currentProject.value
      ? { scope: 'project', path: currentProject.value.path }
      : { scope: 'global' },
  )

  return {
    scope,
    scopePath,
    setScope,
    options,
    pickAndAdd: pickAndAdd_,
    isAll,
    isGlobal,
    isProject,
    currentProject,
    label,
    color,
    scopeTarget,
  }
}
