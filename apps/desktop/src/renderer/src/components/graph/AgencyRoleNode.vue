<template>
  <div
    class="agency-node relative rounded-lg border shadow-md cursor-pointer select-none transition-[border-color,box-shadow,opacity] min-w-[160px]"
    :class="[
      data.anyToAny ? 'border-dashed' : '',
      selected ? 'is-selected' : '',
      data.dimmed ? 'is-dimmed' : '',
    ]"
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

    <div class="flex items-center gap-2.5 px-3 py-2.5 pr-8">
      <!-- Colored icon avatar -->
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        :style="{ backgroundColor: accentBgColor, color: accentHex }"
      >
        <component :is="iconComp" class="w-4 h-4" />
      </div>

      <!-- Name + id + badges -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold text-card-foreground truncate">{{ data.name }}</span>
          <span
            v-if="data.multiplicityLabel && !data.isExpanded"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
          >{{ data.multiplicityLabel }}</span>
          <span
            v-if="data.isEntryPoint"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0"
          >entry</span>
          <span
            v-if="data.anyToAny"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 shrink-0"
          >open</span>
        </div>
        <div class="text-[10px] font-mono text-muted-foreground truncate">{{ data.roleId ?? data.label }}</div>
      </div>
    </div>

    <!-- Expand / collapse toggle — top-right corner -->
    <button
      v-if="data.isExpandable"
      class="absolute top-1.5 right-1.5 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      :title="data.isExpanded ? 'Collapse instances' : 'Expand instances'"
      @click.stop="data.onToggleExpand?.()"
    >
      <svg v-if="data.isExpanded" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
      <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
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
import { computed, markRaw } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
  Layers, Code2, GitBranch, FlaskConical, Eye,
  FileText, Activity, Shield, Zap, Brain,
} from '@/components/icons/app-icons'
import { accentColor, accentBg, accentSolid } from './colors'
import { useLayoutStore } from '@/stores/layout'

const ICON_MAP: Record<string, ReturnType<typeof markRaw>> = {
  Layers:       markRaw(Layers),
  Code2:        markRaw(Code2),
  GitBranch:    markRaw(GitBranch),
  FlaskConical: markRaw(FlaskConical),
  Eye:          markRaw(Eye),
  FileText:     markRaw(FileText),
  Activity:     markRaw(Activity),
  Shield:       markRaw(Shield),
  Zap:          markRaw(Zap),
  Brain:        markRaw(Brain),
}

const props = defineProps<{
  data: {
    label: string
    roleId?: string
    name?: string
    icon?: string
    accent?: string
    isEntryPoint: boolean
    anyToAny: boolean
    multiplicityLabel: string
    isExpandable: boolean
    isExpanded: boolean
    dimmed: boolean
    handleEdges?: { top: string[]; right: string[]; bottom: string[]; left: string[] }
    onToggleExpand?: () => void
  }
  selected: boolean
}>()

const layoutStore = useLayoutStore()
const accentHex = computed(() => accentColor(props.data.accent))
const accentBgColor = computed(() => accentBg(props.data.accent))

// The edge ids on each handle (resolved in FlowCanvas). A handle is wired when it
// carries any edge — only wired handles get the bridge stub, so idle points don't
// sprout a footing. A handle is hovered when one of its edges is the hovered edge,
// mirroring the edge's hover styling on the bridge.
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

// The dot is a darker solid disc (the connection point). The bridge stub matches
// the connection line's color (accent, the gradient endpoint) so line and stub
// read as one; on hover it flips to the edge's theme hover color.
const handleStyle = computed(() => ({
  border: 'none',
  '--dot-color': accentSolid(props.data.accent),
  '--bridge-color': accentColor(props.data.accent),
  '--bridge-hover-color': hoverColor.value,
  backgroundColor: 'var(--dot-color)',
}))
const iconComp = computed(() =>
  ICON_MAP[props.data.icon ?? 'Layers'] ?? Layers
)
</script>

<style scoped>
.agency-node {
  --node-accent: #3b82f6;
  --node-fill: color-mix(in srgb, var(--node-accent) 7%, var(--background));
  border-color: var(--node-accent);
  background-color: var(--node-fill);
}
.agency-node:not(.is-selected):hover {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--node-accent) 45%, transparent);
}
.agency-node.is-selected {
  border-color: var(--node-accent);
  outline: 1px solid color-mix(in srgb, var(--node-accent) 50%, transparent);
  outline-offset: 2px;
}
.agency-node.is-dimmed {
  --node-fill: color-mix(in srgb, var(--node-accent) 4%, var(--background));
  background-color: var(--node-fill);
}
.agency-node.is-dimmed > * {
  opacity: 0.55;
}
.agency-node .vue-flow__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms ease;
}
.agency-node .vue-flow__handle.connectable {
  cursor: default;
}
.agency-node .handle-plus {
  color: #ffffff;
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.agency-node .vue-flow__handle:hover .handle-plus {
  opacity: 1;
}
/* Status-indicator standoff: a concentric ring around the dot in the theme
   background color makes it read as inset/socketed into the node — the ring hides
   the border evenly on all sides (light/dark aware, not tinted by the accent).
   A concentric ring would clip the connection line, so a thin accent bridge
   (::after, above the ring) reaches from the dot out through the ring to the
   line — but only on wired handles, so idle points don't sprout a footing. */
.agency-node .vue-flow__handle { box-shadow: 0 0 0 2px var(--background); }
.agency-node .vue-flow__handle.is-wired::after {
  content: '';
  position: absolute;
  background: var(--bridge-color);
  pointer-events: none;
}
/* Cross-axis matches the line exactly (line 2px → stub 2px) so the bridge reads
   as a continuation of the edge, not a wider footing. Hover mirrors the edge:
   theme color + grows with it. */
.agency-node .vue-flow__handle.is-wired.is-hovered::after { background: var(--bridge-hover-color); }
.agency-node .vue-flow__handle-right.is-wired::after  { top: 50%; left: 100%;   width: 5px; height: 2px; transform: translateY(-50%); }
.agency-node .vue-flow__handle-left.is-wired::after   { top: 50%; right: 100%;  width: 5px; height: 2px; transform: translateY(-50%); }
.agency-node .vue-flow__handle-top.is-wired::after    { left: 50%; bottom: 100%; width: 2px; height: 5px; transform: translateX(-50%); }
.agency-node .vue-flow__handle-bottom.is-wired::after { left: 50%; top: 100%;    width: 2px; height: 5px; transform: translateX(-50%); }
.agency-node .vue-flow__handle-right.is-hovered::after,
.agency-node .vue-flow__handle-left.is-hovered::after  { height: 2.5px; }
.agency-node .vue-flow__handle-top.is-hovered::after,
.agency-node .vue-flow__handle-bottom.is-hovered::after { width: 2.5px; }
/* Keep Vue Flow's centering translate when scaling, otherwise the dot shifts inward. */
.agency-node .vue-flow__handle-top:hover    { transform: translate(-50%, -50%) scale(1.5); }
.agency-node .vue-flow__handle-bottom:hover { transform: translate(-50%, 50%) scale(1.5); }
.agency-node .vue-flow__handle-left:hover   { transform: translate(-50%, -50%) scale(1.5); }
.agency-node .vue-flow__handle-right:hover  { transform: translate(50%, -50%) scale(1.5); }
</style>
