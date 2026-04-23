<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { Skill } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean; projectPath: string }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)

const skills = ref<Skill[]>([])
const loading = ref(false)
const expanded = ref<string | null>(null)
const message = ref<string | null>(null)

const installSource = ref('')
const installScope = ref<'project' | 'global'>('project')
const installing = ref(false)

async function refresh() {
  loading.value = true
  message.value = null
  try {
    skills.value = await window.orchestral.skills.list(props.projectPath)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    skills.value = []
  } finally {
    loading.value = false
  }
}

async function install() {
  const source = installSource.value.trim()
  if (!source) {
    message.value = 'Source is required.'
    return
  }
  installing.value = true
  message.value = null
  try {
    await window.orchestral.skills.install(props.projectPath, source, installScope.value)
    installSource.value = ''
    await refresh()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

async function remove(skill: Skill) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Remove skill "${skill.name}" (${skill.scope})?`)) return
  try {
    await window.orchestral.skills.remove(skill)
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
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      expanded.value = null
      installSource.value = ''
      await refresh()
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-3xl w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col max-h-[85vh]">
      <header
        class="px-6 py-3 border-b border-border flex items-center justify-between shrink-0"
      >
        <h2 class="text-lg font-semibold">Skills</h2>
        <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
      </header>

      <div class="flex-1 overflow-y-auto min-h-0">
        <!-- Install form -->
        <div class="px-6 py-4 border-b border-border space-y-3">
          <p class="text-xs font-medium">Install skill</p>
          <div class="flex gap-2">
            <input
              v-model="installSource"
              type="text"
              placeholder="GitHub URL or local path"
              class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              :disabled="installing"
              @keydown.enter="install"
            />
            <select
              v-model="installScope"
              class="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
              :disabled="installing"
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
            <Button size="sm" :disabled="installing" @click="install">
              {{ installing ? 'Installing…' : 'Install' }}
            </Button>
          </div>
          <div
            v-if="message"
            class="text-xs rounded-md bg-muted/40 px-3 py-2 text-destructive"
          >
            {{ message }}
          </div>
        </div>

        <!-- Skills list -->
        <div v-if="loading" class="p-6 text-sm text-muted-foreground">Loading…</div>
        <div
          v-else-if="skills.length === 0"
          class="p-6 text-sm text-muted-foreground leading-relaxed"
        >
          No skills installed. Install one using a GitHub URL or local path.
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
  </dialog>
</template>
