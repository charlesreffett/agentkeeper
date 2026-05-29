<template>
  <path
    :d="pathD"
    stroke="#38bdf8"
    stroke-width="2"
    stroke-dasharray="5 5"
    fill="none"
    class="vue-flow__connection-path"
  />
  <circle :cx="props.targetX" :cy="props.targetY" r="4" fill="#38bdf8" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type ConnectionLineProps, getSmoothStepPath } from '@vue-flow/core'

const props = defineProps<ConnectionLineProps>()

const pathD = computed(() => {
  const [d] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  return d
})
</script>
