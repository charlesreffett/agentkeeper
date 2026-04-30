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
      :connection-line-component="FloatingConnectionLine"
      @connect="onConnect"
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
import { VueFlow, MarkerType, useVueFlow } from '@vue-flow/core'
import { useLayoutStore } from '@/stores/layout'
import type {
  Node as VFNode,
  Edge as VFEdge,
  NodeMouseEvent,
  EdgeMouseEvent,
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
import FloatingEdge from './FloatingEdge.vue'
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
  (e: 'pane-click'): void
  (e: 'node-move', nodeId: string, position: { x: number; y: number }): void
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
const nodeTypes: Record<string, any> = { role: markRaw(AgencyRoleNode) }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: Record<string, any> = { floating: markRaw(FloatingEdge) }

const defaultEdgeOptions = {
  type: 'floating',
  markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8' },
  style: { stroke: '#38bdf8', strokeWidth: 2 },
  animated: false,
}

const vfNodes = computed<VFNode[]>(() =>
  props.nodes.map(n => ({
    id: n.id,
    type: 'role',
    position: n.position,
    selected: n.id === props.selectedNodeId,
    data: {
      label: n.label,
      isEntryPoint: n.isEntryPoint,
      anyToAny: n.anyToAny,
      multiplicityLabel: n.multiplicityLabel,
    },
  }))
)

const vfEdges = computed<VFEdge[]>(() =>
  props.edges.map(e => {
    const isSelected = e.id === props.selectedEdgeId
    // Bidirectional edges use indigo; directed edges use sky (target/incoming colour)
    const baseColor = e.isBidirectional ? '#818cf8' : '#38bdf8'
    const selectedColor = e.isBidirectional ? '#a5b4fc' : '#7dd3fc'
    const stroke = isSelected ? selectedColor : baseColor
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      selected: isSelected,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      markerStart: e.isBidirectional
        ? { type: MarkerType.ArrowClosed, color: stroke }
        : undefined,
      style: { stroke, strokeWidth: isSelected ? 3 : 2 },
    }
  })
)

function onConnect(conn: Connection) {
  if (conn.source && conn.target) {
    emit('connection', { sourceId: conn.source, targetId: conn.target })
  }
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
