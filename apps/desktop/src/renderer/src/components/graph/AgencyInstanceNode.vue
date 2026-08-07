<template>
  <div
    class="instance-node relative rounded-md border border-dashed px-3 py-2 shadow-sm min-w-[110px] cursor-pointer select-none transition-[border-color,box-shadow,opacity]"
    :class="[selected ? 'is-selected' : '', data.dimmed ? 'is-dimmed' : '']"
    :style="{ '--node-accent': accentHex }"
  >
    <Handle id="top" type="source" :position="Position.Top" :class="['!w-2 !h-2', { 'is-wired': wired.top, 'is-hovered': hovered.top }]" :style="handleStyle">
      <svg class="handle-plus" viewBox="0 0 12 12" width="5" height="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 1v10M1 6h10" />
      </svg>
    </Handle>
    <Handle id="left" type="source" :position="Position.Left" :class="['!w-2 !h-2', { 'is-wired': wired.left, 'is-hovered': hovered.left }]" :style="handleStyle">
      <svg class="handle-plus" viewBox="0 0 12 12" width="5" height="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 1v10M1 6h10" />
      </svg>
    </Handle>
    <Handle id="bottom" type="source" :position="Position.Bottom" :class="['!w-2 !h-2', { 'is-wired': wired.bottom, 'is-hovered': hovered.bottom }]" :style="handleStyle">
      <svg class="handle-plus" viewBox="0 0 12 12" width="5" height="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 1v10M1 6h10" />
      </svg>
    </Handle>

    <!-- Instance label -->
    <div class="text-xs font-medium text-card-foreground/80">{{ data.label }}</div>

    <!-- Entry badge -->
    <div v-if="data.isEntryPoint" class="mt-0.5">
      <span class="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
        entry
      </span>
    </div>

    <!-- Collapse trigger — bottom-right corner -->
    <button
      v-if="data.onCollapse"
      class="absolute bottom-1 right-1 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors"
      title="Collapse instances"
      @click.stop="data.onCollapse()"
    >
      <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
    </button>

    <Handle id="right" type="source" :position="Position.Right" :class="['!w-2 !h-2', { 'is-wired': wired.right, 'is-hovered': hovered.right }]" :style="handleStyle">
      <svg class="handle-plus" viewBox="0 0 12 12" width="5" height="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 1v10M1 6h10" />
      </svg>
    </Handle>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { accentColor, accentSolid } from './colors'
import { useLayoutStore } from '@/stores/layout'

const props = defineProps<{
  data: {
    label: string
    accent?: string
    isEntryPoint: boolean
    dimmed: boolean
    handleEdges?: { top: string[]; right: string[]; bottom: string[]; left: string[] }
    onCollapse?: () => void
  }
  selected: boolean
}>()

const layoutStore = useLayoutStore()
const accentHex = computed(() => accentColor(props.data.accent))

// The edge ids on each handle (resolved in FlowCanvas). Wired = carries any edge
// (only wired handles get the bridge stub). Hovered = one of its edges is the
// hovered edge, so the bridge mirrors the edge's hover styling.
const wired = computed(() => {
  const he = props.data.handleEdges
  return { top: !!he?.top.length, right: !!he?.right.length, bottom: !!he?.bottom.length, left: !!he?.left.length }
})
const hovered = computed(() => {
  const he = props.data.handleEdges
  const id = layoutStore.hoveredEdgeId
  const on = (arr?: string[]) => !!id && !!arr?.includes(id)
  return { top: on(he?.top), right: on(he?.right), bottom: on(he?.bottom), left: on(he?.left) }
})
const hoverColor = computed(() => (layoutStore.theme === 'dark' ? '#ffffff' : '#000000'))

// Dot = darker solid disc (connection point). Bridge = connection line color
// (accent), flipping to the edge's theme hover color on hover.
const handleStyle = computed(() => ({
  border: 'none',
  '--dot-color': accentSolid(props.data.accent),
  '--bridge-color': accentColor(props.data.accent),
  '--bridge-hover-color': hoverColor.value,
  backgroundColor: 'var(--dot-color)',
}))
</script>

<style scoped>
.instance-node {
  --node-accent: #3b82f6;
  --node-fill: color-mix(in srgb, var(--node-accent) 6%, var(--background));
  border-color: color-mix(in srgb, var(--node-accent) 70%, transparent);
  background-color: var(--node-fill);
}
.instance-node:not(.is-selected):hover {
  border-color: var(--node-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--node-accent) 40%, transparent);
}
.instance-node.is-selected {
  border-color: var(--node-accent);
  outline: 1px solid color-mix(in srgb, var(--node-accent) 50%, transparent);
  outline-offset: 2px;
}
.instance-node.is-dimmed {
  --node-fill: color-mix(in srgb, var(--node-accent) 3%, var(--background));
  background-color: var(--node-fill);
}
.instance-node.is-dimmed > * {
  opacity: 0.55;
}
.instance-node .vue-flow__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms ease;
}
.instance-node .vue-flow__handle.connectable {
  cursor: default;
}
.instance-node .handle-plus {
  color: #ffffff;
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.instance-node .vue-flow__handle:hover .handle-plus {
  opacity: 1;
}
/* Status-indicator standoff: a concentric ring around the dot in the theme
   background color makes it read as inset/socketed into the node — the ring hides
   the border evenly on all sides (light/dark aware, not tinted by the accent).
   A concentric ring would clip the connection line, so a thin accent bridge
   (::after, above the ring) reaches from the dot out through the ring to the
   line — but only on wired handles, so idle points don't sprout a footing. */
.instance-node .vue-flow__handle { box-shadow: 0 0 0 2px var(--background); }
.instance-node .vue-flow__handle.is-wired::after {
  content: '';
  position: absolute;
  background: var(--bridge-color);
  pointer-events: none;
}
/* Cross-axis matches the line exactly (line 2px → stub 2px) so the bridge reads
   as a continuation of the edge, not a wider footing. Hover mirrors the edge:
   theme color + grows with it. */
.instance-node .vue-flow__handle.is-wired.is-hovered::after { background: var(--bridge-hover-color); }
.instance-node .vue-flow__handle-right.is-wired::after  { top: 50%; left: 100%;   width: 5px; height: 2px; transform: translateY(-50%); }
.instance-node .vue-flow__handle-left.is-wired::after   { top: 50%; right: 100%;  width: 5px; height: 2px; transform: translateY(-50%); }
.instance-node .vue-flow__handle-top.is-wired::after    { left: 50%; bottom: 100%; width: 2px; height: 5px; transform: translateX(-50%); }
.instance-node .vue-flow__handle-bottom.is-wired::after { left: 50%; top: 100%;    width: 2px; height: 5px; transform: translateX(-50%); }
.instance-node .vue-flow__handle-right.is-hovered::after,
.instance-node .vue-flow__handle-left.is-hovered::after  { height: 2.5px; }
.instance-node .vue-flow__handle-top.is-hovered::after,
.instance-node .vue-flow__handle-bottom.is-hovered::after { width: 2.5px; }
/* Keep Vue Flow's centering translate when scaling, otherwise the dot shifts inward. */
.instance-node .vue-flow__handle-top:hover    { transform: translate(-50%, -50%) scale(1.5); }
.instance-node .vue-flow__handle-bottom:hover { transform: translate(-50%, 50%) scale(1.5); }
.instance-node .vue-flow__handle-left:hover   { transform: translate(-50%, -50%) scale(1.5); }
.instance-node .vue-flow__handle-right:hover  { transform: translate(50%, -50%) scale(1.5); }
</style>
