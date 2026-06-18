import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface TerminalTab {
  key: string
  ptyId: string | null
  title: string
  epoch: number
}

export const useTerminalStore = defineStore('terminal', () => {
  const isOpen = ref(false)
  const height = ref(240)
  const tabs = ref<TerminalTab[]>([])
  const activeKey = ref<string | null>(null)
  const focused = ref(false)

  function toggle() { isOpen.value = !isOpen.value }
  function setFocused(v: boolean) { focused.value = v }
  function setHeight(h: number) { height.value = Math.max(100, Math.min(h, 600)) }

  // "Proj", then "Proj 2", "Proj 3", … — lowest free suffix for the base name.
  function titleFor(base: string): string {
    if (!tabs.value.some(t => t.title === base)) return base
    let i = 2
    while (tabs.value.some(t => t.title === `${base} ${i}`)) i++
    return `${base} ${i}`
  }

  function addTab(base: string): TerminalTab {
    const tab: TerminalTab = {
      key: crypto.randomUUID(),
      ptyId: null,
      title: titleFor(base || 'Terminal'),
      epoch: 0,
    }
    tabs.value.push(tab)
    activeKey.value = tab.key
    return tab
  }

  function renameTab(key: string, title: string): void {
    const t = tabs.value.find(t => t.key === key)
    const trimmed = title.trim()
    if (t && trimmed) t.title = trimmed
  }

  function setPtyId(key: string, ptyId: string | null): void {
    const t = tabs.value.find(t => t.key === key)
    if (t) t.ptyId = ptyId
  }

  function removeTab(key: string): TerminalTab | null {
    const idx = tabs.value.findIndex(t => t.key === key)
    if (idx === -1) return null
    const removed = tabs.value.splice(idx, 1)[0] ?? null
    if (activeKey.value === key) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
      activeKey.value = next?.key ?? null
    }
    if (tabs.value.length === 0) isOpen.value = false
    return removed
  }

  // Detaches the old pty (caller kills it) and forces a fresh instance via epoch bump.
  function restartTab(key: string): string | null {
    const t = tabs.value.find(t => t.key === key)
    if (!t) return null
    const old = t.ptyId
    t.ptyId = null
    t.epoch++
    return old
  }

  function setActive(key: string): void { activeKey.value = key }

  return {
    isOpen, height, tabs, activeKey, focused,
    toggle, setFocused, setHeight, titleFor, addTab, renameTab, setPtyId, removeTab, restartTab, setActive,
  }
})
