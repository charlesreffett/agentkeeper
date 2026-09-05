<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Button } from '@/components/ui/button'
import type { Skill, SkillPreview } from '@shared/ipc-contract'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePageScope, SCOPE_ALL } from '@/composables/usePageScope'
import { useSkillsDataStore } from '@/stores/skillsData'
import { useHarnessAuthGuard } from '@/composables/useHarnessAuthGuard'
import ScopeBar from '@/components/ScopeBar.vue'
import { Download, Sparkles } from '@/components/icons/app-icons'

const { scope, options, label, color, setScope, pickAndAdd, isAll, isGlobal, isProject, currentProject } =
  usePageScope('skills', { includeGlobal: true })
const { projects } = useProjectsQuery()
const queryClient = useQueryClient()
const skillsDataStore = useSkillsDataStore()
// Scoped load input: project → its path (project + global); Global/All → ''
// (global-only for the store; the union query below serves All).
const projectPath = computed(() =>
  isAll.value || isGlobal.value ? '' : isProject.value ? currentProject.value?.path ?? '' : '',
)
const { handleAuthError } = useHarnessAuthGuard()

// All scope = union of global + every project's skills, deduped by file path.
const { data: allSkills, isLoading: allLoading } = useQuery({
  queryKey: computed(() => ['skills', 'list', SCOPE_ALL, projects.value.map((p) => p.path).sort().join('|')]),
  enabled: isAll,
  queryFn: async () => {
    const paths = ['', ...projects.value.map((p) => p.path)]
    const lists = await Promise.all(paths.map((p) => window.agentkeeper.skills.list(p)))
    const byPath = new Map<string, Skill>()
    for (const list of lists) for (const s of list) byPath.set(s.path, s)
    return Array.from(byPath.values())
  },
})

const skills = computed<Skill[]>(() => (isAll.value ? allSkills.value ?? [] : skillsDataStore.skills))
const loading = computed(() => (isAll.value ? allLoading.value : skillsDataStore.loading))
const message = ref<string | null>(null)

// Skills rail → detail in the main content area.
const view = ref<'skill' | 'install' | 'create'>('skill')
const selectedId = ref<string | null>(null)
const selectedSkill = computed(() =>
  selectedId.value ? skills.value.find((s) => `${s.scope}:${s.path}` === selectedId.value) ?? null : null,
)

function selectSkill(skill: Skill) {
  selectedId.value = `${skill.scope}:${skill.path}`
  view.value = 'skill'
}

function beginInstall() {
  view.value = 'install'
}

function beginCreate() {
  view.value = 'create'
}

// ── Install tab ──────────────────────────────────────────────────────────────

type Step = 'source' | 'select'
const step = ref<Step>('source')
const installSource = ref('')
const previewing = ref(false)
const previews = ref<SkillPreview[]>([])
const selectedIds = ref<string[]>([])
const installing = ref(false)

// ── Create tab ───────────────────────────────────────────────────────────────

const createPrompt = ref('')
const generating = ref(false)
const createId = ref('')
const createName = ref('')
const createDescription = ref('')
const createBody = ref('')
const saving = ref(false)

// Write target derives from the page context: Global/All → global (no project
// to write to), a scoped project → that project.
const writeScope = computed<'project' | 'global'>(() =>
  isGlobal.value || isAll.value ? 'global' : 'project',
)

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

async function generateSkill() {
  const p = createPrompt.value.trim()
  if (!p) {
    message.value = 'Describe the skill first.'
    return
  }
  generating.value = true
  message.value = null
  try {
    const raw = await window.agentkeeper.skills.generate(p)
    const endIdx = raw.indexOf('\n---', 3)
    if (endIdx !== -1) {
      const fm = raw.slice(3, endIdx)
      const nameMatch = fm.match(/^name:\s*(.+)$/m)
      const descMatch = fm.match(/^description:\s*(.+)$/m)
      createName.value = nameMatch ? nameMatch[1]!.trim() : ''
      createDescription.value = descMatch ? descMatch[1]!.trim() : ''
      createBody.value = raw.slice(endIdx + 4).replace(/^\r?\n/, '').trimEnd()
      createId.value = toSlug(createName.value)
    } else {
      createBody.value = raw
    }
  } catch (e) {
    if (!handleAuthError(e)) {
      message.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    generating.value = false
  }
}

async function doSaveSkill() {
  const id = createId.value.trim()
  if (!id) {
    message.value = 'Skill ID is required.'
    return
  }
  if (!createName.value.trim()) {
    message.value = 'Skill name is required.'
    return
  }
  saving.value = true
  message.value = null
  try {
    const content = [
      '---',
      `name: ${createName.value.trim()}`,
      `description: ${createDescription.value.trim()}`,
      '---',
      '',
      createBody.value.trim(),
    ].join('\n')
    await window.agentkeeper.skills.save(projectPath.value, id, writeScope.value, content)
    createPrompt.value = ''
    createId.value = ''
    createName.value = ''
    createDescription.value = ''
    createBody.value = ''
    await refresh()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

// ── Shared ───────────────────────────────────────────────────────────────────

async function refresh() {
  message.value = null
  try {
    if (isAll.value) {
      await queryClient.invalidateQueries({ queryKey: ['skills', 'list', SCOPE_ALL] })
    } else {
      skillsDataStore.invalidate()
      await skillsDataStore.load(projectPath.value)
    }
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

function resetInstallForm() {
  step.value = 'source'
  installSource.value = ''
  previews.value = []
  selectedIds.value = []
  message.value = null
}

async function startPreview() {
  const source = installSource.value.trim()
  if (!source) {
    message.value = 'Source is required.'
    return
  }
  previewing.value = true
  message.value = null
  try {
    const result = await window.agentkeeper.skills.preview(projectPath.value, source)
    previews.value = result
    selectedIds.value = result.map((p) => p.id)
    step.value = 'select'
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    previewing.value = false
  }
}

async function doInstall(skillIds?: string[]) {
  const source = installSource.value.trim()
  installing.value = true
  message.value = null
  const payload = {
    projectPath: projectPath.value,
    source,
    scope: writeScope.value,
    skillIds: skillIds ? [...skillIds] : undefined,
    skillIdsCount: skillIds?.length ?? 0,
  }
  console.log('[skills] install →', payload)
  try {
    await window.agentkeeper.skills.install(
      projectPath.value,
      source,
      writeScope.value,
      skillIds,
    )
    console.log('[skills] install ok', { source, count: payload.skillIdsCount })
    resetInstallForm()
    await refresh()
  } catch (e) {
    console.error('[skills] install failed', { payload, error: e })
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

function installSelected() {
  // Pass a plain copy — selectedIds.value is a Vue reactive Proxy and even
  // though preload's toPlain() should handle it, copying here means the
  // logging above shows exactly what crosses the bridge.
  const ids = selectedIds.value.length > 0 ? [...selectedIds.value] : undefined
  doInstall(ids)
}

function toggleAll() {
  if (selectedIds.value.length === previews.value.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = previews.value.map((p) => p.id)
  }
}

function toggleId(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

async function remove(skill: Skill) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Remove skill "${skill.name}" (${skill.scope})?`)) return
  try {
    await window.agentkeeper.skills.remove(projectPath.value, { ...skill, locations: [...skill.locations], harnessIds: [...skill.harnessIds] })
    await refresh()
    if (selectedId.value === `${skill.scope}:${skill.path}`) selectedId.value = null
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

async function adopt(skill: Skill) {
  message.value = null
  try {
    await window.agentkeeper.skills.adopt(projectPath.value, { ...skill, locations: [...skill.locations], harnessIds: [...skill.harnessIds] })
    await refresh()
    selectedId.value = null
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => scope.value,
  async () => {
    selectedId.value = null
    await refresh()
  },
)

onMounted(async () => {
  selectedId.value = null
  view.value = 'install'
  resetInstallForm()
  await refresh()
})
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <aside class="w-64 shrink-0 border-r border-border flex flex-col bg-card/30">
      <div class="p-3 border-b border-border shrink-0">
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
      </div>
      <div class="p-2 border-b border-border shrink-0 space-y-2">
        <Button class="w-full gap-1.5" @click="beginInstall">
          <Download class="size-3.5" />
          Install skill
        </Button>
        <Button class="w-full gap-1.5" variant="secondary" @click="beginCreate">
          <Sparkles class="size-3.5" />
          Create with AI
        </Button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-4 text-sm text-muted-foreground">Loading…</div>
        <div
          v-else-if="skills.length === 0"
          class="p-4 text-sm text-muted-foreground leading-relaxed"
        >
          No skills installed. AgentKeeper-managed skills live in
          <code class="font-mono text-foreground">.agents/skills/</code>.
        </div>
        <ul v-else>
          <li
            v-for="skill in skills"
            :key="`${skill.scope}:${skill.path}`"
            class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
            :class="selectedId === `${skill.scope}:${skill.path}` ? 'bg-accent' : ''"
            @click="selectSkill(skill)"
          >
            <div class="text-sm font-medium truncate">{{ skill.name }}</div>
            <div class="text-xs text-muted-foreground truncate">
              {{ skill.description || '(no description)' }}
            </div>
            <div class="mt-1 flex items-center gap-2 text-[10px] tabular-nums">
              <span
                class="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono"
              >
                {{ skill.scope }}
              </span>
              <span class="text-muted-foreground font-mono truncate">{{ skill.id }}</span>
              <span v-if="skill.managed" class="text-primary">managed</span>
              <span v-if="skill.conflict" class="text-destructive">conflict</span>
            </div>
          </li>
        </ul>
      </div>
    </aside>

    <main class="flex-1 min-w-0 overflow-y-auto">
      <!-- Selected skill detail -->
      <div v-if="view === 'skill' && selectedSkill" class="p-6 space-y-3">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-lg font-semibold truncate">{{ selectedSkill.name }}</span>
              <span
                class="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono text-[10px] shrink-0"
              >
                {{ selectedSkill.scope }}
              </span>
            </div>
            <p v-if="selectedSkill.description" class="text-sm text-muted-foreground mt-1">
              {{ selectedSkill.description }}
            </p>
            <div class="text-xs text-muted-foreground font-mono mt-1">{{ selectedSkill.id }}</div>
            <div class="text-xs text-muted-foreground mt-2">
              Registered for: {{ selectedSkill.harnessIds.join(', ') || 'canonical store only' }}
            </div>
            <div v-if="selectedSkill.conflict" class="text-xs text-destructive mt-1">
              Another harness-specific skill uses this ID. AgentKeeper has preserved both versions.
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button
              v-if="!selectedSkill.managed"
              variant="secondary"
              size="sm"
              class="text-xs"
              :disabled="selectedSkill.conflict"
              @click="adopt(selectedSkill)"
            >
              Make available everywhere
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-destructive text-xs"
              @click="remove(selectedSkill)"
            >
              Remove
            </Button>
          </div>
        </div>
        <pre
          class="rounded-md border border-border bg-muted/20 p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto"
        >{{ selectedSkill.body }}</pre>
      </div>

      <!-- Install panel -->
      <div v-else-if="view === 'install'" class="p-6 space-y-3">
        <template v-if="step === 'source'">
          <p class="text-xs font-medium">Install skill</p>
          <div class="flex gap-2">
            <input
              v-model="installSource"
              type="text"
              placeholder="e.g. anthropics/skills or owner/repo"
              class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              :disabled="previewing || installing"
              @keydown.enter="startPreview"
            />
            <Button size="sm" :disabled="previewing || installing" @click="startPreview">
              {{ previewing ? 'Previewing…' : 'Preview skills' }}
            </Button>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" @click="step = 'source'">← Back</Button>
            <p class="text-xs font-medium">
              Select skills from
              <span class="font-mono">{{ installSource }}</span>
              <span class="ml-1 text-muted-foreground">({{ writeScope }})</span>
            </p>
          </div>

          <div v-if="previews.length === 0" class="space-y-2">
            <p class="text-sm text-muted-foreground">
              Could not detect skills in this source — install all?
            </p>
            <Button size="sm" :disabled="installing" @click="doInstall()">
              {{ installing ? 'Installing…' : 'Install all' }}
            </Button>
          </div>

          <div v-else class="space-y-2">
            <div class="flex items-center justify-between">
              <button
                class="text-xs text-muted-foreground hover:text-foreground"
                @click="toggleAll"
              >
                {{
                  selectedIds.length === previews.length
                    ? 'Deselect all'
                    : 'Select all'
                }}
              </button>
            </div>
            <ul class="space-y-1.5">
              <li
                v-for="preview in previews"
                :key="preview.id"
                class="flex items-start gap-2 cursor-pointer"
                @click="toggleId(preview.id)"
              >
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(preview.id)"
                  class="mt-0.5 shrink-0"
                  @click.stop="toggleId(preview.id)"
                />
                <div class="min-w-0">
                  <div class="text-sm font-medium font-mono">{{ preview.name }}</div>
                  <div
                    v-if="preview.description"
                    class="text-xs text-muted-foreground"
                  >
                    {{ preview.description }}
                  </div>
                </div>
              </li>
            </ul>
            <Button
              size="sm"
              :disabled="installing || selectedIds.length === 0"
              @click="installSelected"
            >
              {{ installing ? 'Installing…' : `Install selected (${selectedIds.length})` }}
            </Button>
          </div>
        </template>

        <div
          v-if="message"
          class="text-xs rounded-md bg-muted/40 px-3 py-2 text-destructive"
        >
          {{ message }}
        </div>
      </div>

      <!-- Create with AI panel -->
      <div v-else-if="view === 'create'" class="p-6 space-y-3">
        <p class="text-xs font-medium">Generate a skill with AI</p>
        <textarea
          v-model="createPrompt"
          rows="3"
          placeholder="Describe what this skill should do…"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-none"
          :disabled="generating || saving"
        />
        <div class="flex gap-2">
          <Button size="sm" :disabled="generating || saving" @click="generateSkill">
            {{ generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>

        <!-- Review / edit fields shown after generation -->
        <template v-if="createName || createBody">
          <div class="space-y-2 pt-1 border-t border-border">
            <div class="flex gap-2 pt-2">
              <div class="flex-1 space-y-1">
                <label class="text-[10px] text-muted-foreground uppercase tracking-wide">Name</label>
                <input
                  v-model="createName"
                  type="text"
                  :disabled="saving"
                  class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
                />
              </div>
              <div class="space-y-1">
                <label class="text-[10px] text-muted-foreground uppercase tracking-wide">ID (slug)</label>
                <input
                  v-model="createId"
                  type="text"
                  :disabled="saving"
                  class="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring font-mono"
                />
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-[10px] text-muted-foreground uppercase tracking-wide">Description</label>
              <input
                v-model="createDescription"
                type="text"
                :disabled="saving"
                class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
              />
            </div>
            <div class="space-y-1">
              <label class="text-[10px] text-muted-foreground uppercase tracking-wide">Body</label>
              <textarea
                v-model="createBody"
                rows="8"
                :disabled="saving"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-y font-mono"
              />
            </div>
            <div class="flex items-center gap-2 pt-1">
              <Button size="sm" :disabled="saving" @click="doSaveSkill">
                {{ saving ? 'Saving…' : 'Save skill' }}
              </Button>
            </div>
          </div>
        </template>

        <div
          v-if="message"
          class="text-xs rounded-md bg-muted/40 px-3 py-2 text-destructive"
        >
          {{ message }}
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="h-full flex items-center justify-center text-muted-foreground text-sm p-8"
      >
        Select a skill to preview, or install a new one.
      </div>
    </main>
  </div>
</template>
