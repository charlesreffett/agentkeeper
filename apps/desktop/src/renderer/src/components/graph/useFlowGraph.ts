import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { Agency, RoleSlot } from '../../../../shared/ipc-contract'
import type { GraphNode, GraphEdge, GraphFlowMode, GraphConnectionRequest } from './types'

const instanceIdPattern = /^(.+)-(\d+)$/

function getBaseRoleId(id: string): string {
  const m = instanceIdPattern.exec(id)
  return m ? m[1]! : id
}

function instanceCount(slot: RoleSlot): number {
  return slot.count ?? slot.min ?? 1
}

function roleHasMultiplicity(slot: RoleSlot): boolean {
  return (slot.count !== undefined && slot.count > 1) ||
    slot.min !== undefined ||
    slot.max !== undefined
}

export function useFlowGraph(
  agency: Ref<Agency | null>,
  saveAgency: (draft: Agency) => Promise<void>,
  deleteAgencyFn: () => Promise<void>,
) {
  const selectedNodeId = ref<string | null>(null)
  const selectedEdgeId = ref<string | null>(null)

  // Flows added optimistically before the async save + store-reload confirms them.
  const pendingFlows = ref<Array<[string, string, string?, string?]>>([])
  // Flows removed optimistically before the async save + store-reload drops them.
  const pendingRemovals = ref<Array<[string, string]>>([])
  // Roles removed optimistically before the async save + store-reload drops them.
  const pendingRoleRemovals = ref<Set<string>>(new Set())

  // Which role nodes are currently expanded to show per-instance nodes (UI-only, not persisted).
  const expandedRoles = ref<Set<string>>(new Set())

  // Reset pending and positions when the selected agency changes.
  watch(() => agency.value?.id, () => {
    pendingFlows.value = []
    pendingRemovals.value = []
    pendingRoleRemovals.value = new Set()
    expandedRoles.value = new Set()
    nodePositions.value = {}
  })

  // Once the store confirms pending additions/removals, clear the pending lists.
  watch(
    () => agency.value?.flows,
    (confirmed) => {
      if (!confirmed) return
      pendingFlows.value = pendingFlows.value.filter(
        ([src, tgt]) => !confirmed.some(([a, b]) => a === src && b === tgt),
      )
      pendingRemovals.value = pendingRemovals.value.filter(
        ([src, tgt]) => confirmed.some(([a, b]) => a === src && b === tgt),
      )
    },
    { deep: true },
  )

  // Drop confirmed role removals from pending once the saved agency reflects them.
  watch(
    () => agency.value?.roles,
    (confirmed) => {
      if (!confirmed) return
      const stillPresent = new Set(confirmed.map(r => r.roleId))
      const next = new Set<string>()
      for (const id of pendingRoleRemovals.value) {
        if (stillPresent.has(id)) next.add(id)
      }
      pendingRoleRemovals.value = next
    },
    { deep: true },
  )

  // Layout persistence: reset when agency changes
  const nodePositions = ref<Record<string, { x: number; y: number }>>({})

  // Merged view: confirmed flows minus pending removals, plus pending additions,
  // minus any flow referencing a role that is pending removal.
  const effectiveFlows = computed<Array<[string, string, string?, string?]>>(() => {
    const base = agency.value?.flows ?? []
    const withoutRemovals = base.filter(
      ([a, b]) => !pendingRemovals.value.some(([x, y]) => a === x && b === y),
    )
    const merged = [...withoutRemovals, ...pendingFlows.value]
    if (pendingRoleRemovals.value.size === 0) return merged
    // Filter out flows where either endpoint belongs to a role being removed.
    // Use getBaseRoleId so instance-level flows (e.g. "developer-2->reviewer-1")
    // are also pruned when the "developer" role is removed.
    return merged.filter(
      ([a, b]) =>
        !pendingRoleRemovals.value.has(getBaseRoleId(a)) &&
        !pendingRoleRemovals.value.has(getBaseRoleId(b)),
    )
  })

  // Agency snapshot with pending additions/removals applied — used by panels
  // that need immediate consistency with the graph canvas.
  const effectiveAgency = computed<Agency | null>(() => {
    if (!agency.value) return null
    if (pendingFlows.value.length === 0 && pendingRemovals.value.length === 0) return agency.value
    return { ...agency.value, flows: effectiveFlows.value }
  })

  const effectiveRoles = computed<RoleSlot[]>(() =>
    (agency.value?.roles ?? []).filter(r => !pendingRoleRemovals.value.has(r.roleId))
  )

  const nodes = computed<GraphNode[]>(() => {
    if (!agency.value) return []
    const anyToAny = effectiveFlows.value.length === 0
    const roles = effectiveRoles.value
    const result: GraphNode[] = []

    roles.forEach((slot, index) => {
      const isExpanded = expandedRoles.value.has(slot.roleId) && roleHasMultiplicity(slot)
      const expandable = roleHasMultiplicity(slot)

      if (isExpanded) {
        const count = instanceCount(slot)
        const roleBasePos = nodePositions.value[slot.roleId] ?? defaultPosition(index, roles.length)
        for (let i = 1; i <= count; i++) {
          const instanceId = `${slot.roleId}-${i}`
          result.push({
            id: instanceId,
            label: instanceId,
            kind: 'instance',
            isEntryPoint: agency.value!.entryPoints.includes(slot.roleId) && i === 1,
            anyToAny: false,
            multiplicityLabel: '',
            isExpandable: false,
            isExpanded: false,
            parentRoleId: slot.roleId,
            position: nodePositions.value[instanceId] ?? instancePosition(roleBasePos, i, count),
            meta: { slot },
          })
        }
      } else {
        result.push({
          id: slot.roleId,
          label: slot.roleId,
          kind: 'role',
          isEntryPoint: agency.value!.entryPoints.includes(slot.roleId),
          anyToAny,
          multiplicityLabel: buildMultiplicityLabel(slot),
          isExpandable: expandable,
          isExpanded: false,
          position: nodePositions.value[slot.roleId] ?? defaultPosition(index, roles.length),
          meta: { slot },
        })
      }
    })

    return result
  })

  const edges = computed<GraphEdge[]>(() => {
    const flows = effectiveFlows.value
    const activeIds = new Set(nodes.value.map(n => n.id))

    // Resolve a flow endpoint (role id or instance id) to the node IDs visible
    // in the current graph state. If a role is expanded its role node is gone —
    // fan out to all its visible instance nodes instead. If an instance id's
    // role is collapsed, collapse it back to the role node id.
    function resolveEndpoint(id: string): string[] {
      if (activeIds.has(id)) return [id]
      const m = instanceIdPattern.exec(id)
      if (m) {
        // Instance id but role not expanded — collapse to role node
        const roleId = m[1]!
        return activeIds.has(roleId) ? [roleId] : []
      }
      // Role id but role is expanded — fan out to all its instance nodes
      const instances = nodes.value.filter(n => n.parentRoleId === id).map(n => n.id)
      return instances.length > 0 ? instances : []
    }

    const allEdges: GraphEdge[] = []
    const seen = new Set<string>()

    for (const [src, tgt, srcHandle, tgtHandle] of flows) {
      const sources = resolveEndpoint(src)
      const targets = resolveEndpoint(tgt)
      for (const s of sources) {
        for (const t of targets) {
          if (s === t) continue
          const id = `${s}->${t}`
          if (!seen.has(id)) {
            seen.add(id)
            allEdges.push({ id, source: s, target: t, sourceHandle: srcHandle, targetHandle: tgtHandle })
          }
        }
      }
    }

    return allEdges
  })

  const flowMode = computed<GraphFlowMode>(() =>
    effectiveFlows.value.length === 0 ? 'any-to-any' : 'explicit'
  )

  // Resolve selectedNodeId to a RoleSlot — works for both role nodes and instance nodes.
  const selectedRoleSlot = computed<RoleSlot | null>(() => {
    if (!selectedNodeId.value || !agency.value) return null
    const direct = agency.value.roles.find(r => r.roleId === selectedNodeId.value)
    if (direct) return direct
    const m = instanceIdPattern.exec(selectedNodeId.value)
    if (m) return agency.value.roles.find(r => r.roleId === m[1]!) ?? null
    return null
  })

  const selectedEdge = computed<GraphEdge | null>(() => {
    if (!selectedEdgeId.value) return null
    return edges.value.find(e => e.id === selectedEdgeId.value) ?? null
  })

  function selectNode(id: string | null) {
    selectedNodeId.value = id
    selectedEdgeId.value = null
  }

  function selectEdge(id: string | null) {
    selectedEdgeId.value = id
    selectedNodeId.value = null
  }

  function clearSelection() {
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  function updateNodePosition(nodeId: string, position: { x: number; y: number }) {
    nodePositions.value = { ...nodePositions.value, [nodeId]: position }
  }

  function toggleExpanded(roleId: string) {
    const next = new Set(expandedRoles.value)
    if (next.has(roleId)) {
      next.delete(roleId)
      // Deselect any instance node that belonged to this role
      if (selectedNodeId.value && getBaseRoleId(selectedNodeId.value) === roleId) {
        clearSelection()
      }
    } else {
      next.add(roleId)
    }
    expandedRoles.value = next
  }

  async function addConnection(req: GraphConnectionRequest) {
    if (!agency.value) return
    if (req.sourceId === req.targetId) return
    const exists = effectiveFlows.value.some(([a, b]) => a === req.sourceId && b === req.targetId)
    if (exists) return
    // Optimistic update: edge appears immediately via vfEdges / pendingFlows.
    pendingFlows.value = [...pendingFlows.value, [req.sourceId, req.targetId, req.sourceHandle, req.targetHandle]]
    // Build draft from effectiveFlows (confirmed minus removals plus pending) so
    // rapid successive connections don't drop each other, and so we never save
    // stale confirmed-only flows that predate other in-flight additions.
    // Strip undefined handle entries so YAML doesn't emit null placeholders.
    const flows = effectiveFlows.value.map(([a, b, sh, th]) => {
      const entry: [string, string, string?, string?] = [a, b]
      if (sh) entry[2] = sh
      if (th) entry[3] = th
      return entry
    })
    const draft = { ...agency.value, flows }
    try {
      await saveAgency(draft)
    } catch (err) {
      console.error('[useFlowGraph] addConnection save failed:', err)
      pendingFlows.value = pendingFlows.value.filter(
        ([a, b]) => !(a === req.sourceId && b === req.targetId),
      )
    }
  }

  async function updateConnection(oldEdgeId: string, req: GraphConnectionRequest) {
    if (!agency.value) return
    if (req.sourceId === req.targetId) return
    const [oldSrc, oldTgt] = oldEdgeId.split('->')
    if (!oldSrc || !oldTgt) return
    // Bail if the new target already exists (and it isn't the edge being replaced)
    if (!(oldSrc === req.sourceId && oldTgt === req.targetId)) {
      if (effectiveFlows.value.some(([a, b]) => a === req.sourceId && b === req.targetId)) return
    }
    // Optimistic: pull old out of pending additions, mark as removal, add new
    pendingFlows.value = pendingFlows.value.filter(([a, b]) => !(a === oldSrc && b === oldTgt))
    if (!pendingRemovals.value.some(([a, b]) => a === oldSrc && b === oldTgt)) {
      pendingRemovals.value = [...pendingRemovals.value, [oldSrc, oldTgt]]
    }
    pendingFlows.value = [...pendingFlows.value, [req.sourceId, req.targetId, req.sourceHandle, req.targetHandle]]
    const flows = effectiveFlows.value.map(([a, b, sh, th]) => {
      const entry: [string, string, string?, string?] = [a, b]
      if (sh) entry[2] = sh
      if (th) entry[3] = th
      return entry
    })
    const draft = { ...agency.value, flows }
    try {
      await saveAgency(draft)
    } catch (err) {
      console.error('[useFlowGraph] updateConnection save failed:', err)
      pendingRemovals.value = pendingRemovals.value.filter(([a, b]) => !(a === oldSrc && b === oldTgt))
      pendingFlows.value = pendingFlows.value.filter(([a, b]) => !(a === req.sourceId && b === req.targetId))
    }
  }

  async function removeConnection(edgeId: string) {
    if (!agency.value) return
    const parts = edgeId.split('->')
    const src = parts[0]
    const tgt = parts[1]
    if (!src || !tgt) return
    // Optimistic: drop from pending additions (if it was just added) and mark
    // as a pending removal so effectiveFlows hides it immediately.
    pendingFlows.value = pendingFlows.value.filter(([a, b]) => !(a === src && b === tgt))
    const alreadyPending = pendingRemovals.value.some(([a, b]) => a === src && b === tgt)
    if (!alreadyPending) {
      pendingRemovals.value = [...pendingRemovals.value, [src, tgt] as [string, string]]
    }
    if (selectedEdgeId.value === edgeId) clearSelection()
    const draft = { ...agency.value, flows: effectiveFlows.value.filter(([a, b]) => !(a === src && b === tgt)) }
    await saveAgency(draft)
  }

  async function flipConnection(edgeId: string) {
    if (!agency.value) return
    const [src, tgt] = edgeId.split('->')
    const without = agency.value.flows.filter(([a, b]) => !(a === src && b === tgt))
    const alreadyHasReverse = without.some(([a, b]) => a === tgt && b === src)
    const newFlows = alreadyHasReverse ? without : [...without, [tgt, src] as [string, string]]
    const draft = { ...agency.value, flows: newFlows }
    await saveAgency(draft)
  }

  async function addRole(roleId: string) {
    if (!agency.value) return
    if (agency.value.roles.some(r => r.roleId === roleId)) return
    const newRoles = [...agency.value.roles, { roleId }]
    const newEntries = agency.value.entryPoints.length === 0
      ? [roleId]
      : agency.value.entryPoints
    const draft = { ...agency.value, roles: newRoles, entryPoints: newEntries }
    await saveAgency(draft)
  }

  async function removeRole(roleId: string) {
    if (!agency.value) return
    if (!agency.value.roles.some(r => r.roleId === roleId)) return

    const isOnlyEntryPoint =
      agency.value.entryPoints.includes(roleId) &&
      agency.value.entryPoints.length === 1

    if (isOnlyEntryPoint) {
      toast.error('Cannot remove entry point', {
        description: 'Mark another role as the entry point before removing this one.',
      })
      return
    }

    // Optimistic: mark removed and prune pending flows referencing the role
    // (including instance-level flows like "developer-2->reviewer-1").
    pendingRoleRemovals.value = new Set([...pendingRoleRemovals.value, roleId])
    pendingFlows.value = pendingFlows.value.filter(
      ([a, b]) => getBaseRoleId(a) !== roleId && getBaseRoleId(b) !== roleId,
    )
    if (selectedNodeId.value && getBaseRoleId(selectedNodeId.value) === roleId) clearSelection()

    const newRoles = agency.value.roles.filter(r => r.roleId !== roleId)
    const newFlows = (agency.value.flows ?? []).filter(
      ([a, b]) => getBaseRoleId(a) !== roleId && getBaseRoleId(b) !== roleId,
    )
    const newEntries = agency.value.entryPoints.filter(id => id !== roleId)
    const draft = { ...agency.value, roles: newRoles, flows: newFlows, entryPoints: newEntries }
    try {
      await saveAgency(draft)
    } catch (err) {
      console.error('[useFlowGraph] removeRole save failed:', err)
      const next = new Set(pendingRoleRemovals.value)
      next.delete(roleId)
      pendingRoleRemovals.value = next
    }
  }

  async function toggleEntryPoint(roleId: string) {
    if (!agency.value) return
    const isEntry = agency.value.entryPoints.includes(roleId)
    const newEntries = isEntry
      ? agency.value.entryPoints.filter(id => id !== roleId)
      : [...agency.value.entryPoints, roleId]
    if (newEntries.length === 0) return  // must have at least one entry point
    const draft = { ...agency.value, entryPoints: newEntries }
    await saveAgency(draft)
  }

  async function updateInstanceCount(
    roleId: string,
    mode: 'fixed' | 'dynamic',
    opts: { count?: number; min?: number; max?: number }
  ) {
    if (!agency.value) return
    const newRoles = agency.value.roles.map(slot => {
      if (slot.roleId !== roleId) return slot
      if (mode === 'fixed') {
        const count = opts.count ?? 1
        return count <= 1 ? { roleId } : { roleId, count }
      }
      return { roleId, min: opts.min ?? 1, max: opts.max ?? 2 }
    })
    const draft = { ...agency.value, roles: newRoles }
    await saveAgency(draft)
  }

  async function deleteAgency() {
    await deleteAgencyFn()
  }

  function onWindowKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return
    if (selectedNodeId.value) {
      // Instance nodes can't be deleted individually — delete their parent role
      // only if the user selected the role node itself (kind === 'role').
      const node = nodes.value.find(n => n.id === selectedNodeId.value)
      if (node?.kind === 'instance') return  // no-op; use the role panel
      e.preventDefault()
      removeRole(selectedNodeId.value)
    } else if (selectedEdgeId.value) {
      e.preventDefault()
      removeConnection(selectedEdgeId.value)
    }
  }

  onMounted(() => window.addEventListener('keydown', onWindowKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onWindowKeyDown))

  return {
    nodes, edges, flowMode,
    effectiveAgency,
    expandedRoles,
    selectedNodeId, selectedEdgeId,
    selectedRoleSlot, selectedEdge,
    selectNode, selectEdge, clearSelection,
    updateNodePosition,
    toggleExpanded,
    addConnection, updateConnection, removeConnection, flipConnection,
    toggleEntryPoint, updateInstanceCount,
    addRole, removeRole,
    deleteAgency,
  }
}

function buildMultiplicityLabel(slot: RoleSlot): string {
  if (slot.count !== undefined) return `×${slot.count}`
  if (slot.min !== undefined && slot.max !== undefined) return `${slot.min}–${slot.max}`
  return ''
}

function defaultPosition(index: number, total: number): { x: number; y: number } {
  // Arrange in a circle
  const radius = Math.max(120, total * 40)
  const angle = (2 * Math.PI * index) / total - Math.PI / 2
  return {
    x: 300 + radius * Math.cos(angle),
    y: 200 + radius * Math.sin(angle),
  }
}

/** Place instance nodes in a horizontal row centred on the role's position. */
function instancePosition(
  rolePos: { x: number; y: number },
  index: number,
  total: number,
): { x: number; y: number } {
  const spacing = 160
  const startX = rolePos.x - (spacing * (total - 1)) / 2
  return { x: startX + spacing * (index - 1), y: rolePos.y }
}
