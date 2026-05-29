export type NodeKind = 'role' | 'instance'

export interface GraphNode {
  id: string
  label: string
  kind: NodeKind
  isEntryPoint: boolean
  anyToAny: boolean
  multiplicityLabel: string  // "" = single instance, "×3" = fixed 3, "1–5" = dynamic
  /** Role node can be expanded into per-instance nodes */
  isExpandable: boolean
  /** Role is currently shown as individual instance nodes */
  isExpanded: boolean
  /** Set on instance nodes; the roleId they belong to */
  parentRoleId?: string
  position: { x: number; y: number }
  meta: Record<string, unknown>
}

export interface GraphEdge {
  id: string         // `${sourceId}->${targetId}`
  source: string
  target: string
  isBidirectional: boolean
  sourceHandle?: string
  targetHandle?: string
}

export type GraphFlowMode = 'explicit' | 'any-to-any'

export interface GraphConnectionRequest {
  sourceId: string
  targetId: string
  sourceHandle?: string
  targetHandle?: string
}

export interface GraphNodeClickEvent {
  nodeId: string
}

export interface GraphEdgeClickEvent {
  edgeId: string
}
