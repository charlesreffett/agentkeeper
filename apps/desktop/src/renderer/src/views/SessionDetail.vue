<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SessionTranscript } from '@shared/ipc-contract'
import Transcript from '@/components/transcript/Transcript.vue'
import MessageInput from '@/components/MessageInput.vue'
import { shortModel } from '@/lib/format'

const props = defineProps<{
  projectPath: string
  sessionId: string | null
}>()

const emit = defineEmits<{
  resumeAndSend: [sdkSessionId: string, projectPath: string, text: string]
}>()

const transcript = ref<SessionTranscript | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const firstUserMessage = computed(() => {
  for (const evt of transcript.value?.events ?? []) {
    if (evt.role === 'user' && !evt.isMeta) {
      for (const b of evt.content) {
        if (b.type === 'text') return b.text.split('\n')[0] ?? ''
      }
    }
  }
  return ''
})

function onSend(text: string) {
  if (!transcript.value) return
  emit('resumeAndSend', transcript.value.id, transcript.value.projectPath, text)
}

async function load() {
  if (!props.sessionId) {
    transcript.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    transcript.value = await window.orchestral.sessions.read(
      props.projectPath,
      props.sessionId,
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    transcript.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.projectPath, props.sessionId],
  () => {
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <div class="h-full">
    <div
      v-if="!sessionId"
      class="h-full flex items-center justify-center text-muted-foreground"
    >
      <div class="text-center space-y-2">
        <p class="text-sm">Select a session to view its transcript.</p>
        <p class="text-xs">
          Live sessions and the "New session" action land in V2.
        </p>
      </div>
    </div>

    <div v-else-if="loading" class="p-6 text-sm text-muted-foreground">
      Loading transcript…
    </div>

    <div v-else-if="error" class="p-6 text-sm text-destructive">
      {{ error }}
    </div>

    <div v-else-if="transcript" class="h-full flex flex-col">
      <div
        class="border-b border-border px-6 py-3 shrink-0 flex items-center gap-4 text-xs text-muted-foreground"
      >
        <span class="font-mono">{{ transcript.id.slice(0, 8) }}</span>
        <span>·</span>
        <span>{{ transcript.events.length }} events</span>
        <span v-if="transcript.gitBranch">·</span>
        <span v-if="transcript.gitBranch" class="font-mono">
          {{ transcript.gitBranch }}
        </span>
        <span v-if="transcript.versions.length" class="ml-auto font-mono">
          claude {{ transcript.versions[transcript.versions.length - 1] }}
        </span>
      </div>
      <div class="flex-1 overflow-y-auto">
        <Transcript :events="transcript.events" />
      </div>
      <MessageInput
        :project-path="transcript.projectPath"
        @send="onSend"
      />
    </div>
  </div>
</template>
