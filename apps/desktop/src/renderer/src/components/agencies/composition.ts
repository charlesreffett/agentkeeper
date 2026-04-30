import type { RoleSlot } from '../../../../shared/ipc-contract'

export interface AgencyComposition {
  roles: RoleSlot[]
  flows: Array<[string, string]>
  entryPoints: string[]
}

export function emptyComposition(): AgencyComposition {
  return { roles: [], flows: [], entryPoints: [] }
}

export function multiplicityLabel(slot: RoleSlot): string {
  if (slot.count !== undefined) return `×${slot.count}`
  if (slot.min !== undefined && slot.max !== undefined) return `${slot.min}–${slot.max}`
  return '×1'
}

export type SlotMode = 'single' | 'fixed' | 'dynamic'

export function slotMode(slot: RoleSlot): SlotMode {
  if (slot.count !== undefined) return 'fixed'
  if (slot.min !== undefined || slot.max !== undefined) return 'dynamic'
  return 'single'
}
