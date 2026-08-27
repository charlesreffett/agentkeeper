<script setup lang="ts">
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { useLayoutStore } from '@/stores/layout'

const layoutStore = useLayoutStore()
const options = [
  { value: 'system' as const, label: 'System', description: 'Follow your operating system', icon: Monitor },
  { value: 'light' as const, label: 'Light', description: 'Always use the light appearance', icon: Sun },
  { value: 'dark' as const, label: 'Dark', description: 'Always use the dark appearance', icon: Moon },
]
</script>

<template>
  <SettingsPage title="Appearance" description="Choose how AgentKeeper looks on this device.">
    <section aria-labelledby="color-scheme-heading" class="space-y-3">
      <div>
        <h2 id="color-scheme-heading" class="text-sm font-semibold">Color scheme</h2>
        <p class="mt-1 text-xs text-muted-foreground">More appearance controls will live here as customization expands.</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Color scheme">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="layoutStore.theme === option.value"
          class="flex min-h-28 flex-col items-start gap-3 rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
          :class="layoutStore.theme === option.value ? 'border-ring bg-accent/70' : 'border-border'"
          @click="void layoutStore.setTheme(option.value)"
        >
          <component :is="option.icon" class="size-5" aria-hidden="true" />
          <span>
            <span class="block text-sm font-medium">{{ option.label }}</span>
            <span class="mt-1 block text-xs text-muted-foreground">{{ option.description }}</span>
          </span>
        </button>
      </div>
    </section>
  </SettingsPage>
</template>
