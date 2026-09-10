<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import AppLayout from '@/components/AppLayout.vue'
import { Toaster } from '@/components/ui/sonner'
import QueryDevtools from '@/components/QueryDevtools.vue'
import { useLayoutStore } from '@/stores/layout'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { queryKeys } from '@/lib/queryKeys'
import PluginInstallModal from '@/views/plugins/PluginInstallModal.vue'
import type { PluginManifest } from '@agentkeeper/sdk'

const isDev = import.meta.env.DEV

const layoutStore = useLayoutStore()
const uiStore = useUIContributionsStore()
const queryClient = useQueryClient()

let cleanupOpenFile: (() => void) | null = null
let cleanupUiContribution: (() => void) | null = null
let cleanupPluginLifecycle: (() => void) | null = null
const openFileManifest = ref<PluginManifest | null>(null)
const openFileToken = ref<string | null>(null)
const confirmingOpenFile = ref(false)

function closeOpenFileReview() {
  if (openFileToken.value) void window.agentkeeper.plugins.cancelAkpInstall(openFileToken.value)
  openFileToken.value = null
  openFileManifest.value = null
}

async function confirmOpenFileInstall() {
  if (!openFileToken.value || confirmingOpenFile.value) return
  confirmingOpenFile.value = true
  const token = openFileToken.value
  try {
    await window.agentkeeper.plugins.confirmAkpInstall(token)
    openFileToken.value = null
    openFileManifest.value = null
    toast.success('Plugin installed')
    void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
  } catch (error) {
    toast.error('Plugin installation failed', { description: error instanceof Error ? error.message : String(error) })
  } finally {
    confirmingOpenFile.value = false
  }
}

onMounted(async () => {
  const settings = await window.agentkeeper.settings.get()
  layoutStore.initTheme(settings.theme ?? 'dark')

  // Global handler: install .akp files opened via Finder or second-instance argv
  cleanupOpenFile = window.agentkeeper.plugins.onOpenFile(async (filePath) => {
    try {
      closeOpenFileReview()
      const pending = await window.agentkeeper.plugins.prepareAkpInstall({ filePath })
      openFileToken.value = pending.token
      openFileManifest.value = pending.manifest
    } catch (e) {
      toast.error('Could not review plugin package', { description: e instanceof Error ? e.message : String(e) })
    }
  })

  cleanupUiContribution = window.agentkeeper.plugins.onUiContribution((data) => {
    const message = data as unknown as {
      action?: 'add' | 'remove'
      pluginId?: string
      registrationId?: string
      slot?: string
      contribution?: unknown
    }
    if (!message.pluginId) return
    if (message.action === 'remove' && message.registrationId) {
      uiStore.remove(message.pluginId, message.registrationId)
      return
    }
    if (!message.slot || message.contribution === undefined) return
    const contributionId = typeof message.contribution === 'object' && message.contribution !== null
      ? String((message.contribution as { id?: unknown }).id ?? '')
      : ''
    const registrationId = message.registrationId ?? `${message.slot}:${contributionId}`
    uiStore.contribute(message.pluginId, registrationId, message.slot, message.contribution)
  })

  cleanupPluginLifecycle = window.agentkeeper.plugins.onEvent((event, payload) => {
    // Keep contributions (especially Settings) mounted while unhealthy so a
    // user can repair missing or invalid plugin credentials.
    if (event !== 'plugin.deactivated' && event !== 'plugin.uninstalled') return
    const pluginId = (payload as { pluginId?: unknown })?.pluginId
    if (typeof pluginId === 'string') uiStore.revokePlugin(pluginId)
  })
})

onUnmounted(() => {
  closeOpenFileReview()
  cleanupOpenFile?.()
  cleanupUiContribution?.()
  cleanupPluginLifecycle?.()
})
</script>

<template>
  <AppLayout />
  <Toaster :theme="layoutStore.theme" />
  <PluginInstallModal
    v-if="openFileManifest"
    :open="true"
    :manifest="openFileManifest"
    @update:open="(open) => { if (!open) closeOpenFileReview() }"
    @confirm="confirmOpenFileInstall"
  />
  <QueryDevtools v-if="isDev" />
</template>
