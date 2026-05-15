<template>
  <div class="flex flex-col h-full">
    <SidebarHeader title="Agencies">
      <template #icon><Network class="size-3" /></template>
      <template #actions>
        <button
          class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
          title="New agency"
          @click="emit('create')"
        >
          <Plus class="size-3.5" />
        </button>
      </template>
    </SidebarHeader>

    <div v-if="loading" class="p-4 text-xs text-muted-foreground">Loading…</div>

    <div
      v-else-if="agencies.length === 0"
      class="p-4 text-xs text-muted-foreground leading-relaxed"
    >
      No agencies yet. Create roles first, then bundle them into an agency.
    </div>

    <ul v-else class="flex-1 overflow-y-auto">
      <li
        v-for="a in agencies"
        :key="`${a.scope}:${a.id}`"
        class="border-b border-border/60 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50"
        :class="selectedId === a.id ? 'bg-muted' : ''"
        @click="emit('select', a.id)"
      >
        <div class="text-sm font-medium truncate text-foreground">{{ a.name }}</div>
        <div class="text-xs text-muted-foreground truncate mt-0.5">
          {{ a.description || '(no description)' }}
        </div>
        <div class="mt-1 flex items-center gap-2 text-[10px]">
          <span class="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
            {{ a.scope }}
          </span>
          <span class="text-muted-foreground/60">
            {{ a.roles.length }} role{{ a.roles.length === 1 ? '' : 's' }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { Network, Plus } from 'lucide-vue-next'
import SidebarHeader from '@/components/SidebarHeader.vue'
import type { Agency } from '../../../../shared/ipc-contract'

defineProps<{
  agencies: Agency[]
  selectedId: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create'): void
}>()
</script>
