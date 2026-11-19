<script setup lang="ts">
import { ref, watch } from 'vue'
import { isHexColor } from '@shared/theme'

const props = defineProps<{ modelValue: string; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// The text field holds partial input while typing; only valid hex reaches the model.
const text = ref(props.modelValue)
watch(() => props.modelValue, v => { text.value = v })

function commitText() {
  const raw = text.value.trim()
  const hex = raw.startsWith('#') ? raw : `#${raw}`
  if (isHexColor(hex)) emit('update:modelValue', hex.toLowerCase())
  else text.value = props.modelValue
}
</script>

<template>
  <div class="flex items-center gap-2">
    <label
      class="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-input shadow-sm focus-within:ring-2 focus-within:ring-ring"
      :style="{ backgroundColor: modelValue }"
    >
      <span class="sr-only">{{ label }} color picker</span>
      <input
        type="color"
        class="absolute inset-0 size-full cursor-pointer opacity-0"
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <input
      v-model="text"
      :aria-label="`${label} hex value`"
      spellcheck="false"
      class="h-8 w-28 rounded-md border border-input bg-background px-2 font-mono text-xs uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @blur="commitText"
      @keydown.enter.prevent="commitText"
    />
  </div>
</template>
