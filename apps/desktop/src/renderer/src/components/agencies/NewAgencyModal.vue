<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-md p-4">
    <div class="w-full max-w-2xl h-[600px] max-h-[90vh] bg-card border border-border rounded-lg shadow-xl flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <h2 class="text-sm font-semibold text-foreground">New agency</h2>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          @click="emit('cancel')"
        >
          ×
        </button>
      </div>

      <!-- Identity -->
      <div class="px-5 py-3 space-y-3 border-b border-border shrink-0">
        <div class="flex flex-col gap-1">
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="Delivery Team"
            class="rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
            @input="onNameInput"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              ID
              <span v-if="!idTouched && form.id" class="ml-1 normal-case tracking-normal text-muted-foreground/70">· auto from name</span>
            </label>
            <input
              v-model="form.id"
              type="text"
              placeholder="delivery-team"
              class="rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground font-mono focus:outline-none focus:border-foreground/40"
              @input="idTouched = true"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Scope</label>
            <select
              v-model="form.scope"
              class="rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Description</label>
          <input
            v-model="form.description"
            type="text"
            placeholder="PM plans, Dev implements, QA reviews"
            class="rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
          />
        </div>
      </div>

      <!-- Roles -->
      <div v-if="allRoles.length === 0" class="flex-1 flex items-center justify-center text-xs text-muted-foreground p-8 min-h-0">
        No roles available. Create roles first.
      </div>
      <div v-else class="flex-1 min-h-0 overflow-hidden">
        <NewAgencyTransfer :all-roles="allRoles" v-model="composition" />
      </div>

      <!-- Status -->
      <div class="px-5 py-2 border-t border-border shrink-0 text-[11px]">
        <span v-if="error" class="text-red-400">{{ error }}</span>
        <span v-else-if="missingHint" class="text-amber-400">{{ missingHint }}</span>
        <span v-else class="text-muted-foreground">Ready to create.</span>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
        <Button variant="secondary" size="sm" @click="emit('cancel')">Cancel</Button>
        <Button size="sm" :disabled="!canSave" @click="handleSave">Create</Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import NewAgencyTransfer from './NewAgencyTransfer.vue'
import { emptyComposition } from './composition'
import type { AgencyComposition } from './composition'
import type { Role, AgencyDraft, AgencyScope } from '../../../../shared/ipc-contract'

defineProps<{
  allRoles: Role[]
  projectPath: string
}>()

const emit = defineEmits<{
  (e: 'save', draft: AgencyDraft, scope: AgencyScope): void
  (e: 'cancel'): void
}>()

const error = ref<string | null>(null)
const idTouched = ref(false)

const form = ref<{
  id: string
  name: string
  description: string
  scope: AgencyScope
  notes: string
}>({
  id: '',
  name: '',
  description: '',
  scope: 'project',
  notes: '',
})

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function onNameInput() {
  if (idTouched.value) return
  form.value.id = slugify(form.value.name)
}

const composition = ref<AgencyComposition>(emptyComposition())

function validId(s: string) {
  return /^[a-z0-9][a-z0-9-]*$/.test(s)
}

const missingHint = computed<string | null>(() => {
  if (!form.value.id.trim()) return 'Set an ID.'
  if (!validId(form.value.id.trim())) return 'ID must be lowercase letters, digits, or dashes.'
  if (!form.value.name.trim()) return 'Set a name.'
  if (composition.value.roles.length === 0) return 'Add at least one role.'
  if (composition.value.entryPoints.length === 0) return 'Mark at least one role as an entry point ★.'
  return null
})

const canSave = computed(() => missingHint.value === null)

function handleSave() {
  error.value = null
  if (!canSave.value) {
    error.value = missingHint.value
    return
  }

  const placedIds = new Set(composition.value.roles.map(s => s.roleId))
  const cleanFlows = composition.value.flows.filter(
    ([a, b]) => placedIds.has(a) && placedIds.has(b),
  )
  const cleanEntries = composition.value.entryPoints.filter(id => placedIds.has(id))

  const draft: AgencyDraft = {
    id: form.value.id.trim(),
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    roles: composition.value.roles.map(slot => ({ ...slot })),
    flows: cleanFlows.map(([a, b]) => [a, b] as [string, string]),
    entryPoints: [...cleanEntries],
    notes: form.value.notes.trim(),
  }

  emit('save', draft, form.value.scope)
}
</script>
