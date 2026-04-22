<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  disabled?: boolean
  placeholder?: string
  autofocus?: boolean
}>()

const emit = defineEmits<{ send: [text: string] }>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

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
  // Cmd/Ctrl + Enter to send
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void send()
  }
}

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
      <div
        class="rounded-lg border border-border bg-background focus-within:border-ring transition"
      >
        <textarea
          ref="textarea"
          v-model="text"
          :placeholder="placeholder ?? 'Message — ⌘/Ctrl + Enter to send'"
          :disabled="disabled"
          rows="1"
          class="w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed focus:outline-none disabled:opacity-60 font-sans"
          @keydown="onKeyDown"
        />
        <div class="flex items-center justify-between px-2 py-1.5 border-t border-border/60">
          <div class="text-[11px] text-muted-foreground px-1">
            ⌘/Ctrl + Enter to send
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
</template>
