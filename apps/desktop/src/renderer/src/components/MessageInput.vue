<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import { Square, SquareSlash, SendHorizontal } from 'lucide-vue-next'
import { useProjectsStore } from '@/stores/projects'
import { useCommandAutocomplete } from '@/composables/useCommandAutocomplete'
import CommandAutocomplete from '@/components/CommandAutocomplete.vue'

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

const emit = defineEmits<{ send: [text: string]; stop: [] }>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

const projectsStore = useProjectsStore()
const resolvedProjectPath = computed(
  () => props.projectPath ?? projectsStore.focusedProject?.path ?? '',
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
  if (!v || props.disabled) return
  emit('send', v)
  text.value = ''
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
  const match = projectsStore.projects.find((p) => p.path === path)
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
          <textarea
            ref="textarea"
            v-model="text"
            :placeholder="placeholder ?? defaultPlaceholder"
            :disabled="disabled"
            rows="1"
            class="w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed focus:outline-none disabled:opacity-60 font-sans"
            @keydown="onKeyDown"
          />
          <div class="flex items-center justify-between px-2 py-1.5 border-t border-border/60">
            <div class="text-[11px] text-muted-foreground px-1">
              {{ sendHint }}
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
                v-if="props.isRunning"
                class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Stop"
                @mousedown.prevent
                @click="emit('stop')"
              >
                <Square :size="20" />
              </button>
              <button
                class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title="Send"
                :disabled="disabled || !text.trim()"
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
