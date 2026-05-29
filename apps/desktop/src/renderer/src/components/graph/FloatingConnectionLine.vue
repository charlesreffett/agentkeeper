<template>
  <line
    :x1="props.sourceX"
    :y1="props.sourceY"
    :x2="props.targetX"
    :y2="props.targetY"
    stroke="#38bdf8"
    stroke-width="2"
    stroke-dasharray="5 5"
    fill="none"
  />
  <circle :cx="props.targetX" :cy="props.targetY" r="4" fill="#38bdf8" />
</template>

<script setup lang="ts">
import type { ConnectionLineProps } from '@vue-flow/core'

const props = defineProps<ConnectionLineProps>()
</script>
