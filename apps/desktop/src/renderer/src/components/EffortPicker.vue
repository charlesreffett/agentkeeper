<script setup lang="ts">
import { computed } from 'vue'
import { Brain } from '@/components/icons/app-icons'
import PillSelect from '@/components/PillSelect.vue'
import { useModelsQuery } from '@/composables/useModelsQuery'

const props = withDefaults(defineProps<{
  modelValue: string
  model?: string
  harnessId?: string
  disabled?: boolean
  includeDefault?: boolean
  display?: 'compact' | 'field'
}>(), {
  model: '',
  includeDefault: false,
  display: 'compact',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { effortLevelsFor } = useModelsQuery(() => props.harnessId)
const options = computed(() => [
  ...(props.includeDefault ? [{ value: '', label: 'default' }] : []),
  ...effortLevelsFor(props.model).map(value => ({ value, label: value })),
])
</script>

<template>
  <div
    class="flex items-center shrink-0"
    :class="display === 'field' ? 'h-10 w-full gap-2 rounded-md border border-input bg-background px-3' : 'gap-0.5'"
  >
    <Brain :size="display === 'field' ? 15 : 13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
    <PillSelect
      :model-value="modelValue"
      :options="options"
      :disabled="disabled"
      :trigger-class="display === 'field' ? 'min-w-0 flex-1 justify-between text-sm' : 'max-w-[72px]'"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
