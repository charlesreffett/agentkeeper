<template>
  <div class="grid grid-cols-2 gap-3 p-5 h-full min-h-0">
    <!-- Available -->
    <div class="flex flex-col border border-border rounded overflow-hidden min-h-0">
      <div class="px-3 py-2 border-b border-border bg-muted/40 shrink-0">
        <input
          v-model="leftQuery"
          type="text"
          placeholder="Search available roles…"
          class="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <ScrollArea class="flex-1">
        <button
          v-for="r in availableFiltered"
          :key="r.id"
          type="button"
          class="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted transition-colors group border-b border-border/60 last:border-b-0"
          @click="add(r.id)"
        >
          <span class="text-xs font-mono text-foreground">{{ r.id }}</span>
          <span class="text-[11px] text-muted-foreground truncate flex-1">{{ r.name }}</span>
          <span class="text-xs text-muted-foreground opacity-40 group-hover:opacity-100">→</span>
        </button>
        <div v-if="availableFiltered.length === 0" class="px-3 py-3 text-xs text-muted-foreground">
          {{ leftQuery ? 'No matches.' : 'All roles added.' }}
        </div>
      </ScrollArea>
    </div>

    <!-- Selected -->
    <div class="flex flex-col border border-border rounded overflow-hidden min-h-0">
      <div class="px-3 py-2 border-b border-border bg-muted/40 shrink-0 flex items-center justify-between">
        <span class="text-xs text-muted-foreground">{{ selectedRows.length }} selected</span>
        <span
          v-if="selectedRows.length > 0 && entryCount === 0"
          class="text-[10px] text-amber-400"
        >
          Mark ≥1 entry ★
        </span>
      </div>
      <ScrollArea class="flex-1">
        <div
          v-for="r in selectedRows"
          :key="r.id"
          class="px-3 py-2 flex items-center gap-2 border-b border-border/60 last:border-b-0"
        >
          <button
            type="button"
            class="text-base leading-none transition-colors"
            :class="r.isEntry ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'"
            :title="r.isEntry ? 'Entry point — click to unmark' : 'Mark as entry point'"
            @click="toggleEntry(r.id)"
          >
            {{ r.isEntry ? '★' : '☆' }}
          </button>
          <span class="text-xs font-mono text-foreground">{{ r.id }}</span>
          <span class="text-[11px] text-muted-foreground truncate flex-1">{{ r.name }}</span>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-red-400"
            title="Remove"
            @click="remove(r.id)"
          >
            ×
          </button>
        </div>
        <div
          v-if="selectedRows.length === 0"
          class="px-3 py-6 text-xs text-muted-foreground text-center"
        >
          No roles selected. Click a role on the left to add it.
        </div>
      </ScrollArea>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Role } from '../../../../shared/ipc-contract'
import type { AgencyComposition } from './composition'

const props = defineProps<{ allRoles: Role[] }>()
const model = defineModel<AgencyComposition>({ required: true })

const leftQuery = ref('')

const selectedIds = computed(() => new Set(model.value.roles.map(r => r.roleId)))

const availableFiltered = computed(() => {
  const q = leftQuery.value.trim().toLowerCase()
  return props.allRoles
    .filter(r => !selectedIds.value.has(r.id))
    .filter(r => !q || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
})

const selectedRows = computed(() =>
  model.value.roles.map(slot => {
    const meta = props.allRoles.find(r => r.id === slot.roleId)
    return {
      id: slot.roleId,
      name: meta?.name ?? slot.roleId,
      isEntry: model.value.entryPoints.includes(slot.roleId),
    }
  }),
)

const entryCount = computed(() => model.value.entryPoints.length)

function add(roleId: string) {
  if (selectedIds.value.has(roleId)) return
  model.value = {
    ...model.value,
    roles: [...model.value.roles, { roleId }],
  }
}

function remove(roleId: string) {
  model.value = {
    roles: model.value.roles.filter(s => s.roleId !== roleId),
    flows: model.value.flows.filter(([a, b]) => a !== roleId && b !== roleId),
    entryPoints: model.value.entryPoints.filter(id => id !== roleId),
  }
}

function toggleEntry(roleId: string) {
  const has = model.value.entryPoints.includes(roleId)
  model.value = {
    ...model.value,
    entryPoints: has
      ? model.value.entryPoints.filter(id => id !== roleId)
      : [...model.value.entryPoints, roleId],
  }
}
</script>
