<template>
  <div class="w-full h-full">
    <VueFlow
      id="agency-flow"
      :nodes="vfNodes"
      :edges="vfEdges"
      :node-types="nodeTypes"
      :fit-view-on-init="fitOnLoad"
      :delete-key-code="['Backspace', 'Delete']"
      class="bg-background"
      :default-edge-options="defaultEdgeOptions"
      :connect-on-click="false"
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

// Accessed by ID so addEdges can be called from the parent without inject context.
// useVueFlow('agency-flow') registers the store before <VueFlow id="agency-flow"> mounts;
// they share the same store instance.
const { addEdges } = useVueFlow('agency-flow')

// Cast to bypass strict NodeComponent type mismatch — our component satisfies
// the runtime contract but Vue Flow's generic NodeProps don't align with defineProps<...>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: Record<string, any> = { role: markRaw(AgencyRoleNode) }

const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
  style: { stroke: '#6366f1', strokeWidth: 2 },
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
  props.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    selected: e.id === props.selectedEdgeId,
    markerEnd: e.isBidirectional
      ? undefined
      : { type: MarkerType.ArrowClosed, color: '#6366f1' },
    markerStart: e.isBidirectional
      ? { type: MarkerType.ArrowClosed, color: '#6366f1' }
      : undefined,
    style: {
      stroke: e.id === props.selectedEdgeId ? '#818cf8' : '#6366f1',
      strokeWidth: e.id === props.selectedEdgeId ? 3 : 2,
    },
  }))
)

function onConnect(conn: Connection) {
  if (conn.source && conn.target) {
    // Add to Vue Flow's internal state immediately so the edge renders without
    // waiting for the async save → store reload → prop update cycle.
    // defaultEdgeOptions (type, markerEnd, style) are applied automatically.
    // The `:edges` prop update after the save reconciles the final state.
    addEdges([{ id: `${conn.source}->${conn.target}`, source: conn.source, target: conn.target }])
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
