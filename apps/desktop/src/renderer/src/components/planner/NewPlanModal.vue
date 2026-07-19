<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionStore } from '@/stores/sessions'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const { focusedProject } = useProjectsQuery()
const sessionStore = useSessionStore()

const dialog = ref<HTMLDialogElement | null>(null)
const title = ref('')
const externalRef = ref('')
const description = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      title.value = ''
      externalRef.value = ''
      description.value = ''
      submitting.value = false
      submitError.value = null
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

async function submit() {
  if (!title.value.trim() || !focusedProject.value) return
  submitting.value = true
  submitError.value = null
  try {
    const ref = externalRef.value.trim() || `TASK-${Date.now().toString(36).toUpperCase().slice(-5)}`
    const planTitle = `${ref}: ${title.value.trim()}`

    const plan = await window.agentkeeper.plans.create(focusedProject.value.path, {
      title: planTitle,
      externalRef: ref,
      workItemId: '',
      status: 'drafting',
      estimatedMinutes: 0,
      steps: [],
      prompt: description.value.trim() || undefined,
    })

    const desc = description.value.trim()
    const prompt = `Analyze this task and create a detailed implementation plan.
Task: ${ref} — ${title.value.trim()}${desc ? `\nDescription: ${desc}` : ''}

A draft plan has been created with id "${plan.id}".
Update it by calling the update_plan MCP tool with id "${plan.id}" and the full plan.

The plan must have this structure:
{
  "status": "planned",
  "estimatedMinutes": <sum of all step estimatedMinutes>,
  "steps": [
    {
      "title": "concise actionable step title",
      "summary": "one-line description of what this step does",
      "instructions": "detailed instructions for the agent executing this step",
      "filesInScope": ["path/to/relevant/file.ts"],
      "model": "default",
      "estimatedMinutes": 10,
      "agent": "main",
      "parallel": false,
      "status": "pending"
    }
  ]
}

Guidelines:
- model: haiku for reads/audits, sonnet for implementation, opus for architecture
- agent: explorer | main | qa | doc
- parallel: true if the step can safely run concurrently with its neighbours
- Aim for 4–8 focused, concrete steps — no filler
- Keep externalRef "${ref}", title "${planTitle}", workItemId ""`

    await sessionStore.start({
      projectPath: focusedProject.value.path,
      initialPrompt: prompt,
    })

    emit('close')
    void router.push(`/planner/${plan.id}`)
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-popover text-foreground border border-popover-border backdrop:bg-black/25 backdrop:backdrop-blur-md max-w-lg w-full shadow-dialog"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col">
      <header class="flex items-start justify-between px-4 py-3 border-b border-border gap-3">
        <div>
          <span class="font-semibold text-sm">Plan with Claude</span>
          <p class="text-xs text-muted-foreground mt-0.5">
            Describe what you want to build — Claude will draft a step-by-step plan.
          </p>
        </div>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none shrink-0 mt-0.5"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <form class="p-4 space-y-4" @submit.prevent="void submit()">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-foreground" for="plan-title">
            What do you want to build? <span class="text-destructive">*</span>
          </label>
          <input
            id="plan-title"
            v-model="title"
            type="text"
            placeholder="e.g. Add OAuth login with Google"
            required
            autofocus
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium text-foreground" for="plan-ref">
            Reference
            <span class="text-xs text-muted-foreground font-normal ml-1">(optional — auto-generated if blank)</span>
          </label>
          <input
            id="plan-ref"
            v-model="externalRef"
            type="text"
            placeholder="e.g. AUTH-42"
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium text-foreground" for="plan-desc">
            Description / context
            <span class="text-xs text-muted-foreground font-normal ml-1">(optional)</span>
          </label>
          <textarea
            id="plan-desc"
            v-model="description"
            rows="4"
            placeholder="Any additional context, requirements, or constraints Claude should know about…"
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        <div v-if="submitError" class="text-xs text-destructive">{{ submitError }}</div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
          <Button type="submit" size="sm" :disabled="submitting || !title.trim()">
            {{ submitting ? 'Creating…' : 'Plan with Claude' }}
          </Button>
        </div>
      </form>
    </div>
  </dialog>
</template>
