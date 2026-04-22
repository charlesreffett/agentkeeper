<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import Transcript from '@/components/transcript/Transcript.vue'
import MessageInput from '@/components/MessageInput.vue'
import { useLiveSession } from '@/composables/useLiveSession'
import type { StartSessionParams } from '@shared/ipc-contract'
import { shortModel } from '@/lib/format'

const props = defineProps<{ startParams: StartSessionParams }>()
const emit = defineEmits<{ close: [] }>()

const live = useLiveSession()
const scroller = ref<HTMLElement | null>(null)

onMounted(() => {
  void live.start(props.startParams)
})

async function scrollToBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => live.events.value.length,
  () => {
    void scrollToBottom()
  },
)

function onSend(text: string) {
  void live.send(text)
}

async function onCancel() {
  await live.cancel()
}

const canSend = () =>
  live.status.value === 'idle' || live.status.value === 'running'

const statusLabel = () => {
  switch (live.status.value) {
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
  }
}

const statusTone = () => {
  switch (live.status.value) {
    case 'running':
    case 'starting':
      return 'text-foreground'
    case 'idle':
      return 'text-foreground'
    case 'error':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <header
      class="border-b border-border px-6 py-3 shrink-0 flex items-center gap-4"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="inline-flex items-center gap-1.5 text-xs">
          <span
            class="size-1.5 rounded-full"
            :class="{
              'bg-emerald-500 animate-pulse':
                live.status.value === 'running' ||
                live.status.value === 'starting',
              'bg-amber-500': live.status.value === 'idle',
              'bg-muted-foreground':
                live.status.value === 'completed' ||
                live.status.value === 'cancelled',
              'bg-destructive': live.status.value === 'error',
            }"
          />
          <span :class="statusTone()">{{ statusLabel() }}</span>
        </span>
        <span
          v-if="shortModel(startParams.model ?? null)"
          class="text-xs text-muted-foreground font-mono"
        >
          · {{ shortModel(startParams.model ?? null) }}
        </span>
        <span
          v-if="live.sdkSessionId.value"
          class="text-xs text-muted-foreground font-mono ml-auto"
        >
          {{ live.sdkSessionId.value.slice(0, 8) }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="
            live.status.value === 'running' ||
            live.status.value === 'starting' ||
            live.status.value === 'idle'
          "
          variant="ghost"
          size="sm"
          @click="onCancel"
        >
          End session
        </Button>
        <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
      </div>
    </header>

    <div ref="scroller" class="flex-1 overflow-y-auto min-h-0">
      <div v-if="live.error.value" class="max-w-4xl mx-auto p-6">
        <div
          class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {{ live.error.value }}
        </div>
      </div>
      <Transcript :events="live.events.value" />
    </div>

    <MessageInput
      :disabled="!canSend()"
      :placeholder="
        live.status.value === 'starting'
          ? 'Waiting for session to start…'
          : live.status.value === 'running'
            ? 'Model is working — message will queue'
            : undefined
      "
      @send="onSend"
    />
  </div>
</template>
