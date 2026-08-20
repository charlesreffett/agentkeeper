<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface SessionControlOption {
  value: string
  label: string
  description: string
  isDefault?: boolean
}

const props = defineProps<{
  modelValue: string
  label: string
  options: SessionControlOption[]
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const current = computed(() => props.options.find((option) => option.value === props.modelValue) ?? props.options[0])
const open = ref(false)

function select(value: string) {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button type="button" :disabled="disabled" class="flex h-7 max-w-36 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
        <slot name="icon" />
        <span class="truncate">{{ current?.label }}</span>
        <ChevronDown class="size-3 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-[340px] border-muted-foreground/40 p-1.5">
      <div class="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ label }}</div>
      <button v-for="option in options" :key="option.value" type="button" class="flex w-full items-start gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-muted" @click="select(option.value)">
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5 text-sm font-medium">
            {{ option.label }}
            <span v-if="option.isDefault" class="rounded border border-muted-foreground/40 px-1 py-px text-[9px] font-normal uppercase text-muted-foreground">Default</span>
          </span>
          <span class="block text-xs leading-relaxed text-muted-foreground">{{ option.description }}</span>
        </span>
        <Check v-if="option.value === modelValue" class="mt-0.5 size-4 shrink-0 text-primary" />
      </button>
    </PopoverContent>
  </Popover>
</template>
