<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  projectPath: string
  defaultModel: string
}>()

const emit = defineEmits<{
  close: []
  start: [params: { initialPrompt: string; model: string }]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const prompt = ref('')
const model = ref(props.defaultModel)
const textarea = ref<HTMLTextAreaElement | null>(null)

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

function start() {
  if (!prompt.value.trim()) return
  emit('start', { initialPrompt: prompt.value.trim(), model: model.value })
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
      model.value = props.defaultModel
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
        <Button size="sm" :disabled="!prompt.trim()" @click="start">
          Start session
        </Button>
      </footer>
    </div>
  </dialog>
</template>
