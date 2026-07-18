import { computed, toValue, type MaybeRefOrGetter } from 'vue'
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
    staleTime: Infinity,
  })

  const { mutate: refresh, isPending: isRefreshing } = useMutation({
    mutationFn: () => window.agentkeeper.models.refresh(id()),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.models.list(id()), result)
    },
  })

  const models = computed<ModelOption[]>(() =>
    (data.value?.models ?? []).map((m) => ({ ...m, shortLabel: toShortLabel(m.label) })))
  const error = computed(() => data.value?.error)
  const isEmpty = computed(() => !isLoading.value && models.value.length === 0)
  const defaultValue = computed(() => models.value.find((m) => m.isDefault)?.value ?? models.value[0]?.value ?? '')

  /** Options for a picker, guaranteeing the currently-selected value stays
   *  visible even if the harness no longer reports it (legacy stored model). */
  function optionsFor(selected?: string | null): ModelOption[] {
    const opts = models.value
    if (selected && selected !== SESSION_DEFAULT_VALUE && !opts.some((o) => o.value === selected)) {
      return [...opts, syntheticOption(selected)]
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
    const m = value ? opts.find((o) => o.value === value) : opts.find((o) => o.isDefault)
    if (m?.resolvedModel) return prettyModelId(m.resolvedModel)
    if (m) return m.label
    if (value) return prettyModelId(value)
    return 'Default'
  }

  /** Effort levels the selected model supports, falling back to the full set
   *  when the harness reports none (e.g. legacy value or unspecified). */
  function effortLevelsFor(value?: string | null): RoleEffort[] {
    const m = models.value.find((x) => x.value === value)
    if (m?.effortLevels?.length) return m.effortLevels as RoleEffort[]
    return ROLE_EFFORT_VALUES
  }

  return { models, error, isLoading, isEmpty, defaultValue, refresh, isRefreshing, optionsFor, optionsWithDefaultFor, effortLevelsFor, resolvedLabelFor }
}
