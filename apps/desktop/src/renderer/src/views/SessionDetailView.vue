<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import LiveSessionView from '@/views/LiveSessionView.vue'
import { useSessionStore } from '@/stores/sessions'
import type { AppSettings } from '@shared/ipc-contract'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()

const id = computed(() => route.params.id as string)
const session = computed(() => sessionStore.getSession(id.value))
const loading = ref(true)

const settings = ref<AppSettings>({
  defaultModel: 'claude-sonnet-4-6',
  defaultEffort: 'medium',
  defaultUseWorktree: false,
  enterToSend: false,
  sendModifier: 'auto',
  sessionExpiryDays: 14,
  theme: 'dark',
  notifications: 'all',
  notificationSound: 'chime',
  mcpServers: [],
})

onMounted(async () => {
  settings.value = await window.agentkeeper.settings.get()
  if (!session.value) {
    const result = await window.agentkeeper.sessions.getByLocalId(id.value)
    if (result) {
      sessionStore.openPersisted(result)
    }
  }
  loading.value = false
})
</script>

<template>
  <!-- LiveSessionView owns the full chrome (header, back button, panels). -->
  <div class="h-full flex-1 min-w-0 overflow-hidden">
    <LiveSessionView
      v-if="session"
      :live-id="id"
      :enter-to-send="settings.enterToSend"
      :send-modifier="settings.sendModifier"
    />
    <div
      v-else-if="loading"
      class="h-full flex items-center justify-center text-muted-foreground text-sm"
    >
      <p>Loading session…</p>
    </div>
    <div
      v-else
      class="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground text-sm"
    >
      <p>Session not found.</p>
      <Button variant="ghost" size="sm" @click="router.push('/sessions')">
        Back to Sessions
      </Button>
    </div>
  </div>
</template>
