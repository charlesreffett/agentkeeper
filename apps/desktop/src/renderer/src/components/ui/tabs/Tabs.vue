<script setup lang="ts">
import { TabsRoot } from 'reka-ui'

const props = defineProps<{
  defaultValue?: string
  modelValue?: string
  class?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <TabsRoot
    :default-value="defaultValue"
    :model-value="modelValue"
    :class="props.class"
    @update:model-value="emit('update:modelValue', $event as string)"
  >
    <slot />
  </TabsRoot>
</template>
