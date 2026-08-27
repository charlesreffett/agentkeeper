<script setup lang="ts">
import { computed } from 'vue'
import {
  PanelRight,
  SquareTerminal,
} from '@/components/icons/app-icons'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useLayoutStore } from '@/stores/layout'
import { useTerminalStore } from '@/stores/terminalStore'
import { cn } from '@/lib/utils'
import { useRoute } from 'vue-router'
import { isSettingsRoute } from '@/lib/settingsShell'

const layoutStore = useLayoutStore()
const terminalStore = useTerminalStore()
const route = useRoute()

const isMacOS = computed(() => navigator.userAgent.includes('Macintosh'))
const isSettings = computed(() => isSettingsRoute(route.path))
</script>

<template>
  <header class="h-11 border-b bg-background flex items-center pr-3 gap-2 shrink-0" :class="isMacOS ? 'pl-[76px]' : 'pl-2'" style="-webkit-app-region: drag">
    <SidebarTrigger style="-webkit-app-region: no-drag" />

    <!-- Right side -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Terminal toggle -->
      <Button
        v-if="!isSettings"
        variant="ghost"
        size="icon"
        aria-label="Toggle terminal"
        :class="cn('h-7 w-7', terminalStore.isOpen && 'bg-accent text-accent-foreground')"
        style="-webkit-app-region: no-drag"
        @click="terminalStore.toggle()"
      >
        <SquareTerminal class="h-4 w-4" />
      </Button>
      <!-- Right panel toggle -->
      <Button
        v-if="!isSettings"
        variant="ghost"
        size="icon"
        aria-label="Toggle context panel"
        :class="cn('h-7 w-7', layoutStore.rightPanelOpen && 'bg-accent text-accent-foreground')"
        style="-webkit-app-region: no-drag"
        @click="layoutStore.toggleRightPanel()"
      >
        <PanelRight class="h-4 w-4" />
      </Button>
    </div>
  </header>
</template>
