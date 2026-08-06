<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Moon,
  PanelRight,
  Puzzle,
  Settings,
  Settings2,
  SquareTerminal,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useLayoutStore } from '@/stores/layout'
import { useTerminalStore } from '@/stores/terminalStore'
import { useRouter } from 'vue-router'
import { cn } from '@/lib/utils'

const layoutStore = useLayoutStore()
const terminalStore = useTerminalStore()
const router = useRouter()

const isMacOS = computed(() => navigator.userAgent.includes('Macintosh'))
</script>

<template>
  <header class="h-11 border-b bg-background flex items-center pr-3 gap-2 shrink-0" :class="isMacOS ? 'pl-[76px]' : 'pl-2'" style="-webkit-app-region: drag">
    <SidebarTrigger style="-webkit-app-region: no-drag" />

    <!-- Right side -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Settings action menu -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7"
            style="-webkit-app-region: no-drag"
          >
            <Settings class="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-[300px]" style="-webkit-app-region: no-drag">
          <DropdownMenuItem class="flex items-center justify-between px-3 py-2.5" @select.prevent="void layoutStore.toggleTheme()">
            <div class="flex items-center gap-2">
              <Moon
                class="h-4 w-4 transition-colors"
                :class="layoutStore.theme === 'dark' ? 'fill-white' : 'fill-transparent'"
              />
              <span>Dark Mode</span>
            </div>
            <div
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors pointer-events-none"
              :class="layoutStore.theme === 'dark' ? 'bg-primary' : 'bg-muted'"
            >
              <div
                class="h-3.5 w-3.5 rounded-full bg-background shadow transition-transform"
                :class="layoutStore.theme === 'dark' ? 'translate-x-[18px]' : 'translate-x-[2px]'"
              />
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem class="px-3 py-2.5" @click="void router.push('/plugins')">
            <Puzzle class="h-4 w-4 mr-2" />
            Plugins
          </DropdownMenuItem>
          <DropdownMenuItem class="px-3 py-2.5" @click="void router.push('/settings')">
            <Settings2 class="h-4 w-4 mr-2" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Terminal toggle -->
      <Button
        variant="ghost"
        size="icon"
        :class="cn('h-7 w-7', terminalStore.isOpen && 'bg-accent text-accent-foreground')"
        style="-webkit-app-region: no-drag"
        @click="terminalStore.toggle()"
      >
        <SquareTerminal class="h-4 w-4" />
      </Button>
      <!-- Right panel toggle -->
      <Button
        variant="ghost"
        size="icon"
        :class="cn('h-7 w-7', layoutStore.rightPanelOpen && 'bg-accent text-accent-foreground')"
        style="-webkit-app-region: no-drag"
        @click="layoutStore.toggleRightPanel()"
      >
        <PanelRight class="h-4 w-4" />
      </Button>
    </div>
  </header>
</template>
