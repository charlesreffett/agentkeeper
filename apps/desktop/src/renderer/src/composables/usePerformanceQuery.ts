import { computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'

export function usePerformanceQuery(
  projectPath: Ref<string | null> | ComputedRef<string | null>,
  rangeDays = 30,
) {
  return useQuery({
    queryKey: computed(() => queryKeys.performance.summary(projectPath.value, rangeDays)),
    queryFn: () => window.agentkeeper.performance.getSummary({ projectPath: projectPath.value, rangeDays }),
    staleTime: 60_000,
  })
}
