import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useRightPanelStore = defineStore('rightPanel', () => {
  const activeTab = ref<'files' | 'git'>('files')
  const triggerGitAnalyze = ref(0)

  function openGitChanges() {
    activeTab.value = 'git'
    triggerGitAnalyze.value++
  }

  return { activeTab, triggerGitAnalyze, openGitChanges }
})
