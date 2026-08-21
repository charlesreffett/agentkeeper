<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { Check, Copy } from '@/components/icons/app-icons'

defineOptions({ inheritAttrs: false })

const preRef = useTemplateRef<HTMLPreElement>('preRef')
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  const text = preRef.value?.textContent ?? ''
  if (!text) return
  await navigator.clipboard.writeText(text)
  copied.value = true
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="group relative">
    <button
      type="button"
      class="absolute right-2 top-2 z-10 inline-flex items-center justify-center rounded-md border border-border/50 bg-background/70 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      :aria-label="copied ? 'Copied' : 'Copy code'"
      @click="copy"
    >
      <Check v-if="copied" class="size-3.5 text-green-500" />
      <Copy v-else class="size-3.5" />
    </button>
    <pre ref="preRef" v-bind="$attrs"><slot /></pre>
  </div>
</template>
