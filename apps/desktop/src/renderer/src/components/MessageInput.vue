<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useProjectsStore } from '@/stores/projects'
import { useCommandAutocomplete } from '@/composables/useCommandAutocomplete'
import CommandAutocomplete from '@/components/CommandAutocomplete.vue'

const props = defineProps<{
  disabled?: boolean
  placeholder?: string
  autofocus?: boolean
  /** When true: Enter sends; ⌘/Ctrl+Enter inserts newline. */
  enterToSend?: boolean
  projectPath?: string
}>()

const emit = defineEmits<{ send: [text: string] }>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

const projectsStore = useProjectsStore()
const resolvedProjectPath = computed(
  () => props.projectPath ?? projectsStore.focusedProject?.path ?? '',
)

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
  const mod = event.metaKey || event.ctrlKey
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
  props.enterToSend ? 'Enter to send · ⌘/Ctrl+Enter for newline' : '⌘/Ctrl+Enter to send',
)

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
            :placeholder="placeholder ?? `Message — ${sendHint}`"
            :disabled="disabled"
            rows="1"
            class="w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed focus:outline-none disabled:opacity-60 font-sans"
            @keydown="onKeyDown"
          />
          <div class="flex items-center justify-between px-2 py-1.5 border-t border-border/60">
            <div class="text-[11px] text-muted-foreground px-1">
              {{ sendHint }}
            </div>
            <Button
              size="sm"
              :disabled="disabled || !text.trim()"
              @click="send"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
