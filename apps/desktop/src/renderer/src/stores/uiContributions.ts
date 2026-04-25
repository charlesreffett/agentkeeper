import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { UIContribution, UISlot } from '@orchestral/sdk'

export const useUIContributionsStore = defineStore('uiContributions', () => {
  const slots = reactive(new Map<UISlot, UIContribution[]>())

  function contribute(slot: UISlot, contribution: UIContribution): () => void {
    const existing = slots.get(slot) ?? []
    slots.set(slot, [...existing, contribution])
    return () => {
      const current = slots.get(slot) ?? []
      slots.set(slot, current.filter((c) => c.id !== contribution.id))
    }
  }

  function getSlot(slot: UISlot): UIContribution[] {
    return [...(slots.get(slot) ?? [])].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  }

  return { contribute, getSlot }
})
