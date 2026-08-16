<template>
  <div class="w-[380px] h-full border-r border-border bg-card flex flex-col shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-foreground">Roles</span>
        <span class="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{{ roles.length }}</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors"
          @click="showCreate = !showCreate"
        >
          <Plus class="w-3 h-3" />
          New role
        </button>
      </div>
    </div>

    <!-- New role form -->
    <div v-if="showCreate" class="border-b border-border bg-muted/30 px-4 py-4 shrink-0 space-y-4">
      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">NAME</label>
        <div class="flex items-center gap-2">
          <input
            v-model="form.name"
            type="text"
            placeholder="e.g. Perf Profiler"
            class="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
            @input="syncId"
          />
          <span class="text-xs text-muted-foreground font-mono shrink-0">{{ form.id || 'new-role' }}</span>
        </div>
      </div>

      <div class="space-y-1.5">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">ICON</label>
        <div class="grid grid-cols-5 gap-1">
          <button
            v-for="ic in ICONS"
            :key="ic.name"
            class="flex items-center justify-center w-9 h-9 rounded-md border transition-colors"
            :class="form.icon === ic.name
              ? 'border-foreground/40 bg-secondary text-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30'"
            :title="ic.label"
            @click="form.icon = ic.name"
          >
            <component :is="ic.component" class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div class="space-y-1.5">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">ACCENT</label>
        <div class="flex items-center gap-2">
          <button
            v-for="ac in ACCENTS"
            :key="ac.name"
            class="w-7 h-7 rounded-full border-2 transition-all"
            :style="{ backgroundColor: ac.hex }"
            :class="form.accent === ac.name ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'"
            @click="form.accent = ac.name"
          />
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">DEFAULT MODEL</label>
        <div class="flex rounded border border-border overflow-hidden text-xs">
          <button
            v-for="m in MODELS"
            :key="m.value"
            class="flex-1 px-2 py-1.5 transition-colors"
            :class="form.model === m.value
              ? 'bg-secondary text-foreground font-medium'
              : 'bg-background text-muted-foreground hover:bg-muted'"
            @click="form.model = m.value"
          >{{ m.shortLabel }}</button>
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">TAGLINE</label>
        <input
          v-model="form.description"
          type="text"
          placeholder="One line on what it does"
          class="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
        />
      </div>

      <div v-if="createError" class="text-xs text-red-400">{{ createError }}</div>

      <div class="flex items-center gap-2">
        <button
          class="flex-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          @click="cancelCreate"
        >Cancel</button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="creating || !form.name.trim()"
          @click="createAndAdd"
        >
          <Plus class="w-3 h-3" />
          Create &amp; add
        </button>
      </div>
    </div>

    <!-- Search -->
    <div class="px-4 py-2.5 border-b border-border shrink-0">
      <input
        v-model="search"
        type="text"
        placeholder="Search roles..."
        class="w-full rounded border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-foreground/40"
      />
    </div>

    <!-- Roles list -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="filteredRoles.length === 0" class="flex items-center justify-center h-24 text-xs text-muted-foreground">
        No roles found
      </div>
      <button
        v-for="role in filteredRoles"
        :key="role.id"
        class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left border-b border-border/50"
        @click="toggleRole(role.id)"
      >
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          :style="{ backgroundColor: accentBg(role.accent), color: accentColor(role.accent) }"
        >
          <component :is="iconComponent(role.icon)" class="w-4 h-4" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-foreground truncate">{{ role.name }}</div>
          <div class="text-[10px] font-mono text-muted-foreground">{{ role.id }}</div>
        </div>
        <div class="shrink-0">
          <Check v-if="inAgency(role.id)" class="w-4 h-4 text-green-500" />
          <Plus v-else class="w-4 h-4 text-muted-foreground" />
        </div>
      </button>
    </div>

    <!-- Footer hint -->
    <div class="px-4 py-2.5 border-t border-border shrink-0 text-[11px] text-muted-foreground">
      Click a role to drop it on the canvas.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, markRaw } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import {
  Plus, Check,
  Layers, Code2, GitBranch, FlaskConical, Eye,
  FileText, Activity, Shield, Zap, Brain,
} from 'lucide-vue-next'
import type { Agency, Role } from '../../../../shared/ipc-contract'
import { queryKeys } from '@/lib/queryKeys'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { ACCENT_HEX, ACCENT_NAMES, accentColor, accentBg } from '../graph/colors'

const props = defineProps<{
  roles: Role[]
  agency: Agency
  projectPath: string
}>()

const emit = defineEmits<{
  (e: 'add-role', roleId: string): void
  (e: 'close'): void
}>()

const queryClient = useQueryClient()

// ─── Icon & accent config ────────────────────────────────────────────────────

const ICONS = [
  { name: 'Layers',       label: 'Architect',   component: markRaw(Layers) },
  { name: 'Code2',        label: 'Developer',   component: markRaw(Code2) },
  { name: 'GitBranch',    label: 'DevOps',      component: markRaw(GitBranch) },
  { name: 'FlaskConical', label: 'QA/Tester',   component: markRaw(FlaskConical) },
  { name: 'Eye',          label: 'Reviewer',    component: markRaw(Eye) },
  { name: 'FileText',     label: 'Writer',      component: markRaw(FileText) },
  { name: 'Activity',     label: 'Analyst',     component: markRaw(Activity) },
  { name: 'Shield',       label: 'Security',    component: markRaw(Shield) },
  { name: 'Zap',          label: 'Automation',  component: markRaw(Zap) },
  { name: 'Brain',        label: 'Planner/AI',  component: markRaw(Brain) },
]

const ACCENTS = ACCENT_NAMES.map(name => ({ name, hex: ACCENT_HEX[name]! }))

const ICON_MAP: Record<string, ReturnType<typeof markRaw>> = Object.fromEntries(
  ICONS.map(i => [i.name, i.component])
)

const { models: MODELS } = useModelsQuery()

function iconComponent(icon: string | undefined) {
  return ICON_MAP[icon ?? 'Layers'] ?? Layers
}

// ─── State ───────────────────────────────────────────────────────────────────

const search = ref('')
const showCreate = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)

const form = ref({
  name: '',
  id: '',
  icon: 'Layers',
  accent: 'blue',
  model: 'default' as string,
  description: '',
})

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function syncId() {
  form.value.id = slugify(form.value.name)
}

function cancelCreate() {
  showCreate.value = false
  form.value = { name: '', id: '', icon: 'Layers', accent: 'blue', model: 'default', description: '' }
  createError.value = null
}

async function createAndAdd() {
  const name = form.value.name.trim()
  if (!name) return
  const id = form.value.id || slugify(name) || 'new-role'
  creating.value = true
  createError.value = null
  try {
    await window.agentkeeper.roles.save('project', props.projectPath, {
      id,
      name,
      description: form.value.description.trim(),
      harnessId: null,
      model: form.value.model || null,
      effort: null,
      systemPrompt: '',
      icon: form.value.icon,
      accent: form.value.accent,
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.roles.list(props.projectPath) })
    emit('add-role', id)
    cancelCreate()
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

// ─── Roles list ──────────────────────────────────────────────────────────────

const filteredRoles = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return props.roles
  return props.roles.filter(r =>
    r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
  )
})

function inAgency(roleId: string) {
  return props.agency.roles.some(r => r.roleId === roleId)
}

function toggleRole(roleId: string) {
  if (!inAgency(roleId)) {
    emit('add-role', roleId)
  }
}
</script>
