import { computed, onMounted, onUnmounted, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import { ROLE_EFFORT_VALUES, type AvailableModel, type RoleEffort } from '@shared/ipc-contract'

export type { AvailableModel }

export interface ModelOption extends AvailableModel {
  /** Compact form for tight button-group UIs; derived, since the harness
   *  reports no short label. */
  shortLabel: string
}

const SESSION_DEFAULT_VALUE = ''
const MODEL_STALE_TIME = 5 * 60 * 1000

export function formatContextWindow(value?: number): string | undefined {
  if (!value || !Number.isFinite(value) || value < 1) return undefined
  const compact = Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  return `${compact} context`
}

function toShortLabel(label: string): string {
  return label.split(/[\s(]/)[0]?.toLowerCase() || label
}

/** Readable name+version from a raw model id. `claude-opus-4-8` → `Opus 4.8`.
 *  Trailing snapshot dates (`-20250514`) are dropped. */
function prettyModelId(value: string): string {
  const tokens = value.replace(/^claude-/, '').split('-').filter((t) => !/^\d{6,}$/.test(t))
  const parts: string[] = []
  let version: string[] = []
  const flush = () => { if (version.length) { parts.push(version.join('.')); version = [] } }
  for (const t of tokens) {
    if (/^\d+$/.test(t)) version.push(t)
    else { flush(); parts.push(t.charAt(0).toUpperCase() + t.slice(1)) }
  }
  flush()
  return parts.join(' ')
}

/** Best-effort name for a raw model id the harness didn't report (a
 *  legacy/persisted value). `claude-fable-5` → `Fable 5 (unavailable)`. */
function humanizeModelId(value: string): string {
  return `${prettyModelId(value)} (unavailable)`
}

function syntheticOption(value: string): ModelOption {
  return { value, label: humanizeModelId(value), shortLabel: toShortLabel(value) }
}

export function useModelsQuery(harnessId?: MaybeRefOrGetter<string | undefined>) {
  const queryClient = useQueryClient()
  const id = () => toValue(harnessId)

  const { data, isLoading } = useQuery({
    queryKey: computed(() => queryKeys.models.list(id())),
    queryFn: () => window.agentkeeper.models.list(id()),
    staleTime: MODEL_STALE_TIME,
  })

  let stopSnapshotListener: (() => void) | undefined
  onMounted(() => {
    stopSnapshotListener = window.agentkeeper.models.onChanged((snapshot) => {
      const currentId = id()
      const current = queryClient.getQueryData<{ harnessId: string }>(queryKeys.models.list(currentId))
      if (snapshot.harnessId === currentId || current?.harnessId === snapshot.harnessId) {
        queryClient.setQueryData(queryKeys.models.list(currentId), snapshot)
      }
      queryClient.setQueryData(queryKeys.models.list(snapshot.harnessId), snapshot)
    })
  })
  onUnmounted(() => stopSnapshotListener?.())

  const { mutate: refresh, isPending: isRefreshing } = useMutation({
    mutationFn: () => window.agentkeeper.models.refresh(id()),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.models.list(id()), result)
    },
  })

  function refreshIfStale(): void {
    const refreshedAt = data.value?.refreshedAt
    if (data.value?.status === 'refreshing') return
    if (refreshedAt === null || refreshedAt === undefined || Date.now() - refreshedAt >= MODEL_STALE_TIME) refresh()
  }

  const models = computed<ModelOption[]>(() =>
    (data.value?.models ?? []).map((m) => ({ ...m, shortLabel: toShortLabel(m.label) })))
  const error = computed(() => data.value?.error)
  const status = computed(() => data.value?.status)
  const isEmpty = computed(() => !isLoading.value && models.value.length === 0)
  const defaultValue = computed(() => models.value.find((m) => m.isDefault)?.value ?? models.value[0]?.value ?? '')

  /** The concrete model a stored value maps to within this harness. An id the
   *  harness reports is kept as-is; an off-list alias (`default`, `''`, or a
   *  value from another harness) resolves to this harness's `isDefault` model
   *  when it has one — so the picker highlights a real row instead of a phantom
   *  "unavailable" entry. Genuinely unknown ids (no default) pass through. */
  function effectiveValueFor(selected?: string | null): string {
    if (selected && models.value.some((o) => o.value === selected)) return selected
    return defaultValue.value || selected || SESSION_DEFAULT_VALUE
  }

  /** Options for a picker, guaranteeing the currently-selected value stays
   *  visible even if the harness no longer reports it (legacy stored model). */
  function optionsFor(selected?: string | null): ModelOption[] {
    const opts = models.value
    const eff = effectiveValueFor(selected)
    if (eff && eff !== SESSION_DEFAULT_VALUE && !opts.some((o) => o.value === eff)) {
      return [...opts, syntheticOption(eff)]
    }
    return opts
  }

  /** Same as optionsFor, prefixed with a "Session default" (empty value) entry
   *  for role editors where blank means inherit. */
  function optionsWithDefaultFor(selected?: string | null): ModelOption[] {
    return [{ value: SESSION_DEFAULT_VALUE, label: 'Session default', shortLabel: 'default' }, ...optionsFor(selected)]
  }

  /** Human label for a selected model that always names the concrete
   *  model+version — resolving `default`/aliases via `resolvedModel` — so a
   *  live session never just reads "Default". Off-list ids are humanized. */
  function resolvedLabelFor(value?: string | null): string {
    const opts = models.value
    const eff = effectiveValueFor(value)
    const m = eff ? opts.find((o) => o.value === eff) : opts.find((o) => o.isDefault)
    if (m?.resolvedModel) return prettyModelId(m.resolvedModel)
    if (m) return m.label
    if (eff) return prettyModelId(eff)
    return 'Default'
  }

  /** Effort levels the selected model supports, falling back to the full set
   *  when the harness reports none (e.g. legacy value or unspecified). */
  function effortLevelsFor(value?: string | null): RoleEffort[] {
    const m = models.value.find((x) => x.value === value)
    if (m?.effortLevels?.length) return m.effortLevels as RoleEffort[]
    return ROLE_EFFORT_VALUES
  }

  return { models, error, status, isLoading, isEmpty, defaultValue, refresh, refreshIfStale, isRefreshing, optionsFor, optionsWithDefaultFor, effortLevelsFor, resolvedLabelFor, effectiveValueFor }
}
