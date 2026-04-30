import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { Agency, RoleSlot } from '../../../../shared/ipc-contract'
import type { GraphNode, GraphEdge, GraphFlowMode, GraphConnectionRequest } from './types'

export function useFlowGraph(
  agency: Ref<Agency | null>,
  saveAgency: (draft: Agency) => Promise<void>,
  deleteAgencyFn: () => Promise<void>,
) {
  const selectedNodeId = ref<string | null>(null)
  const selectedEdgeId = ref<string | null>(null)

  // Flows added optimistically before the async save + store-reload confirms them.
  const pendingFlows = ref<Array<[string, string]>>([])
  // Flows removed optimistically before the async save + store-reload drops them.
  const pendingRemovals = ref<Array<[string, string]>>([])
  // Roles removed optimistically before the async save + store-reload drops them.
  const pendingRoleRemovals = ref<Set<string>>(new Set())

  // Reset pending and positions when the selected agency changes.
  watch(() => agency.value?.id, () => {
    pendingFlows.value = []
    pendingRemovals.value = []
    pendingRoleRemovals.value = new Set()
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
  const effectiveFlows = computed<Array<[string, string]>>(() => {
    const base = agency.value?.flows ?? []
    const withoutRemovals = base.filter(
      ([a, b]) => !pendingRemovals.value.some(([x, y]) => a === x && b === y),
    )
    const merged = [...withoutRemovals, ...pendingFlows.value]
    if (pendingRoleRemovals.value.size === 0) return merged
    return merged.filter(
      ([a, b]) => !pendingRoleRemovals.value.has(a) && !pendingRoleRemovals.value.has(b),
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
    return roles.map((slot, index) => ({
      id: slot.roleId,
      label: slot.roleId,
      kind: 'role' as const,
      isEntryPoint: agency.value!.entryPoints.includes(slot.roleId),
      anyToAny,
      multiplicityLabel: buildMultiplicityLabel(slot),
      position: nodePositions.value[slot.roleId] ?? defaultPosition(index, roles.length),
      meta: { slot },
    }))
  })

  const edges = computed<GraphEdge[]>(() => {
    const flows = effectiveFlows.value
    return flows.map(([src, tgt]) => ({
      id: `${src}->${tgt}`,
      source: src,
      target: tgt,
      isBidirectional: flows.some(([a, b]) => a === tgt && b === src),
    }))
  })

  const flowMode = computed<GraphFlowMode>(() =>
    effectiveFlows.value.length === 0 ? 'any-to-any' : 'explicit'
  )

  const selectedRoleSlot = computed<RoleSlot | null>(() => {
    if (!selectedNodeId.value || !agency.value) return null
    return agency.value.roles.find(r => r.roleId === selectedNodeId.value) ?? null
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

  async function addConnection(req: GraphConnectionRequest) {
    if (!agency.value) return
    if (req.sourceId === req.targetId) return
    const exists = effectiveFlows.value.some(([a, b]) => a === req.sourceId && b === req.targetId)
    if (exists) return
    // Optimistic update: edge appears immediately via vfEdges / pendingFlows.
    pendingFlows.value = [...pendingFlows.value, [req.sourceId, req.targetId]]
    // Build draft from effectiveFlows (confirmed minus removals plus pending) so
    // rapid successive connections don't drop each other, and so we never save
    // stale confirmed-only flows that predate other in-flight additions.
    const flows = effectiveFlows.value.map(([a, b]) => [a, b] as [string, string])
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

    // Optimistic: mark removed and prune pending flows referencing the role.
    pendingRoleRemovals.value = new Set([...pendingRoleRemovals.value, roleId])
    pendingFlows.value = pendingFlows.value.filter(
      ([a, b]) => a !== roleId && b !== roleId,
    )
    if (selectedNodeId.value === roleId) clearSelection()

    const newRoles = agency.value.roles.filter(r => r.roleId !== roleId)
    const newFlows = (agency.value.flows ?? []).filter(
      ([a, b]) => a !== roleId && b !== roleId,
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
    selectedNodeId, selectedEdgeId,
    selectedRoleSlot, selectedEdge,
    selectNode, selectEdge, clearSelection,
    updateNodePosition,
    addConnection, removeConnection, flipConnection,
    toggleEntryPoint, updateInstanceCount,
    removeRole,
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
