<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Activity, ChartColumnBig, MessageSquarePlus } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useUnifiedSessions } from '@/composables/useUnifiedSessions'
import { useSessionStore } from '@/stores/sessions'

const router = useRouter()
const sessionStore = useSessionStore()
const { createNewSession } = useUnifiedSessions()

const statusCounts = computed(() => sessionStore.statusCounts)

const statusLine = computed(() => {
  const parts: string[] = []
  if (statusCounts.value.running > 0) parts.push(`${statusCounts.value.running} running`)
  if (statusCounts.value.blocked > 0) parts.push(`${statusCounts.value.blocked} blocked`)
  if (statusCounts.value.idle > 0) parts.push(`${statusCounts.value.idle} idle`)
  return parts.join(' · ') || 'No active sessions'
})

async function handleNew() {
  // Starts a General (no-project) draft; context is chosen in the compose header.
  await createNewSession()
}
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center px-6">
    <div class="max-w-md w-full flex flex-col items-center text-center gap-6">
      <div class="flex flex-col items-center gap-3">
        <div
          class="size-12 rounded-2xl border border-border bg-muted/40 flex items-center justify-center"
        >
          <MessageSquarePlus class="size-6 text-muted-foreground" />
        </div>
        <h1 class="text-xl font-semibold tracking-tight">Welcome to AgentKeeper</h1>
        <p class="text-sm text-muted-foreground leading-relaxed">
          Pick a session from the list to continue, or start a new one.
        </p>
      </div>

      <div class="w-full flex flex-col items-center gap-2">
        <Button size="lg" class="gap-2 px-6" @click="handleNew">
          <MessageSquarePlus class="size-4" />
          New session
        </Button>
      </div>

      <div class="w-full pt-2 border-t border-border/50 flex flex-col items-center gap-3">
        <span class="text-xs text-muted-foreground tabular-nums">{{ statusLine }}</span>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" class="gap-1.5" @click="router.push('/monitor')">
            <Activity class="size-3.5" />
            Monitor
          </Button>
          <Button variant="ghost" size="sm" class="gap-1.5" @click="router.push('/stats')">
            <ChartColumnBig class="size-3.5" />
            Stats
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
