<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

const props = withDefaults(defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  triggerClass?: string
}>(), {
  align: 'start',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const currentLabel = computed(
  () =>
    props.options.find((o) => o.value === props.modelValue)?.label ??
    props.options[0]?.label ??
    '',
)
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :disabled="disabled"
        class="flex items-center gap-1 text-[11px] text-muted-foreground bg-transparent border-none outline-none shrink-0"
        :class="[
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:text-foreground transition-colors',
          triggerClass,
        ]"
      >
        <span class="truncate">{{ currentLabel }}</span>
        <ChevronDown class="h-3 w-3 shrink-0" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent :align="align" class="min-w-[8rem]">
      <DropdownMenuItem
        v-for="o in options"
        :key="o.value"
        class="text-xs justify-between"
        @select="emit('update:modelValue', o.value)"
      >
        <span class="truncate">{{ o.label }}</span>
        <Check v-if="o.value === modelValue" class="!size-3.5" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
