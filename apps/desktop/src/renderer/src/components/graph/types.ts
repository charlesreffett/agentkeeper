export type NodeKind = 'role' | 'instance' | 'elastic-group'

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
  /** Configured elastic capacity that has not been provisioned as a warm instance. */
  isElasticCapacity?: boolean
  /** Visual-only dimensions for a non-interactive elastic-capacity group. */
  dimensions?: { width: number; height: number }
  position: { x: number; y: number }
  meta: Record<string, unknown>
}

export interface GraphEdge {
  id: string         // `${sourceId}->${targetId}`
  source: string
  target: string
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
