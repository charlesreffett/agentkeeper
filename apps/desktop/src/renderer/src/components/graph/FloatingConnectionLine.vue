<template>
  <line
    :x1="start.x"
    :y1="start.y"
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
import { computed } from 'vue'
import type { ConnectionLineProps } from '@vue-flow/core'

const props = defineProps<ConnectionLineProps>()

function borderPoint(
  cx: number, cy: number,
  hw: number, hh: number,
  toX: number, toY: number,
) {
  const dx = toX - cx
  const dy = toY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = Math.min(hw / Math.abs(dx), hh / Math.abs(dy))
  return { x: cx + dx * scale, y: cy + dy * scale }
}

const start = computed(() => {
  const node = props.sourceNode
  if (!node) return { x: props.sourceX, y: props.sourceY }
  const w = node.dimensions.width || 120
  const h = node.dimensions.height || 60
  const cx = node.position.x + w / 2
  const cy = node.position.y + h / 2
  return borderPoint(cx, cy, w / 2, h / 2, props.targetX, props.targetY)
})
</script>
