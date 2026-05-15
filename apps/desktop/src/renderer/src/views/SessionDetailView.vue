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

const settings = ref<AppSettings>({
  defaultModel: 'claude-sonnet-4-6',
  defaultEffort: 'medium',
  defaultUseWorktree: false,
  enterToSend: false,
  sendModifier: 'auto',
  sessionExpiryDays: 14,
  theme: 'dark',
})

onMounted(async () => {
  settings.value = await window.agentkeeper.settings.get()
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
