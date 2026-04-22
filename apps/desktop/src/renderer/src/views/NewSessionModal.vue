<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  projectPath: string
  defaultModel: string
}>()

const emit = defineEmits<{
  close: []
  start: [
    params: {
      initialPrompt: string
      model: string
      useWorktree: boolean
      branch: string
    },
  ]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const prompt = ref('')
const model = ref(props.defaultModel)
const textarea = ref<HTMLTextAreaElement | null>(null)

const useWorktree = ref(true)
const branch = ref('')
const branchTouched = ref(false)

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

// Auto-suggest a branch from the prompt's first words.
const suggestedBranch = computed(() => {
  const raw = prompt.value.trim().split(/\s+/).slice(0, 6).join(' ')
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9./-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 60)
})

watch(suggestedBranch, (v) => {
  if (!branchTouched.value) branch.value = v
})

function onBranchInput(event: Event) {
  branchTouched.value = true
  branch.value = (event.target as HTMLInputElement).value
}

const canStart = computed(() => {
  if (!prompt.value.trim()) return false
  if (useWorktree.value && !branch.value.trim()) return false
  return true
})

function start() {
  if (!canStart.value) return
  emit('start', {
    initialPrompt: prompt.value.trim(),
    model: model.value,
    useWorktree: useWorktree.value,
    branch: branch.value.trim(),
  })
}

function onKeyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    start()
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      branch.value = ''
      branchTouched.value = false
      model.value = props.defaultModel
      useWorktree.value = true
      await nextTick()
      dialog.value?.showModal()
      textarea.value?.focus()
    } else {
      dialog.value?.close()
    }
  },
)

onMounted(() => {
  if (props.open) {
    void nextTick(() => {
      dialog.value?.showModal()
      textarea.value?.focus()
    })
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-2xl w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="p-6 space-y-4">
      <header class="space-y-1">
        <h2 class="text-lg font-semibold">New session</h2>
        <p class="text-xs text-muted-foreground font-mono truncate">
          {{ projectPath }}
        </p>
      </header>

      <div class="space-y-2">
        <label class="text-sm font-medium">Initial prompt</label>
        <textarea
          ref="textarea"
          v-model="prompt"
          rows="8"
          placeholder="What do you want to work on?"
          class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-ring font-sans resize-none"
          @keydown="onKeyDown"
        />
      </div>

      <div class="space-y-3 rounded-md border border-border bg-muted/20 p-3">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            v-model="useWorktree"
            type="checkbox"
            class="size-4 rounded border-input"
          />
          <span class="text-sm font-medium">
            Create a git worktree for this session
          </span>
        </label>
        <p class="text-xs text-muted-foreground leading-relaxed pl-6">
          Isolates this session to its own branch so parallel sessions don't
          step on each other. Leave off to run in the project root directly.
        </p>
        <div v-if="useWorktree" class="space-y-1.5 pl-6">
          <label class="text-xs text-muted-foreground">Branch name</label>
          <input
            :value="branch"
            type="text"
            placeholder="e.g. add-login-page"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
            @input="onBranchInput"
          />
          <p v-if="!branchTouched && branch" class="text-[11px] text-muted-foreground">
            Auto-suggested from prompt — edit to customize.
          </p>
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">Model</label>
        <select
          v-model="model"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        >
          <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
      </div>

      <footer class="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
        <Button size="sm" :disabled="!canStart" @click="start">
          Start session
        </Button>
      </footer>
    </div>
  </dialog>
</template>
