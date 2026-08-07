<template>
  <path
    :d="pathD"
    :stroke="lineColor"
    stroke-width="2"
    stroke-dasharray="5 5"
    fill="none"
    class="vue-flow__connection-path"
  />
  <circle :cx="props.targetX" :cy="props.targetY" r="4" :fill="lineColor" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type ConnectionLineProps, getSmoothStepPath } from '@vue-flow/core'
import { accentColor } from './colors'

const props = defineProps<ConnectionLineProps>()

const pathD = computed(() => {
  const [d] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 14,
    offset: 26,
  })
  return d
})

// Tint the in-progress line with the source node's accent so a drag previews
// the gradient edge it will become.
const lineColor = computed(() =>
  accentColor((props.sourceNode?.data as { accent?: string } | undefined)?.accent)
)
</script>
