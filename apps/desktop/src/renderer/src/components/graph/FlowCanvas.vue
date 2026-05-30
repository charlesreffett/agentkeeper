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
      :is-valid-connection="(conn) => conn.source !== conn.target"
      :connect-on-click="false"
      :connection-mode="ConnectionMode.Loose"
      :connection-line-component="FloatingConnectionLine"
      @connect="onConnect"
      @edge-update="onEdgeUpdate"
      @edges-change="onEdgesChange"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-drag-stop="onNodeDragStop"
    >
      <Background :pattern-color="patternColor" :gap="20" />
      <Controls class="!bg-muted !border-border" />
      <AnyToAnyOverlay v-if="flowMode === 'any-to-any'" />
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw } from 'vue'
import { VueFlow, MarkerType, useVueFlow, ConnectionMode, Position } from '@vue-flow/core'
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
import FloatingConnectionLine from './FloatingConnectionLine.vue'
import AnyToAnyOverlay from './AnyToAnyOverlay.vue'
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

// Register the store instance by ID so edge/node helpers are available if
// needed elsewhere; we don't call addEdges manually — pendingFlows in
// useFlowGraph drives the :edges prop and provides immediate visual feedback
// without triggering a reconciliation remove event that would undo the save.
useVueFlow('agency-flow')

// Cast to bypass strict NodeComponent type mismatch — our component satisfies
// the runtime contract but Vue Flow's generic NodeProps don't align with defineProps<...>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: Record<string, any> = {
  role: markRaw(AgencyRoleNode),
  instance: markRaw(AgencyInstanceNode),
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: Record<string, any> = {}

const defaultEdgeOptions = {
  type: 'smoothstep',
  updatable: true,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
  style: { stroke: '#6b7280', strokeWidth: 2 },
  animated: false,
}

const vfNodes = computed<VFNode[]>(() =>
  props.nodes.map(n => {
    if (n.kind === 'instance') {
      return {
        id: n.id,
        type: 'instance',
        position: n.position,
        selected: n.id === props.selectedNodeId,
        data: {
          label: n.label,
          isEntryPoint: n.isEntryPoint,
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
        isEntryPoint: n.isEntryPoint,
        anyToAny: n.anyToAny,
        multiplicityLabel: n.multiplicityLabel,
        isExpandable: n.isExpandable,
        isExpanded: n.isExpanded,
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
const OPPOSITE: Record<string, string> = {
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
}

// For legacy edges without stored handles, infer the best pair from node positions.
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

// The "facing" handle on the target is the side that points toward the source.
// e.g. source is above target (dy > 0) → top of target faces the source.
function facingTargetHandle(srcPos: { x: number; y: number }, tgtPos: { x: number; y: number }): string {
  const dx = tgtPos.x - srcPos.x
  const dy = tgtPos.y - srcPos.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right'
  return dy >= 0 ? 'top' : 'bottom'
}

const vfEdges = computed<VFEdge[]>(() =>
  props.edges.map(e => {
    const isSelected = e.id === props.selectedEdgeId
    const stroke = isSelected ? '#3b82f6' : '#6b7280'
    let sourceHandle: string
    let targetHandle: string
    let sourcePosition: Position
    let targetPosition: Position

    if (e.sourceHandle && e.targetHandle) {
      // Explicit handles stored at connection time — use them directly.
      sourceHandle = e.sourceHandle
      targetHandle = e.targetHandle
      sourcePosition = HANDLE_TO_POSITION[e.sourceHandle] ?? Position.Right
      targetPosition = HANDLE_TO_POSITION[e.targetHandle] ?? Position.Left
    } else {
      // Legacy edge with no stored handles — infer from positions.
      const srcPos = nodePosMap.value.get(e.source) ?? { x: 0, y: 0 }
      const tgtPos = nodePosMap.value.get(e.target) ?? { x: 0, y: 0 }
      ;({ sourceHandle, targetHandle, sourcePosition, targetPosition } = getBestHandles(srcPos, tgtPos))
    }

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      sourcePosition,
      targetPosition,
      selected: isSelected,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: { stroke, strokeWidth: isSelected ? 3 : 2 },
    }
  })
)

function onConnect(conn: Connection) {
  if (!conn.source || !conn.target) return
  const sourceHandle = conn.sourceHandle ?? 'right'
  const srcPos = nodePosMap.value.get(conn.source) ?? { x: 0, y: 0 }
  const tgtPos = nodePosMap.value.get(conn.target) ?? { x: 0, y: 0 }
  const facing = facingTargetHandle(srcPos, tgtPos)
  const rawTarget = conn.targetHandle ?? facing
  // Redirect back-side drops: if user released on the handle facing away from the
  // source, snap to the facing handle instead. Any other explicit choice is kept.
  const targetHandle = rawTarget === OPPOSITE[facing] ? facing : rawTarget
  emit('connection', { sourceId: conn.source, targetId: conn.target, sourceHandle, targetHandle })
}

function onEdgeUpdate({ edge, connection: conn }: EdgeUpdateEvent) {
  if (!conn.source || !conn.target) return
  const sourceHandle = conn.sourceHandle ?? 'right'
  const srcPos = nodePosMap.value.get(conn.source) ?? { x: 0, y: 0 }
  const tgtPos = nodePosMap.value.get(conn.target) ?? { x: 0, y: 0 }
  const facing = facingTargetHandle(srcPos, tgtPos)
  const rawTarget = conn.targetHandle ?? facing
  const targetHandle = rawTarget === OPPOSITE[facing] ? facing : rawTarget
  emit('edge-update', edge.id, { sourceId: conn.source, targetId: conn.target, sourceHandle, targetHandle })
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
