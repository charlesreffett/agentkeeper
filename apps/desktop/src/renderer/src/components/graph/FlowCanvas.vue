<template>
  <div class="w-full h-full">
    <VueFlow
      id="agency-flow"
      :nodes="vfNodes"
      :edges="vfEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :fit-view-on-init="fitOnLoad"
      :delete-key-code="null"
      class="bg-background"
      :default-edge-options="defaultEdgeOptions"
      :is-valid-connection="isValidConnection"
      :connect-on-click="false"
      :connection-mode="ConnectionMode.Loose"
      @connect="onConnect"
      @edge-update-start="onEdgeUpdateStart"
      @edge-update="onEdgeUpdate"
      @edge-update-end="onEdgeUpdateEnd"
      @edges-change="onEdgesChange"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-drag-stop="onNodeDragStop"
    >
      <template #connection-line="lineProps">
        <FloatingConnectionLine v-bind="lineProps" />
      </template>
      <Background :pattern-color="patternColor" :gap="20" />
      <Controls class="!bg-muted !border-border" />
      <Panel position="bottom-right">
        <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-background/80 border border-border backdrop-blur-sm rounded-md px-3 py-1.5 shadow-sm select-none font-mono">
          <span>{{ Math.round(viewport.zoom * 100) }}%</span>
          <span class="opacity-40">·</span>
          <span>drag to connect</span>
          <span class="opacity-40">·</span>
          <span>⌫ to delete</span>
        </div>
      </Panel>
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw } from 'vue'
import { VueFlow, useVueFlow, ConnectionMode, Position, Panel } from '@vue-flow/core'
import { useLayoutStore } from '@/stores/layout'
import type {
  Node as VFNode,
  Edge as VFEdge,
  NodeMouseEvent,
  EdgeMouseEvent,
  EdgeUpdateEvent,
  EdgeChange,
  NodeDragEvent,
  Connection,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import AgencyRoleNode from './AgencyRoleNode.vue'
import AgencyInstanceNode from './AgencyInstanceNode.vue'
import ElasticCapacityGroupNode from './ElasticCapacityGroupNode.vue'
import FloatingConnectionLine from './FloatingConnectionLine.vue'
import GradientEdge from './GradientEdge.vue'
import { accentColor } from './colors'
import type { GraphNode, GraphEdge, GraphFlowMode, GraphConnectionRequest } from './types'

const props = defineProps<{
  nodes: GraphNode[]
  edges: GraphEdge[]
  flowMode: GraphFlowMode
  selectedNodeId: string | null
  selectedEdgeId: string | null
  fitOnLoad?: boolean
}>()

const emit = defineEmits<{
  (e: 'node-click', nodeId: string): void
  (e: 'edge-click', edgeId: string): void
  (e: 'edge-remove', edgeId: string): void
  (e: 'connection', payload: GraphConnectionRequest): void
  (e: 'edge-update', oldEdgeId: string, payload: GraphConnectionRequest): void
  (e: 'pane-click'): void
  (e: 'node-move', nodeId: string, position: { x: number; y: number }): void
  (e: 'node-expand', roleId: string): void
}>()

const layoutStore = useLayoutStore()

const patternColor = computed(() =>
  layoutStore.theme === 'dark' ? '#27272a' : '#d4cfc8'
)

// updateEdge / addEdges are needed for edge-reconnection UX:
// updateEdge() applies the new connection to Vue Flow's internal state immediately
// (without it the edge snaps back on next render). addEdges() restores the edge
// when a drag is cancelled without connecting anywhere.
const { updateEdge, addEdges, viewport } = useVueFlow('agency-flow')

// Tracks the edge being dragged so we can restore it on a cancelled drag.
let draggingEdge: VFEdge | null = null
let edgeUpdateSuccessful = false

// Cast to bypass strict NodeComponent type mismatch — our component satisfies
// the runtime contract but Vue Flow's generic NodeProps don't align with defineProps<...>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: Record<string, any> = {
  role: markRaw(AgencyRoleNode),
  instance: markRaw(AgencyInstanceNode),
  'elastic-group': markRaw(ElasticCapacityGroupNode),
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: Record<string, any> = {
  gradient: markRaw(GradientEdge),
}

const defaultEdgeOptions = {
  type: 'gradient',
  updatable: true,
  animated: false,
}

const vfNodes = computed<VFNode[]>(() =>
  props.nodes.map(n => {
    // When a node is focused, dim every node that isn't focused and has no
    // direct edge to/from the focused node — their connection points stay
    // fully opaque so the focused node's neighbourhood remains legible.
    const dimmed =
      props.selectedNodeId !== null &&
      n.id !== props.selectedNodeId &&
      !props.edges.some(
        e =>
          (e.source === n.id && e.target === props.selectedNodeId) ||
          (e.target === n.id && e.source === props.selectedNodeId),
      )
    if (n.kind === 'elastic-group') {
      return {
        id: n.id,
        type: 'elastic-group',
        position: n.position,
        draggable: true,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: 0,
        style: {
          width: `${n.dimensions?.width ?? 150}px`,
          height: `${n.dimensions?.height ?? 116}px`,
        },
        data: {
          label: n.label,
          accent: (n.meta.accent as string | undefined) ?? 'blue',
        },
      }
    }
    if (n.kind === 'instance') {
      const elasticGroup = n.isElasticCapacity
        ? props.nodes.find(group => group.id === `${n.parentRoleId}::elastic-capacity`)
        : undefined
      return {
        id: n.id,
        type: 'instance',
        position: elasticGroup
          ? {
              x: n.position.x - elasticGroup.position.x,
              y: n.position.y - elasticGroup.position.y,
            }
          : n.position,
        parentNode: elasticGroup?.id,
        extent: elasticGroup ? 'parent' as const : undefined,
        draggable: !elasticGroup,
        selected: n.id === props.selectedNodeId,
        zIndex: 1,
        data: {
          label: n.label,
          accent: (n.meta.accent as string | undefined) ?? 'blue',
          isEntryPoint: n.isEntryPoint,
          isElasticCapacity: n.isElasticCapacity ?? false,
          dimmed,
          handleEdges: handleEdgeMap.value.get(n.id) ?? NO_HANDLE_EDGES,
          // Pass collapse callback — collapses the parent role group
          onCollapse: n.parentRoleId
            ? () => emit('node-expand', n.parentRoleId!)
            : undefined,
        },
      }
    }
    return {
      id: n.id,
      type: 'role',
      position: n.position,
      selected: n.id === props.selectedNodeId,
      data: {
        label: n.label,
        roleId: n.id,
        name: (n.meta.name as string | undefined) ?? n.label,
        icon: (n.meta.icon as string | undefined) ?? 'Layers',
        accent: (n.meta.accent as string | undefined) ?? 'blue',
        isEntryPoint: n.isEntryPoint,
        anyToAny: n.anyToAny,
        multiplicityLabel: n.multiplicityLabel,
        isExpandable: n.isExpandable,
        isExpanded: n.isExpanded,
        dimmed,
        handleEdges: handleEdgeMap.value.get(n.id) ?? NO_HANDLE_EDGES,
        onToggleExpand: n.isExpandable
          ? () => emit('node-expand', n.id)
          : undefined,
      },
    }
  })
)

const nodePosMap = computed(() => new Map(props.nodes.map(n => [n.id, n.position])))

const HANDLE_TO_POSITION: Record<string, Position> = {
  top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left,
}

// Returns the handle on each node that faces the other node along the dominant axis.
// Used as the auto-routing fallback when no user-chosen handle is stored or when
// the stored handle would cause the edge to loop back through a node.
function getBestHandles(
  srcPos: { x: number; y: number },
  tgtPos: { x: number; y: number },
): { sourceHandle: string; targetHandle: string; sourcePosition: Position; targetPosition: Position } {
  const dx = tgtPos.x - srcPos.x
  const dy = tgtPos.y - srcPos.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left', sourcePosition: Position.Right, targetPosition: Position.Left }
      : { sourceHandle: 'left', targetHandle: 'right', sourcePosition: Position.Left, targetPosition: Position.Right }
  } else {
    return dy >= 0
      ? { sourceHandle: 'bottom', targetHandle: 'top', sourcePosition: Position.Bottom, targetPosition: Position.Top }
      : { sourceHandle: 'top', targetHandle: 'bottom', sourcePosition: Position.Top, targetPosition: Position.Bottom }
  }
}

// Returns true when the smoothstep path would loop back through the node.
// That only happens when the chosen handle is the direct opposite of the
// dominant-axis facing handle (e.g. stored "right" when the target is to the
// left so best is "left"). A handle that's merely off-axis (e.g. "right" when
// the target is below-left) can still route cleanly — the path bows out to the
// side then curves around, never re-entering the node.
function handleNeedsSnap(stored: string, bestHandle: string): boolean {
  switch (bestHandle) {
    case 'right':  return stored === 'left'
    case 'left':   return stored === 'right'
    case 'bottom': return stored === 'top'
    case 'top':    return stored === 'bottom'
    default:       return false
  }
}

// Each node's accent color, keyed by node id. Instance nodes inherit their
// parent role's accent (set in useFlowGraph).
const nodeColorMap = computed(() =>
  new Map(props.nodes.map(n => [n.id, accentColor(n.meta.accent as string | undefined)]))
)

type HandleEdges = { top: string[]; right: string[]; bottom: string[]; left: string[] }
const NO_HANDLE_EDGES: HandleEdges = { top: [], right: [], bottom: [], left: [] }

// The edge ids attached to each node handle, resolved with the SAME snap logic
// that places the edges below — so the node's bridge stub lands on exactly the
// handle the line renders into, and can match a hovered edge by id. Computed
// here rather than via Vue Flow's connectionLookup, whose in-place Map mutation
// doesn't reliably retrigger the per-node useNodeConnections watch.
const handleEdgeMap = computed(() => {
  const map = new Map<string, HandleEdges>()
  const slot = (id: string): HandleEdges => {
    let w = map.get(id)
    if (!w) { w = { top: [], right: [], bottom: [], left: [] }; map.set(id, w) }
    return w
  }
  for (const e of props.edges) {
    const srcPos = nodePosMap.value.get(e.source) ?? { x: 0, y: 0 }
    const tgtPos = nodePosMap.value.get(e.target) ?? { x: 0, y: 0 }
    const best = getBestHandles(srcPos, tgtPos)
    const rawSrc = e.sourceHandle ?? best.sourceHandle
    const sourceHandle = handleNeedsSnap(rawSrc, best.sourceHandle) ? best.sourceHandle : rawSrc
    const rawTgt = e.targetHandle ?? best.targetHandle
    const targetHandle = handleNeedsSnap(rawTgt, best.targetHandle) ? best.targetHandle : rawTgt
    if (sourceHandle in slot(e.source)) slot(e.source)[sourceHandle as keyof HandleEdges].push(e.id)
    if (targetHandle in slot(e.target)) slot(e.target)[targetHandle as keyof HandleEdges].push(e.id)
  }
  return map
})

// When a node is focused (selected), only its incident edges carry the
// gradient colors; every other edge drops to grey. With no focus, all edges
// show their gradient. The edge component paints solid white on hover.
const EDGE_GREY = '#6b7280'

const vfEdges = computed<VFEdge[]>(() => {
  const mapped = props.edges.map(e => {
    const isSelected = e.id === props.selectedEdgeId
    const focused = props.selectedNodeId
    const connectedToFocused = focused !== null && (e.source === focused || e.target === focused)
    const showGradient = focused === null || connectedToFocused
    const srcAccent = nodeColorMap.value.get(e.source) ?? EDGE_GREY
    const tgtAccent = nodeColorMap.value.get(e.target) ?? EDGE_GREY
    const sourceColor = showGradient ? srcAccent : EDGE_GREY
    const targetColor = showGradient ? tgtAccent : EDGE_GREY
    const srcPos = nodePosMap.value.get(e.source) ?? { x: 0, y: 0 }
    const tgtPos = nodePosMap.value.get(e.target) ?? { x: 0, y: 0 }
    const best = getBestHandles(srcPos, tgtPos)
    const rawSrc = e.sourceHandle ?? best.sourceHandle
    const sourceHandle = handleNeedsSnap(rawSrc, best.sourceHandle) ? best.sourceHandle : rawSrc
    const sourcePosition = HANDLE_TO_POSITION[sourceHandle] ?? best.sourcePosition
    const rawTgt = e.targetHandle ?? best.targetHandle
    const targetHandle = handleNeedsSnap(rawTgt, best.targetHandle) ? best.targetHandle : rawTgt
    const targetPosition = HANDLE_TO_POSITION[targetHandle] ?? best.targetPosition

    return {
      id: e.id,
      type: 'gradient',
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      sourcePosition,
      targetPosition,
      selected: isSelected,
      data: {
        sourceColor,
        targetColor,
      },
    }
  })

  // SVG paints last-in-array on top. Promote the selected edge to the end so
  // its drag handles sit above any other edges that share the same source handle,
  // ensuring a drag always moves the selected edge rather than a stacked peer.
  if (props.selectedEdgeId) {
    const idx = mapped.findIndex(e => e.id === props.selectedEdgeId)
    if (idx !== -1) mapped.push(mapped.splice(idx, 1)[0]!)
  }

  return mapped
})

function isValidConnection(conn: Connection): boolean {
  // Only block self-loops here — duplicate detection happens in onConnect where
  // Vue Flow has already confirmed the connection, avoiding false positives from
  // ConnectionMode.Loose calling this during hover with unexpected handle pairings.
  return !!conn.source && !!conn.target && conn.source !== conn.target &&
    !isElasticCapacity(conn.source) && !isElasticCapacity(conn.target)
}

function isElasticCapacity(nodeId: string): boolean {
  return props.nodes.some(n => n.id === nodeId && n.isElasticCapacity)
}

function onConnect(conn: Connection) {
  if (!conn.source || !conn.target) return
  if (isElasticCapacity(conn.source) || isElasticCapacity(conn.target)) return
  // Block duplicate connections (same source→target regardless of handles).
  if (props.edges.some(e => e.source === conn.source && e.target === conn.target)) return
  const srcPos = nodePosMap.value.get(conn.source) ?? { x: 0, y: 0 }
  const tgtPos = nodePosMap.value.get(conn.target) ?? { x: 0, y: 0 }
  const best = getBestHandles(srcPos, tgtPos)
  const rawSrc = conn.sourceHandle ?? best.sourceHandle
  const sourceHandle = handleNeedsSnap(rawSrc, best.sourceHandle) ? best.sourceHandle : rawSrc
  const rawTgt = conn.targetHandle ?? best.targetHandle
  const targetHandle = handleNeedsSnap(rawTgt, best.targetHandle) ? best.targetHandle : rawTgt
  emit('connection', { sourceId: conn.source, targetId: conn.target, sourceHandle, targetHandle })
}

function onEdgeUpdateStart({ edge }: EdgeMouseEvent) {
  draggingEdge = edge
  edgeUpdateSuccessful = false
}

function onEdgeUpdate({ edge, connection: conn }: EdgeUpdateEvent) {
  if (!conn.source || !conn.target) return
  if (isElasticCapacity(conn.source) || isElasticCapacity(conn.target)) return
  edgeUpdateSuccessful = true
  const srcPos = nodePosMap.value.get(conn.source) ?? { x: 0, y: 0 }
  const tgtPos = nodePosMap.value.get(conn.target) ?? { x: 0, y: 0 }
  const best = getBestHandles(srcPos, tgtPos)
  const rawSrc = conn.sourceHandle ?? best.sourceHandle
  const sourceHandle = handleNeedsSnap(rawSrc, best.sourceHandle) ? best.sourceHandle : rawSrc
  const rawTgt = conn.targetHandle ?? best.targetHandle
  const targetHandle = handleNeedsSnap(rawTgt, best.targetHandle) ? best.targetHandle : rawTgt
  // Apply corrected handles to Vue Flow's internal state immediately so the edge
  // doesn't snap back on next render.
  updateEdge(edge, { ...conn, sourceHandle, targetHandle })
  emit('edge-update', edge.id, { sourceId: conn.source, targetId: conn.target, sourceHandle, targetHandle })
}

function onEdgeUpdateEnd() {
  // When the drag is cancelled (dropped on empty canvas), Vue Flow has already
  // removed the edge from its internal state. Restore it so it doesn't vanish.
  if (!edgeUpdateSuccessful && draggingEdge) {
    addEdges([{ ...draggingEdge }])
  }
  draggingEdge = null
}

function onNodeClick({ node }: NodeMouseEvent) {
  emit('node-click', node.id)
}

function onEdgeClick({ edge }: EdgeMouseEvent) {
  emit('edge-click', edge.id)
}

function onPaneClick() {
  emit('pane-click')
}

function onEdgesChange(changes: EdgeChange[]) {
  for (const change of changes) {
    if (change.type === 'remove') {
      emit('edge-remove', change.id)
    }
  }
}

function onNodeDragStop({ node }: NodeDragEvent) {
  emit('node-move', node.id, node.position)
}
</script>
