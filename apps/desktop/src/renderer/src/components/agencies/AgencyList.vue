<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-2 border-b border-zinc-800">
      <button
        class="w-full text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-1.5 transition-colors text-left flex items-center gap-1.5"
        @click="emit('create')"
      >
        <span class="text-base leading-none">+</span>
        New agency
      </button>
    </div>

    <div v-if="loading" class="p-4 text-xs text-zinc-500">Loading…</div>

    <div
      v-else-if="agencies.length === 0"
      class="p-4 text-xs text-zinc-500 leading-relaxed"
    >
      No agencies yet. Create roles first, then bundle them into an agency.
    </div>

    <ul v-else class="flex-1 overflow-y-auto">
      <li
        v-for="a in agencies"
        :key="`${a.scope}:${a.id}`"
        class="border-b border-zinc-800/60 px-3 py-2.5 cursor-pointer transition-colors hover:bg-zinc-800/50"
        :class="selectedId === a.id ? 'bg-zinc-800' : ''"
        @click="emit('select', a.id)"
      >
        <div class="text-sm font-medium truncate text-zinc-200">{{ a.name }}</div>
        <div class="text-xs text-zinc-500 truncate mt-0.5">
          {{ a.description || '(no description)' }}
        </div>
        <div class="mt-1 flex items-center gap-2 text-[10px]">
          <span class="px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-mono">
            {{ a.scope }}
          </span>
          <span class="text-zinc-600">
            {{ a.roles.length }} role{{ a.roles.length === 1 ? '' : 's' }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
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
