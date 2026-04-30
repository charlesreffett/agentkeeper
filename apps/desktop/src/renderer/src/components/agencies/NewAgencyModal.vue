<template>
  <!-- Fixed overlay -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div class="w-full max-w-lg bg-card border border-border rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 class="text-sm font-semibold text-foreground">New agency</h2>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          @click="emit('cancel')"
        >
          ×
        </button>
      </div>

      <div class="px-5 py-4 space-y-4">
        <!-- ID + Scope -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">ID (kebab-case)</label>
            <input
              v-model="form.id"
              type="text"
              placeholder="delivery-team"
              class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground font-mono focus:outline-none focus:border-foreground/40"
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">Scope</label>
            <select
              v-model="form.scope"
              class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </div>
        </div>

        <!-- Name -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="Delivery Team"
            class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
          />
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground">Description</label>
          <input
            v-model="form.description"
            type="text"
            placeholder="PM plans, Dev implements, QA reviews"
            class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
          />
        </div>

        <!-- Roles -->
        <div class="space-y-2">
          <label class="text-xs font-medium text-muted-foreground">Roles</label>
          <div v-if="allRoles.length === 0" class="text-xs text-muted-foreground">
            No roles available. Create roles first.
          </div>
          <div v-else class="space-y-1.5 max-h-48 overflow-y-auto">
            <label
              v-for="r in allRoles"
              :key="r.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded border border-border cursor-pointer hover:bg-muted transition-colors"
            >
              <input
                type="checkbox"
                :checked="selectedRoleIds.includes(r.id)"
                class="w-3.5 h-3.5 shrink-0"
                @change="toggleRole(r.id)"
              />
              <span class="text-xs font-mono text-foreground">{{ r.id }}</span>
              <span class="text-xs text-muted-foreground">{{ r.name }}</span>
            </label>
          </div>
        </div>

        <!-- Entry points -->
        <div v-if="selectedRoleIds.length > 0" class="space-y-2">
          <label class="text-xs font-medium text-muted-foreground">Entry points</label>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="rid in selectedRoleIds"
              :key="rid"
              class="flex items-center gap-1.5 px-2 py-1 rounded border border-border cursor-pointer hover:bg-muted text-xs"
            >
              <input
                type="checkbox"
                :checked="form.entryPoints.includes(rid)"
                class="w-3.5 h-3.5"
                @change="toggleEntry(rid)"
              />
              <span class="font-mono text-foreground">{{ rid }}</span>
            </label>
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="text-xs text-red-400 rounded bg-red-500/10 px-3 py-2">
          {{ error }}
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
        <Button variant="secondary" size="sm" @click="emit('cancel')">
          Cancel
        </Button>
        <Button size="sm" @click="handleSave">
          Create
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button } from '@/components/ui/button'
import type { Role, AgencyDraft, AgencyScope } from '../../../../shared/ipc-contract'

const props = defineProps<{
  allRoles: Role[]
  projectPath: string
}>()

const emit = defineEmits<{
  (e: 'save', draft: AgencyDraft, scope: AgencyScope): void
  (e: 'cancel'): void
}>()

const error = ref<string | null>(null)

const form = ref<{
  id: string
  name: string
  description: string
  scope: AgencyScope
  roles: string[]
  entryPoints: string[]
  notes: string
}>({
  id: '',
  name: '',
  description: '',
  scope: 'project',
  roles: [],
  entryPoints: [],
  notes: '',
})

const selectedRoleIds = computed(() => form.value.roles)

function validId(s: string) {
  return /^[a-z0-9][a-z0-9-]*$/.test(s)
}

function toggleRole(roleId: string) {
  const idx = form.value.roles.indexOf(roleId)
  if (idx === -1) {
    form.value.roles.push(roleId)
  } else {
    form.value.roles.splice(idx, 1)
    form.value.entryPoints = form.value.entryPoints.filter(id => id !== roleId)
  }
}

function toggleEntry(roleId: string) {
  const idx = form.value.entryPoints.indexOf(roleId)
  if (idx === -1) form.value.entryPoints.push(roleId)
  else form.value.entryPoints.splice(idx, 1)
}

function handleSave() {
  error.value = null

  if (!form.value.id.trim() || !validId(form.value.id.trim())) {
    error.value = 'ID must be lowercase letters, digits, or dashes (e.g. delivery-team).'
    return
  }
  if (!form.value.name.trim()) {
    error.value = 'Name is required.'
    return
  }
  if (form.value.roles.length === 0) {
    error.value = 'Pick at least one role.'
    return
  }
  if (form.value.entryPoints.length === 0) {
    error.value = 'Mark at least one role as an entry point.'
    return
  }

  const draft: AgencyDraft = {
    id: form.value.id.trim(),
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    roles: form.value.roles.map(roleId => ({ roleId })),
    flows: [],
    entryPoints: [...form.value.entryPoints],
    notes: form.value.notes.trim(),
  }

  emit('save', draft, form.value.scope)
}
</script>
