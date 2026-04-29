<template>
  <div class="p-4 flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-foreground">Agency</h2>
    </div>

    <!-- Metadata (read-only) -->
    <div class="space-y-3">
      <div>
        <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">ID</div>
        <div class="text-xs text-muted-foreground font-mono">{{ agency.id }}</div>
      </div>
      <div>
        <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Scope</div>
        <span class="text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono">{{ agency.scope }}</span>
      </div>
      <div>
        <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Entry points</div>
        <div class="flex flex-wrap gap-1 mt-1">
          <span
            v-for="ep in agency.entryPoints"
            :key="ep"
            class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30"
          >
            {{ ep }}
          </span>
        </div>
      </div>
      <div>
        <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Flows</div>
        <div class="text-xs text-muted-foreground">
          {{ agency.flows.length === 0 ? 'Any-to-any' : `${agency.flows.length} explicit flow${agency.flows.length === 1 ? '' : 's'}` }}
        </div>
      </div>
    </div>

    <!-- Editable fields -->
    <div class="space-y-3 border-t border-border pt-3">
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground">Name</label>
        <input
          v-model="form.name"
          type="text"
          class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
        />
        <div v-if="nameError" class="text-xs text-red-400">{{ nameError }}</div>
      </div>
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground">Description</label>
        <input
          v-model="form.description"
          type="text"
          class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
        />
      </div>
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground">Notes</label>
        <textarea
          v-model="form.notes"
          rows="3"
          class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-foreground/40 resize-none leading-relaxed"
        />
      </div>

      <div class="flex items-center gap-2 pt-1">
        <Button
          v-if="isDirty"
          variant="ghost"
          size="sm"
          @click="discard"
        >
          Discard
        </Button>
        <Button
          class="flex-1"
          size="sm"
          :disabled="!isDirty"
          @click="save"
        >
          Save changes
        </Button>
      </div>
    </div>

    <!-- Delete section -->
    <div class="mt-auto pt-4 border-t border-border">
      <template v-if="!confirmDelete">
        <button
          class="w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded px-3 py-1.5 transition-colors text-left"
          @click="confirmDelete = true"
        >
          Delete agency…
        </button>
      </template>
      <template v-else>
        <div class="text-xs text-muted-foreground mb-2">Delete "{{ agency.name }}"? This cannot be undone.</div>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" class="flex-1" @click="confirmDelete = false">
            Cancel
          </Button>
          <Button variant="destructive" size="sm" class="flex-1" @click="doDelete">
            Delete
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { Agency } from '../../../../shared/ipc-contract'

const props = defineProps<{
  agency: Agency
}>()

const emit = defineEmits<{
  (e: 'delete'): void
  (e: 'update', draft: Agency): void
}>()

const confirmDelete = ref(false)
const nameError = ref<string | null>(null)

const form = ref({
  name: props.agency.name,
  description: props.agency.description,
  notes: props.agency.notes,
})

const isDirty = computed(() =>
  form.value.name.trim() !== props.agency.name ||
  form.value.description.trim() !== props.agency.description ||
  form.value.notes.trim() !== props.agency.notes
)

function resetForm() {
  form.value = {
    name: props.agency.name,
    description: props.agency.description,
    notes: props.agency.notes,
  }
  nameError.value = null
}

watch(() => props.agency.id, () => {
  confirmDelete.value = false
  resetForm()
})

watch(
  () => props.agency,
  (newAgency, oldAgency) => {
    const formMatchesOld =
      form.value.name.trim() === oldAgency.name &&
      form.value.description.trim() === oldAgency.description &&
      form.value.notes.trim() === oldAgency.notes
    if (formMatchesOld) {
      form.value = { name: newAgency.name, description: newAgency.description, notes: newAgency.notes }
      nameError.value = null
    }
  },
)

function discard() {
  resetForm()
}

function save() {
  if (!form.value.name.trim()) {
    nameError.value = 'Name is required.'
    return
  }
  nameError.value = null
  const draft: Agency = {
    ...props.agency,
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    notes: form.value.notes.trim(),
  }
  emit('update', draft)
}

function doDelete() {
  confirmDelete.value = false
  emit('delete')
}
</script>
