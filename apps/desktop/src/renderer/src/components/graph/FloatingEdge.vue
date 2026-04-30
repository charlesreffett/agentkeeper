<template>
  <path
    :id="id"
    class="vue-flow__edge-path"
    :d="edgePath"
    :marker-end="markerEnd"
    :marker-start="markerStart"
    :style="style"
  />
  <path
    class="vue-flow__edge-interaction"
    :d="edgePath"
    style="stroke-width: 20; stroke: transparent; fill: none; cursor: pointer;"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EdgeProps } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

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

const edgePath = computed(() => {
  const sn = props.sourceNode
  const tn = props.targetNode

  const sw = sn.dimensions.width || 120
  const sh = sn.dimensions.height || 60
  const tw = tn.dimensions.width || 120
  const th = tn.dimensions.height || 60

  const scx = sn.position.x + sw / 2
  const scy = sn.position.y + sh / 2
  const tcx = tn.position.x + tw / 2
  const tcy = tn.position.y + th / 2

  const sp = borderPoint(scx, scy, sw / 2, sh / 2, tcx, tcy)
  const tp = borderPoint(tcx, tcy, tw / 2, th / 2, scx, scy)

  return `M ${sp.x} ${sp.y} L ${tp.x} ${tp.y}`
})
</script>
