export type NodeKind = 'role'

export interface GraphNode {
  id: string
  label: string
  kind: NodeKind
  isEntryPoint: boolean
  anyToAny: boolean
  multiplicityLabel: string  // "" = single instance, "×3" = fixed 3, "1–5" = dynamic
  position: { x: number; y: number }
  meta: Record<string, unknown>
}

export interface GraphEdge {
  id: string         // `${sourceId}->${targetId}`
  source: string
  target: string
  isBidirectional: boolean
}

export type GraphFlowMode = 'explicit' | 'any-to-any'

export interface GraphConnectionRequest {
  sourceId: string
  targetId: string
}

export interface GraphNodeClickEvent {
  nodeId: string
}

export interface GraphEdgeClickEvent {
  edgeId: string
}
