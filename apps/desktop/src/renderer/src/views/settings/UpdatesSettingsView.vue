<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { AppUpdateState } from '@shared/ipc-contract'
import { Button } from '@/components/ui/button'
import SettingsPage from '@/components/settings/SettingsPage.vue'

const update = ref<AppUpdateState | null>(null)
let removeListener: (() => void) | null = null

onMounted(async () => {
  update.value = await window.agentkeeper.appUpdates.getState()
  removeListener = window.agentkeeper.appUpdates.onStateChanged(value => { update.value = value })
})
onUnmounted(() => removeListener?.())

async function check() { update.value = await window.agentkeeper.appUpdates.check() }
async function download() {
  try { await window.agentkeeper.appUpdates.download() }
  catch (error) { toast.error('Update download failed', { description: error instanceof Error ? error.message : String(error) }) }
}
function install() { void window.agentkeeper.appUpdates.install() }
</script>

<template>
  <SettingsPage title="Updates" description="Check for and install new AgentKeeper releases.">
    <section v-if="update" class="space-y-3" aria-labelledby="updates-heading">
      <h2 id="updates-heading" class="text-sm font-semibold">AgentKeeper updates</h2>
      <div class="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">Version {{ update.currentVersion }}</p>
          <p class="mt-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            <template v-if="update.status === 'unsupported'">{{ update.message }}</template>
            <template v-else-if="update.status === 'checking'">Checking for updates…</template>
            <template v-else-if="update.status === 'available'">Version {{ update.availableVersion }} is available.</template>
            <template v-else-if="update.status === 'downloading'">Downloading {{ update.availableVersion }}… {{ update.progressPercent ?? 0 }}%</template>
            <template v-else-if="update.status === 'downloaded'">Version {{ update.availableVersion }} is ready to install.</template>
            <template v-else-if="update.status === 'up-to-date'">AgentKeeper is up to date.</template>
            <template v-else-if="update.status === 'error'">{{ update.message ?? 'Update check failed.' }}</template>
            <template v-else>Updates are checked shortly after startup.</template>
          </p>
        </div>
        <Button v-if="update.status === 'available'" size="sm" @click="download">Download update</Button>
        <Button v-else-if="update.status === 'downloaded'" size="sm" @click="install">Restart and install</Button>
        <Button v-else size="sm" variant="outline" :disabled="update.status === 'checking' || update.status === 'downloading' || update.status === 'unsupported'" @click="check">Check for updates</Button>
      </div>
    </section>
    <p v-else class="text-sm text-muted-foreground">Loading update information…</p>
  </SettingsPage>
</template>
