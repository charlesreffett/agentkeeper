import { computed, onScopeDispose, unref, watch, type MaybeRef } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { queryKeys } from '@/lib/queryKeys'
import type { SwitchBranchOptions, SwitchResult } from '@shared/ipc-contract'

export function useGitBranches(projectPath: MaybeRef<string | null | undefined>) {
  const queryClient = useQueryClient()

  const path = computed(() => unref(projectPath) ?? null)
  const enabled = computed(() => path.value !== null)

  const isRepoQuery = useQuery({
    queryKey: computed(() => queryKeys.git.isRepo(path.value ?? '')),
    queryFn: () => window.agentkeeper.git.isRepo(path.value!),
    enabled,
    staleTime: 60_000,
  })
  // Gate every git query on repo detection so non-repo directories never fire
  // git commands (they'd fail and surface as a phantom "detached" branch).
  const isRepo = computed(() => path.value !== null && isRepoQuery.data.value === true)
  const gitEnabled = computed(() => isRepo.value)

  const branchesQuery = useQuery({
    queryKey: computed(() => queryKeys.git.branches(path.value ?? '')),
    queryFn: () => window.agentkeeper.git.listBranches(path.value!),
    enabled: gitEnabled,
    // The .git/HEAD watcher only catches switches — branches created/deleted
    // externally need refetch on focus / popover open.
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  })

  const pinnedQuery = useQuery({
    queryKey: computed(() => queryKeys.projects.pinnedBranches(path.value ?? '')),
    queryFn: () => window.agentkeeper.projects.getPinnedBranches(path.value!),
    enabled: gitEnabled,
  })

  function invalidate() {
    if (!path.value) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.git.branches(path.value) })
  }

  // Keep branch data current when HEAD is changed outside this composable
  // (for example from the terminal or another branch switcher). The main
  // process watcher is refcounted, so multiple consumers can safely watch the
  // same working copy.
  let watchedPath: string | null = null
  let watcherUpdate = Promise.resolve()
  const unsubscribeBranchChanged = window.agentkeeper.git.onBranchChanged((event) => {
    if (event.projectPath === path.value) invalidate()
  })

  watch(
    [path, isRepo],
    ([nextPath, nextIsRepo]) => {
      const desiredPath = nextIsRepo ? nextPath : null
      watcherUpdate = watcherUpdate.then(async () => {
        if (watchedPath === desiredPath) return
        if (watchedPath) await window.agentkeeper.fs.watchStop(watchedPath)
        watchedPath = null
        if (desiredPath) {
          await window.agentkeeper.fs.watchStart(desiredPath)
          watchedPath = desiredPath
        }
      })
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    unsubscribeBranchChanged()
    watcherUpdate = watcherUpdate.then(async () => {
      if (watchedPath) await window.agentkeeper.fs.watchStop(watchedPath)
      watchedPath = null
    })
  })

  const switchMutation = useMutation({
    mutationFn: ({ name, opts }: { name: string; opts?: SwitchBranchOptions }): Promise<SwitchResult> =>
      window.agentkeeper.git.switchBranch(path.value!, name, opts),
    onSettled: invalidate,
  })

  const createMutation = useMutation({
    mutationFn: ({ name, from }: { name: string; from?: string }): Promise<SwitchResult> =>
      window.agentkeeper.git.switchBranchCreate(path.value!, name, from),
    onSettled: invalidate,
  })

  const setPinnedMutation = useMutation({
    mutationFn: (branches: string[]) => window.agentkeeper.projects.setPinnedBranches(path.value!, branches),
    onSettled: () => {
      if (!path.value) return
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.pinnedBranches(path.value) })
    },
  })

  const branches = computed(() => branchesQuery.data.value ?? [])
  const pinnedBranches = computed(() => pinnedQuery.data.value ?? [])
  const currentBranch = computed(() => branches.value.find((b) => b.isCurrent) ?? null)

  async function togglePin(name: string): Promise<void> {
    const next = pinnedBranches.value.includes(name)
      ? pinnedBranches.value.filter((b) => b !== name)
      : [...pinnedBranches.value, name]
    await setPinnedMutation.mutateAsync(next)
  }

  const { data: appSettings } = useQuery({
    queryKey: queryKeys.settings.app(),
    queryFn: () => window.agentkeeper.settings.get(),
  })

  /**
   * Switch with the full soft-reject UX: dirty → toast with "Switch anyway"
   * (allowDirty retry — carries changes, never discards); conflict / live-session /
   * git-error → error toasts. Resolves true when the switch landed.
   */
  async function switchBranchInteractive(name: string, opts?: SwitchBranchOptions): Promise<boolean> {
    const allowDirty = opts?.allowDirty || appSettings.value?.gitSwitchWithoutSoftReject === true
    const result = await switchMutation.mutateAsync({ name, opts: allowDirty ? { allowDirty: true } : undefined })
    return handleSwitchResult(result, name)
  }

  function handleSwitchResult(result: SwitchResult, name: string): boolean {
    if (result.ok) {
      toast.success(`Switched to ${name}`)
      return true
    }
    switch (result.blocked) {
      case 'dirty':
        toast('Uncommitted changes on current branch', {
          description: `Switch to ${name} anyway? Changes are carried over, never lost.`,
          action: {
            label: 'Switch anyway',
            onClick: () => void switchBranchInteractive(name, { allowDirty: true }),
          },
        })
        break
      case 'conflict':
        toast.error('Cannot switch — local changes would be overwritten', { description: result.reason })
        break
      case 'live-session':
        toast.error('A session is running in this project — stop it before switching branches.')
        break
      case 'git-error':
        toast.error('Switch failed', { description: result.reason })
        break
    }
    return false
  }

  return {
    isRepo,
    branches,
    pinnedBranches,
    currentBranch,
    isLoading: branchesQuery.isLoading,
    refetch: () => branchesQuery.refetch(),
    switchBranch: (name: string, opts?: SwitchBranchOptions) => switchMutation.mutateAsync({ name, opts }),
    switchBranchInteractive,
    isSwitching: switchMutation.isPending,
    createBranch: (name: string, from?: string) => createMutation.mutateAsync({ name, from }),
    togglePin,
  }
}
