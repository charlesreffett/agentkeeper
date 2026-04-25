import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'

export function usePluginHealth(pluginId: string): { isHealthy: Ref<boolean> } {
  const isHealthy = ref(true)
  let cleanup: (() => void) | null = null

  onMounted(() => {
    cleanup = window.orchestral.plugins.onEvent((event, payload) => {
      const p = payload as { pluginId?: string }
      if (p?.pluginId !== pluginId) return
      if (event === 'plugin.unhealthy') isHealthy.value = false
      else if (event === 'plugin.healthy') isHealthy.value = true
    })
  })

  onUnmounted(() => {
    cleanup?.()
    cleanup = null
  })

  return { isHealthy }
}
