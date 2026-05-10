<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { Skill, SkillPreview } from '@shared/ipc-contract'
import { useProjectsStore } from '@/stores/projects'
import { useSkillsDataStore } from '@/stores/skillsData'
import { useClaudeAuth } from '@/composables/useClaudeAuth'
import PageHeader from '@/components/PageHeader.vue'

const projectsStore = useProjectsStore()
const skillsDataStore = useSkillsDataStore()
const projectPath = computed(() => projectsStore.focusedProject?.path ?? '')
const { handleAuthError } = useClaudeAuth()

const skills = computed(() => skillsDataStore.skills)
const loading = computed(() => skillsDataStore.loading)
const expanded = ref<string | null>(null)
const message = ref<string | null>(null)

// ── Install tab ──────────────────────────────────────────────────────────────

type Step = 'source' | 'select'
const step = ref<Step>('source')
const installSource = ref('')
const installScope = ref<'project' | 'global'>('project')
const previewing = ref(false)
const previews = ref<SkillPreview[]>([])
const selectedIds = ref<string[]>([])
const installing = ref(false)

// ── Create tab ───────────────────────────────────────────────────────────────

type ModalTab = 'install' | 'create'
const activeTab = ref<ModalTab>('install')

const createPrompt = ref('')
const generating = ref(false)
const createId = ref('')
const createName = ref('')
const createDescription = ref('')
const createBody = ref('')
const createScope = ref<'project' | 'global'>('project')
const saving = ref(false)

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
    await window.agentkeeper.skills.save(projectPath.value, id, createScope.value, content)
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
    skillsDataStore.invalidate()
    await skillsDataStore.load(projectPath.value)
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
    scope: installScope.value,
    skillIds: skillIds ? [...skillIds] : undefined,
    skillIdsCount: skillIds?.length ?? 0,
  }
  console.log('[skills] install →', payload)
  try {
    await window.agentkeeper.skills.install(
      projectPath.value,
      source,
      installScope.value,
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
    await window.agentkeeper.skills.remove({ ...skill })
    await refresh()
    if (expanded.value === `${skill.scope}:${skill.id}`) expanded.value = null
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

function toggleExpand(skill: Skill) {
  const key = `${skill.scope}:${skill.id}`
  expanded.value = expanded.value === key ? null : key
}

watch(
  () => projectsStore.focusedProject?.path,
  async (path) => {
    if (path !== undefined) await skillsDataStore.load(path ?? '')
  },
)

onMounted(async () => {
  expanded.value = null
  activeTab.value = 'install'
  resetInstallForm()
  await skillsDataStore.load(projectPath.value)
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Skills" />

    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Tab bar -->
      <div class="px-6 pt-3 flex gap-1 border-b border-border shrink-0">
        <button
          v-for="tab in (['install', 'create'] as const)"
          :key="tab"
          class="px-3 py-1.5 text-xs rounded-t-md transition-colors"
          :class="activeTab === tab
            ? 'bg-card text-foreground border border-border border-b-card -mb-px z-10'
            : 'text-muted-foreground hover:text-foreground'"
          @click="activeTab = tab; message = null"
        >
          {{ tab === 'install' ? 'Install' : 'Create with AI' }}
        </button>
      </div>

      <!-- Install tab -->
      <div v-if="activeTab === 'install'" class="px-6 py-4 border-b border-border space-y-3">
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
            <select
              v-model="installScope"
              class="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
              :disabled="previewing || installing"
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
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
              <span class="ml-1 text-muted-foreground">({{ installScope }})</span>
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

      <!-- Create with AI tab -->
      <div v-else class="px-6 py-4 border-b border-border space-y-3">
        <p class="text-xs font-medium">Generate a skill with AI</p>
        <textarea
          v-model="createPrompt"
          rows="3"
          placeholder="Describe what this skill should do…"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-none"
          :disabled="generating || saving"
        />
        <div class="flex gap-2">
          <select
            v-model="createScope"
            :disabled="generating || saving"
            class="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          >
            <option value="project">Project</option>
            <option value="global">Global</option>
          </select>
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

      <div v-if="loading" class="p-6 text-sm text-muted-foreground">Loading…</div>
      <div
        v-else-if="skills.length === 0"
        class="p-6 text-sm text-muted-foreground leading-relaxed"
      >
        No skills installed. Install one using a GitHub URL or
        <code class="font-mono text-foreground">owner/repo</code> shorthand.
        They live in
        <code class="font-mono text-foreground">.claude/skills/</code>
        (project) or
        <code class="font-mono text-foreground">~/.claude/skills/</code>
        (global).
      </div>
      <ul v-else class="divide-y divide-border/50">
        <li
          v-for="skill in skills"
          :key="`${skill.scope}:${skill.id}`"
          class="px-6 py-4"
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium truncate">{{ skill.name }}</span>
                <span
                  class="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono text-[10px]"
                >
                  {{ skill.scope }}
                </span>
              </div>
              <div
                v-if="skill.description"
                class="text-xs text-muted-foreground mt-0.5 truncate"
              >
                {{ skill.description }}
              </div>
              <div class="text-[10px] text-muted-foreground font-mono mt-0.5">
                {{ skill.id }}
              </div>
              <div v-if="expanded === `${skill.scope}:${skill.id}`" class="mt-3">
                <pre
                  class="text-xs bg-muted/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed"
                >{{ skill.body }}</pre>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                class="text-xs"
                @click="toggleExpand(skill)"
              >
                {{ expanded === `${skill.scope}:${skill.id}` ? 'Hide' : 'Show' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive text-xs"
                @click="remove(skill)"
              >
                Remove
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
