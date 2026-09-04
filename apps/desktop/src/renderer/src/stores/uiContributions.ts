import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { UIContribution, UISlot } from '@agentkeeper/sdk'

const UI_SLOTS = new Set<UISlot>([
  'sidebar.primary',
  'session.detail.tabs',
  'worktree.toolbar',
  'commandPalette',
  'settingsPanels',
  'roleTemplates',
])

type OwnedContribution = UIContribution & { pluginId: string; registrationId: string }

function isContribution(value: unknown): value is UIContribution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const contribution = value as Record<string, unknown>
  return typeof contribution.id === 'string' && contribution.id.length > 0 && contribution.id.length <= 256
    && (contribution.label === undefined || (typeof contribution.label === 'string' && contribution.label.length <= 512))
    && (contribution.icon === undefined || (typeof contribution.icon === 'string' && contribution.icon.length <= 256))
    && (contribution.order === undefined || (typeof contribution.order === 'number' && Number.isFinite(contribution.order)))
}

export const useUIContributionsStore = defineStore('uiContributions', () => {
  const slots = reactive(new Map<UISlot, OwnedContribution[]>())

  function contribute(pluginId: string, registrationId: string, slot: string, value: unknown): () => void {
    if (!pluginId || pluginId.length > 256 || !registrationId || registrationId.length > 256
      || !UI_SLOTS.has(slot as UISlot) || !isContribution(value)) {
      return () => {}
    }
    const typedSlot = slot as UISlot
    const contribution: OwnedContribution = { ...value, pluginId, registrationId }
    const existing = slots.get(typedSlot) ?? []
    // A reload may re-send contributions before the old renderer state has
    // settled. Upsert by owner and id so duplicates cannot accumulate.
    slots.set(typedSlot, [
      ...existing.filter(candidate => candidate.pluginId !== pluginId
        || (candidate.id !== contribution.id && candidate.registrationId !== registrationId)),
      contribution,
    ])
    return () => {
      remove(pluginId, registrationId)
    }
  }

  function remove(pluginId: string, registrationId: string): void {
    for (const [slot, contributions] of slots) {
      const retained = contributions.filter(contribution => contribution.pluginId !== pluginId
        || contribution.registrationId !== registrationId)
      if (retained.length > 0) slots.set(slot, retained)
      else slots.delete(slot)
    }
  }

  function revokePlugin(pluginId: string): void {
    for (const [slot, contributions] of slots) {
      const retained = contributions.filter(contribution => contribution.pluginId !== pluginId)
      if (retained.length > 0) slots.set(slot, retained)
      else slots.delete(slot)
    }
  }

  function getSlot(slot: UISlot): UIContribution[] {
    return [...(slots.get(slot) ?? [])]
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map(({ pluginId: _, registrationId: __, ...contribution }) => contribution)
  }

  return { contribute, remove, revokePlugin, getSlot }
})
