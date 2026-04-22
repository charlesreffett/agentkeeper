<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import Transcript from '@/components/transcript/Transcript.vue'
import MessageInput from '@/components/MessageInput.vue'
import { useSessionStore } from '@/stores/sessions'
import { shortModel } from '@/lib/format'

const props = defineProps<{ liveId: string }>()

const store = useSessionStore()
const session = computed(() => store.getSession(props.liveId))
const scroller = ref<HTMLElement | null>(null)

async function scrollToBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => session.value?.events.length ?? 0,
  () => {
    void scrollToBottom()
  },
)

watch(
  () => props.liveId,
  () => {
    void scrollToBottom()
  },
  { immediate: true },
)

function onSend(text: string) {
  void store.send(props.liveId, text)
}

async function onEnd() {
  await store.cancel(props.liveId)
}

function onDismiss() {
  store.dismiss(props.liveId)
}

const canSend = computed(
  () => session.value?.status === 'idle' || session.value?.status === 'running',
)

const isTerminal = computed(
  () =>
    session.value?.status === 'completed' ||
    session.value?.status === 'cancelled' ||
    session.value?.status === 'error',
)

const statusLabel = computed(() => {
  switch (session.value?.status) {
    case 'starting':
      return 'Starting…'
    case 'running':
      return 'Working…'
    case 'idle':
      return 'Ready for input'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'error':
      return 'Error'
    default:
      return ''
  }
})

const statusDotClass = computed(() => {
  switch (session.value?.status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
      return 'bg-amber-500'
    case 'completed':
    case 'cancelled':
      return 'bg-muted-foreground'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground'
  }
})
</script>

<template>
  <div v-if="session" class="h-full flex flex-col">
    <header
      class="border-b border-border px-6 py-3 shrink-0 flex items-center gap-4"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="inline-flex items-center gap-1.5 text-xs">
          <span class="size-1.5 rounded-full" :class="statusDotClass" />
          <span>{{ statusLabel }}</span>
        </span>
        <span
          v-if="shortModel(session.model)"
          class="text-xs text-muted-foreground font-mono"
        >
          · {{ shortModel(session.model) }}
        </span>
        <span
          v-if="session.sdkSessionId"
          class="text-xs text-muted-foreground font-mono ml-auto"
        >
          {{ session.sdkSessionId.slice(0, 8) }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="!isTerminal"
          variant="ghost"
          size="sm"
          @click="onEnd"
        >
          End session
        </Button>
        <Button v-else variant="ghost" size="sm" @click="onDismiss">
          Dismiss
        </Button>
      </div>
    </header>

    <div ref="scroller" class="flex-1 overflow-y-auto min-h-0">
      <div v-if="session.error" class="max-w-4xl mx-auto p-6">
        <div
          class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {{ session.error }}
        </div>
      </div>
      <Transcript :events="session.events" />
    </div>

    <MessageInput
      :disabled="!canSend"
      :placeholder="
        session.status === 'starting'
          ? 'Waiting for session to start…'
          : session.status === 'running'
            ? 'Model is working — message will queue'
            : isTerminal
              ? 'Session ended'
              : undefined
      "
      @send="onSend"
    />
  </div>
  <div v-else class="h-full flex items-center justify-center text-muted-foreground text-sm">
    Session not found.
  </div>
</template>
