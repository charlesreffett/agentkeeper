import { ref, watch, computed } from 'vue'
import type { Ref } from 'vue'
import type { SlashCommand } from '@shared/ipc-contract'

export function useCommandAutocomplete(text: Ref<string>, projectPath: Ref<string>) {
  const allCommands = ref<SlashCommand[]>([])
  const selectedIndex = ref(-1)
  const forceOpen = ref(false)

  watch(
    projectPath,
    async (path) => {
      if (!path) return
      try {
        allCommands.value = await window.agentkeeper.commands.list(path)
      } catch {
        allCommands.value = []
      }
    },
    { immediate: true },
  )

  const slashPrefix = computed<string | null>(() => {
    const v = text.value
    if (!v.startsWith('/')) return null
    const word = v.slice(1)
    if (word.includes(' ') || word.includes('\n')) return null
    return word.toLowerCase()
  })

  const suggestions = computed<SlashCommand[]>(() => {
    if (forceOpen.value) return allCommands.value
    const prefix = slashPrefix.value
    if (prefix === null) return []
    return allCommands.value.filter((cmd) => cmd.id.toLowerCase().startsWith(prefix))
  })

  const isOpen = computed(
    () =>
      (forceOpen.value && allCommands.value.length > 0) ||
      (slashPrefix.value !== null && suggestions.value.length > 0),
  )

  watch(suggestions, () => {
    selectedIndex.value = -1
  })

  // Drop out of force-open the instant the user types; prefix filter takes over
  watch(text, () => {
    if (forceOpen.value) forceOpen.value = false
  })

  function moveUp() {
    if (!isOpen.value) return
    selectedIndex.value =
      selectedIndex.value <= 0 ? suggestions.value.length - 1 : selectedIndex.value - 1
  }

  function moveDown() {
    if (!isOpen.value) return
    selectedIndex.value =
      selectedIndex.value >= suggestions.value.length - 1 ? 0 : selectedIndex.value + 1
  }

  function selectIndex(i: number): SlashCommand | null {
    return suggestions.value[i] ?? null
  }

  function close() {
    selectedIndex.value = -1
    forceOpen.value = false
  }

  function openAll() {
    forceOpen.value = true
    selectedIndex.value = -1
  }

  function resolveBody(cmd: SlashCommand): string {
    return cmd.body.replace(/\$ARGUMENTS/g, '').trim()
  }

  return { isOpen, suggestions, selectedIndex, moveUp, moveDown, selectIndex, close, openAll, resolveBody }
}
