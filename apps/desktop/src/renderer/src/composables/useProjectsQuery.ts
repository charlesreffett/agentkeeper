import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'

export function useProjectsQuery() {
  const queryClient = useQueryClient()

  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: () => window.agentkeeper.projects.list(),
  })

  const { data: focusedData, isLoading: isLoadingFocused } = useQuery({
    queryKey: queryKeys.projects.focused(),
    queryFn: () => window.agentkeeper.projects.getFocused(),
  })

  const projects = computed(() => projectsData.value ?? [])
  const focusedProject = computed(() => focusedData.value ?? null)

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.focused() })
  }

  const { mutateAsync: add } = useMutation({
    mutationFn: (path: string) => window.agentkeeper.projects.add(path),
    onSuccess: invalidateAll,
  })

  const { mutateAsync: remove } = useMutation({
    mutationFn: (path: string) => window.agentkeeper.projects.remove(path),
    onSuccess: invalidateAll,
  })

  const { mutateAsync: setFocused } = useMutation({
    mutationFn: (path: string | null) => window.agentkeeper.projects.setFocused(path),
    onSuccess: invalidateAll,
  })

  const { mutateAsync: rename } = useMutation({
    mutationFn: ({ oldPath, newName, renameDir }: { oldPath: string; newName: string; renameDir: boolean }) =>
      window.agentkeeper.projects.rename(oldPath, newName, renameDir),
    onSuccess: invalidateAll,
  })

  const { mutateAsync: create, isPending: isCreating } = useMutation({
    mutationFn: (params: import('@shared/ipc-contract').CreateProjectParams) =>
      window.agentkeeper.projects.create(params),
    onSuccess: invalidateAll,
  })

  async function pickAndAdd(): Promise<void> {
    const path = await window.agentkeeper.projects.pickFolder()
    if (path) await add(path)
  }

  return {
    projects,
    focusedProject,
    isLoading: computed(() => isLoadingProjects.value || isLoadingFocused.value),
    add,
    remove,
    setFocused,
    rename,
    create,
    isCreating,
    pickAndAdd,
  }
}
