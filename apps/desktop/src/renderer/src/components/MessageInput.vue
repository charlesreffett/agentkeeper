<script setup lang="ts">
import { ref, nextTick, watch, computed, toRaw } from 'vue'
import { OctagonX, Plus, SquareSlash, SendHorizontal } from 'lucide-vue-next'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useCommandAutocomplete } from '@/composables/useCommandAutocomplete'
import CommandAutocomplete from '@/components/CommandAutocomplete.vue'
import type { Attachment } from '../../../shared/ipc-contract'

const props = defineProps<{
  disabled?: boolean
  isRunning?: boolean
  placeholder?: string
  autofocus?: boolean
  /** When true: Enter sends; modifier+Enter inserts newline. */
  enterToSend?: boolean
  projectPath?: string
  sendModifier?: 'auto' | 'meta' | 'ctrl' | 'alt' | 'shift'
  roleName?: string | null
  agencyName?: string | null
}>()

const emit = defineEmits<{ send: [text: string, attachments: Attachment[]]; stop: [] }>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const attachments = ref<Attachment[]>([])

const { projects, focusedProject } = useProjectsQuery()
const resolvedProjectPath = computed(
  () => props.projectPath ?? focusedProject.value?.path ?? '',
)

const isMac = /Mac/i.test(navigator.platform)

const modKey = computed<'meta' | 'ctrl' | 'alt' | 'shift'>(() => {
  if (props.sendModifier === 'meta') return 'meta'
  if (props.sendModifier === 'ctrl') return 'ctrl'
  if (props.sendModifier === 'alt') return 'alt'
  if (props.sendModifier === 'shift') return 'shift'
  return isMac ? 'meta' : 'ctrl'
})

const modLabel = computed(() => {
  switch (modKey.value) {
    case 'meta':  return isMac ? '⌘' : 'Meta'
    case 'ctrl':  return 'Ctrl'
    case 'alt':   return isMac ? '⌥' : 'Alt'
    case 'shift': return '⇧'
  }
})

const ac = useCommandAutocomplete(text, resolvedProjectPath)

function autosize() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 320) + 'px'
}

async function send() {
  const v = text.value.trim()
  if ((!v && attachments.value.length === 0) || props.disabled) return
  emit('send', v, attachments.value.map(toRaw))
  text.value = ''
  attachments.value = []
  await nextTick()
  autosize()
}

function onKeyDown(event: KeyboardEvent) {
  if (ac.isOpen.value) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      ac.moveUp()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      ac.moveDown()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      ac.close()
      return
    }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      const cmd = ac.selectIndex(ac.selectedIndex.value)
      if (cmd) {
        event.preventDefault()
        text.value = ac.resolveBody(cmd)
        ac.close()
        void send()
        return
      }
      // No item selected — close autocomplete, let normal Enter behavior proceed
      ac.close()
    }
  }
  const mod =
    modKey.value === 'meta'  ? event.metaKey  :
    modKey.value === 'ctrl'  ? event.ctrlKey  :
    modKey.value === 'alt'   ? event.altKey   :
    event.shiftKey
  if (props.enterToSend) {
    if (!mod && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  } else {
    if (mod && event.key === 'Enter') {
      event.preventDefault()
      void send()
    }
  }
}

const sendHint = computed(() =>
  props.enterToSend
    ? `${modLabel.value}+Enter for newline`
    : `${modLabel.value}+Enter to send`,
)

const projectName = computed(() => {
  const path = resolvedProjectPath.value
  const match = projects.value.find((p) => p.path === path)
  return match?.name ?? path.split('/').filter(Boolean).pop() ?? ''
})

const defaultPlaceholder = computed(() => {
  const parts: string[] = ['Message']
  if (projectName.value) parts.push(projectName.value)
  if (props.agencyName) parts.push(props.agencyName)
  if (props.roleName) parts.push(props.roleName)
  return parts.join(' · ')
})

watch(text, () => {
  void nextTick(autosize)
})

watch(
  () => props.autofocus,
  (val) => {
    if (val) {
      void nextTick(() => textarea.value?.focus())
    }
  },
  { immediate: true },
)

async function openFilePicker() {
  const picked = await window.agentkeeper.dialog.openFiles()
  attachments.value.push(...picked)
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  const imageItems: DataTransferItem[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item && item.kind === 'file' && item.type.startsWith('image/')) {
      imageItems.push(item)
    }
  }
  if (imageItems.length === 0) return
  event.preventDefault()
  const promises = imageItems.map((item) => new Promise<void>((resolve) => {
    const file = item.getAsFile()
    if (!file) { resolve(); return }
    const mimeType = file.type || 'image/png'
    const ext = mimeType.split('/')[1] ?? 'png'
    const name = `pasted-image-${Date.now()}.${ext}`
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (base64) {
        attachments.value.push({ name, mimeType, content: base64 })
      }
      resolve()
    }
    reader.onerror = () => resolve()
    reader.readAsDataURL(file)
  }))
  await Promise.all(promises)
}

defineExpose({
  getText: () => text.value,
  setText: (v: string) => { text.value = v },
})
</script>

<template>
  <div class="border-t border-border bg-card/50">
    <div class="max-w-4xl mx-auto p-4">
      <div class="relative">
        <CommandAutocomplete
          v-if="ac.isOpen.value"
          :suggestions="ac.suggestions.value"
          :selected-index="ac.selectedIndex.value"
          @select="(cmd) => { text = ac.resolveBody(cmd); ac.close(); void send() }"
          @close="ac.close()"
        />
        <div
          class="rounded-lg border border-border bg-background focus-within:border-ring transition"
        >
          <div v-if="attachments.length > 0" class="flex flex-wrap gap-1 px-3 pt-2">
            <span
              v-for="(a, i) in attachments"
              :key="i"
              class="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            >
              {{ a.name }}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                @click="removeAttachment(i)"
              >×</button>
            </span>
          </div>
          <textarea
            ref="textarea"
            v-model="text"
            :placeholder="placeholder ?? defaultPlaceholder"
            :disabled="disabled"
            rows="1"
            class="w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed focus:outline-none disabled:opacity-60 font-sans"
            @keydown="onKeyDown"
            @paste="handlePaste"
          />
          <div class="flex items-center justify-between px-2 py-1.5 border-t border-border/60">
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Attach file"
                tabindex="-1"
                @mousedown.prevent
                @click="openFilePicker"
              >
                <Plus :size="16" />
              </button>
              <slot name="toolbar-left" />
              <span class="text-[11px] text-muted-foreground px-1">{{ sendHint }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Browse commands"
                tabindex="-1"
                @mousedown.prevent
                @click="ac.openAll()"
              >
                <SquareSlash :size="20" />
              </button>
              <button
                v-if="props.isRunning && !text.trim()"
                class="rounded p-1 text-destructive hover:text-destructive/80 hover:bg-destructive/10 transition-colors"
                title="Stop"
                @mousedown.prevent
                @click="emit('stop')"
              >
                <OctagonX :size="20" />
              </button>
              <button
                v-else
                class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title="Send"
                :disabled="disabled || (!text.trim() && attachments.length === 0)"
                @mousedown.prevent
                @click="send"
              >
                <SendHorizontal :size="20" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
