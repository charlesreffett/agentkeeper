<template>
  <div class="p-4 flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-foreground font-mono">{{ roleSlot.roleId }}</h2>
      <button
        class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
        @click="emit('close')"
        title="Close"
      >
        ×
      </button>
    </div>

    <!-- Entry point toggle -->
    <div class="flex items-center justify-between py-2 border-b border-border">
      <div>
        <div class="text-xs font-medium text-foreground">Entry point</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">Receives the initial user prompt</div>
      </div>
      <button
        class="relative w-9 h-5 rounded-full transition-colors"
        :class="isEntry ? 'bg-amber-500' : 'bg-secondary'"
        @click="emit('toggle-entry')"
      >
        <span
          class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
          :class="isEntry ? 'left-4' : 'left-0.5'"
        />
      </button>
    </div>

    <!-- Instance count -->
    <div class="space-y-2">
      <div class="text-xs font-medium text-muted-foreground">Instance count</div>
      <div class="flex rounded border border-border overflow-hidden text-xs">
        <button
          v-for="opt in instanceModes"
          :key="opt.value"
          class="flex-1 px-2 py-1.5 transition-colors"
          :class="mode === opt.value
            ? 'bg-secondary text-foreground'
            : 'bg-muted text-muted-foreground hover:bg-secondary'"
          @click="mode = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>

      <div v-if="mode === 'fixed'" class="flex items-center gap-2">
        <label class="text-xs text-muted-foreground">Count</label>
        <input
          v-model.number="fixedCount"
          type="number"
          min="1"
          class="w-16 rounded border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:border-foreground/40"
        />
        <button
          v-if="fixedCount > 1"
          class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          @click="fixedCount = 1"
          title="Reset to 1"
        >
          ×1
        </button>
      </div>

      <div v-if="mode === 'dynamic'" class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
          Min
          <input
            v-model.number="dynMin"
            type="number"
            min="1"
            class="w-14 rounded border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:border-foreground/40"
          />
        </label>
        <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
          Max
          <input
            v-model.number="dynMax"
            type="number"
            min="2"
            class="w-14 rounded border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:border-foreground/40"
          />
        </label>
      </div>

      <div class="flex items-center gap-2">
        <button
          class="text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded px-3 py-1.5 transition-colors"
          @click="applyCount"
        >
          Apply
        </button>
        <button
          v-if="isDirty"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
          @click="syncFromSlot"
          title="Revert to saved"
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Connections -->
    <div class="space-y-3 border-t border-border pt-3">
      <div>
        <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Incoming flows</div>
        <div v-if="incoming.length === 0" class="text-xs text-muted-foreground/60">None</div>
        <div v-else class="flex flex-wrap gap-1">
          <button
            v-for="src in incoming"
            :key="src"
            class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
            @click="emit('select-edge', `${src}->${roleSlot.roleId}`)"
          >
            {{ src }}
          </button>
        </div>
      </div>
      <div>
        <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Outgoing flows</div>
        <div v-if="outgoing.length === 0" class="text-xs text-muted-foreground/60">None</div>
        <div v-else class="flex flex-wrap gap-1">
          <button
            v-for="tgt in outgoing"
            :key="tgt"
            class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
            @click="emit('select-edge', `${roleSlot.roleId}->${tgt}`)"
          >
            {{ tgt }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Agency, RoleSlot } from '../../../../shared/ipc-contract'

const props = defineProps<{
  roleSlot: RoleSlot
  agency: Agency
}>()

const emit = defineEmits<{
  (e: 'update-count', mode: 'fixed' | 'dynamic', opts: { count?: number; min?: number; max?: number }): void
  (e: 'toggle-entry'): void
  (e: 'close'): void
  (e: 'select-edge', edgeId: string): void
}>()

const instanceModes = [
  { value: 'fixed' as const, label: 'Fixed' },
  { value: 'dynamic' as const, label: 'Dynamic' },
]

const mode = ref<'fixed' | 'dynamic'>('fixed')
const fixedCount = ref(1)
const dynMin = ref(1)
const dynMax = ref(2)

function syncFromSlot() {
  const s = props.roleSlot
  if (s.min !== undefined || s.max !== undefined) {
    mode.value = 'dynamic'
    dynMin.value = s.min ?? 1
    dynMax.value = s.max ?? 2
  } else {
    mode.value = 'fixed'
    fixedCount.value = s.count ?? 1
  }
}

watch(() => props.roleSlot.roleId, syncFromSlot, { immediate: true })

const isEntry = computed(() => props.agency.entryPoints.includes(props.roleSlot.roleId))

const isDirty = computed(() => {
  const s = props.roleSlot
  const savedDynamic = s.min !== undefined || s.max !== undefined
  if (mode.value === 'dynamic') {
    if (!savedDynamic) return true
    return dynMin.value !== (s.min ?? 1) || dynMax.value !== (s.max ?? 2)
  }
  if (savedDynamic) return true
  return fixedCount.value !== (s.count ?? 1)
})

const incoming = computed(() =>
  props.agency.flows
    .filter(([, tgt]) => tgt === props.roleSlot.roleId)
    .map(([src]) => src)
)

const outgoing = computed(() =>
  props.agency.flows
    .filter(([src]) => src === props.roleSlot.roleId)
    .map(([, tgt]) => tgt)
)

function applyCount() {
  if (mode.value === 'fixed') {
    emit('update-count', 'fixed', { count: Math.max(1, fixedCount.value) })
  } else {
    const min = Math.max(1, dynMin.value)
    const max = Math.max(min + 1, dynMax.value)
    emit('update-count', 'dynamic', { min, max })
  }
}
</script>
