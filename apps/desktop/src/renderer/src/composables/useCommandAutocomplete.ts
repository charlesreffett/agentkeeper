import { ref, watch, computed } from 'vue'
import type { Ref } from 'vue'
import type { SlashCommand } from '@shared/ipc-contract'

export function useCommandAutocomplete(text: Ref<string>, projectPath: Ref<string>) {
  const allCommands = ref<SlashCommand[]>([])
  const selectedIndex = ref(-1)

  watch(
    projectPath,
    async (path) => {
      if (!path) return
      try {
        allCommands.value = await window.orchestral.commands.list(path)
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
    const prefix = slashPrefix.value
    if (prefix === null) return []
    return allCommands.value.filter((cmd) => cmd.id.toLowerCase().startsWith(prefix))
  })

  const isOpen = computed(() => slashPrefix.value !== null && suggestions.value.length > 0)

  watch(suggestions, () => {
    selectedIndex.value = -1
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
  }

  function resolveBody(cmd: SlashCommand): string {
    return cmd.body.replace(/\$ARGUMENTS/g, '').trim()
  }

  return { isOpen, suggestions, selectedIndex, moveUp, moveDown, selectIndex, close, resolveBody }
}
