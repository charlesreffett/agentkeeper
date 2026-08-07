<template>
  <g
    class="gradient-edge"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <defs>
      <linearGradient
        :id="gradId"
        gradientUnits="userSpaceOnUse"
        :x1="sourceX"
        :y1="sourceY"
        :x2="targetX"
        :y2="targetY"
      >
        <stop offset="0%" :stop-color="hovered ? hoverColor : sourceColor" />
        <stop offset="100%" :stop-color="hovered ? hoverColor : targetColor" />
      </linearGradient>
    </defs>

    <!-- Visible gradient line -->
    <path
      class="vue-flow__edge-path"
      :d="linePath"
      fill="none"
      :style="{
        stroke: `url(#${gradId})`,
        strokeWidth: hovered ? 2.5 : strokeWidth,
        strokeLinecap: 'round',
      }"
    />

    <!-- Wide invisible hit target for hover + click -->
    <path
      :d="linePath"
      fill="none"
      style="pointer-events: all; stroke: transparent; stroke-width: 22;"
    />

    <!-- Remove button — appears on hover, sits at the midpoint of the line -->
    <g
      v-if="hovered"
      class="gradient-edge-remove"
      role="button"
      aria-label="Remove connection"
      :transform="`translate(${midX} ${midY})`"
      style="pointer-events: all; cursor: pointer;"
      @mousedown.stop
      @click.stop="removeEdge"
    >
      <circle r="10" fill="#ffffff" stroke="rgba(0,0,0,0.25)" stroke-width="1" />
      <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" />
    </g>
  </g>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVueFlow, getSmoothStepPath, Position, type EdgeProps } from '@vue-flow/core'
import { useLayoutStore } from '@/stores/layout'

interface GradientEdgeData {
  sourceColor: string
  targetColor: string
}

const props = defineProps<EdgeProps<GradientEdgeData>>()

const { removeEdges } = useVueFlow('agency-flow')

const hovered = ref(false)

const layoutStore = useLayoutStore()

// Publish hover so the connected nodes' bridge stubs can mirror the edge's
// hover styling (they live above the standoff ring, outside this component).
function onEnter() {
  hovered.value = true
  layoutStore.setHoveredEdge(props.id)
}
function onLeave() {
  hovered.value = false
  if (layoutStore.hoveredEdgeId === props.id) layoutStore.setHoveredEdge(null)
}

// Hover highlight follows the theme: black line on light, white on dark.
const hoverColor = computed(() => layoutStore.theme === 'dark' ? '#ffffff' : '#000000')

const gradId = `ag-edge-${props.id.replace(/[^a-zA-Z0-9]/g, '_')}`

// Orthogonal routing with rounded 90° corners — the line leaves the source
// handle along its facing direction, travels axis-aligned, and turns into the
// target handle with smooth radial bends.
const route = computed(() => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition ?? Position.Bottom,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition ?? Position.Top,
    borderRadius: 14,
    offset: 26,
  })
  return { path, labelX, labelY }
})

// Runs the full route to the handle centers, so each line end touches its
// connection point dot. Standoff from the node body is a box-shadow ring on the
// handle that opens toward the line (see the node components), so no disc here.
const linePath = computed(() => route.value.path)

const sourceColor = computed(() => props.data?.sourceColor ?? '#6b7280')
const targetColor = computed(() => props.data?.targetColor ?? '#6b7280')

const strokeWidth = computed(() => (props.selected ? 3 : 2))

// The remove button sits at the center of the routed line.
const midX = computed(() => route.value.labelX)
const midY = computed(() => route.value.labelY)

function removeEdge() {
  removeEdges([props.id])
}
</script>
