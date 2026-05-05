<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import LiveSessionView from '@/views/LiveSessionView.vue'
import { useSessionStore } from '@/stores/sessions'
import type { AppSettings } from '@shared/ipc-contract'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()

const id = route.params.id as string

const session = computed(() => sessionStore.getSession(id))

const sessionTitle = computed(() => {
  const s = session.value
  if (!s) return ''
  if (s.agencyName) return s.agencyName
  if (s.roleName) return s.roleName
  if (s.initialPrompt) return s.initialPrompt
  return id
})

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

function goBack() {
  void router.push('/sessions')
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Minimal header -->
    <header class="border-b border-border px-4 py-2 shrink-0 flex items-center gap-3">
      <Button variant="ghost" size="sm" class="gap-1.5 text-muted-foreground" @click="goBack">
        <ArrowLeft class="size-3.5" />
        Back to Sessions
      </Button>
      <span class="text-sm font-medium truncate min-w-0 flex-1">
        {{ sessionTitle }}
      </span>
    </header>

    <!-- Session content -->
    <div class="flex-1 overflow-hidden">
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
        <Button variant="ghost" size="sm" @click="goBack">Back to Sessions</Button>
      </div>
    </div>
  </div>
</template>
