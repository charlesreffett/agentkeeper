<script setup lang="ts">
import { computed, provide, ref, useAttrs } from 'vue'
import { VList, type VListHandle } from 'virtua/vue'
import type { Attachment, ContentBlock, TranscriptEvent } from '@shared/ipc-contract'
import TranscriptEventView from './TranscriptEvent.vue'
import TurnActivityGroup from './TurnActivityGroup.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { groupTranscript } from '@/lib/transcriptGrouping'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const props = defineProps<{
  events: TranscriptEvent[]
  roleName?: string | null
  harnessId?: string | null
  assistantName?: string | null
  streamingEventUuid?: string
  canRewrite?: boolean
  active?: boolean
  turnStartedAt?: number | null
  turnEndedAt?: number | null
}>()

const emit = defineEmits<{
  'edit-submit': [uuid: string, newText: string, attachments: Attachment[]]
  'regenerate': [uuid: string]
  'scroll': [offset: number]
}>()

const hoverRewriteUuid = ref<string | null>(null)
const renderItems = computed(() => groupTranscript(props.events, props.active))

// Index of the hovered event in renderItems (for doomed calculation).
const doomedFromIndex = computed(() => {
  if (!hoverRewriteUuid.value) return -1
  return renderItems.value.findIndex((item) =>
    item.type === 'event'
      ? item.event.uuid === hoverRewriteUuid.value
      : item.turn.finalEvent?.uuid === hoverRewriteUuid.value,
  )
})

function imageBlockSrc(block: ContentBlock & { type: 'image' }): string | null {
  const source = block.source as Record<string, unknown> | undefined
  if (!source) return null
  if (source['type'] === 'base64') return `data:${source['media_type']};base64,${source['data']}`
  if (source['type'] === 'url') return source['url'] as string
  return null
}

const transcriptLightboxImages = computed(() => {
  const images: { src: string; label: string }[] = []
  for (const event of props.events) {
    for (const block of event.content) {
      if (block.type === 'image') {
        const src = imageBlockSrc(block as ContentBlock & { type: 'image' })
        if (src) images.push({ src, label: 'Image' })
      }
    }
  }
  return images
})

const transcriptSrcToIndex = computed(() => {
  const map = new Map<string, number>()
  transcriptLightboxImages.value.forEach((img, i) => {
    if (!map.has(img.src)) map.set(img.src, i)
  })
  return map
})

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)

function openTranscriptLightbox(src: string) {
  const index = transcriptSrcToIndex.value.get(src)
  if (index === undefined) return
  lightboxIndex.value = index
  lightboxOpen.value = true
}

provide('openTranscriptLightbox', openTranscriptLightbox)

const listRef = ref<VListHandle | null>(null)

defineExpose({
  scrollToEnd() {
    listRef.value?.scrollToIndex(renderItems.value.length - 1, { align: 'end' })
  },
  scrollTo(offset: number) {
    listRef.value?.scrollTo(offset)
  },
  getScrollMetrics(): { offset: number; scrollSize: number; viewportSize: number } | null {
    const h = listRef.value
    if (!h) return null
    return { offset: h.scrollOffset, scrollSize: h.scrollSize, viewportSize: h.viewportSize }
  },
})
</script>

<template>
  <div v-bind="attrs" class="h-full relative">
    <!-- Virtual list — always rendered so scroll metrics are available when Transcript is mounted -->
    <VList
      ref="listRef"
      :data="renderItems"
      class="h-full"
      @scroll="emit('scroll', $event)"
    >
      <template #default="{ item, index }">
        <div
          :class="[
            'px-6 max-w-4xl mx-auto w-full',
            index === 0 ? 'pt-6' : 'pt-5',
            index === renderItems.length - 1 ? 'pb-6' : '',
          ]"
        >
          <TranscriptEventView
            v-if="item.type === 'event'"
            :event="item.event"
            :agent-name="roleName ?? undefined"
            :harness-id="harnessId"
            :assistant-name="assistantName"
            :streaming="item.event.uuid === streamingEventUuid"
            :is-doomed="doomedFromIndex >= 0 && index > doomedFromIndex"
            :can-rewrite="canRewrite"
            @hover-rewrite="hoverRewriteUuid = $event"
            @edit-submit="(uuid, newText, attachments) => emit('edit-submit', uuid, newText, attachments)"
            @regenerate="(uuid) => emit('regenerate', uuid)"
          />
          <template v-else>
            <TurnActivityGroup
              :turn="item.turn"
              :active="active && index === renderItems.length - 1"
              :live-started-at="index === renderItems.length - 1 ? turnStartedAt : null"
              :live-ended-at="index === renderItems.length - 1 ? turnEndedAt : null"
              :streaming="active && index === renderItems.length - 1"
            />
            <TranscriptEventView
              v-if="item.turn.finalEvent"
              :event="item.turn.finalEvent"
              :agent-name="roleName ?? undefined"
              :harness-id="harnessId"
              :assistant-name="assistantName"
              :streaming="item.turn.finalEvent.uuid === streamingEventUuid"
              :is-doomed="doomedFromIndex >= 0 && index > doomedFromIndex"
              :can-rewrite="canRewrite"
              @hover-rewrite="hoverRewriteUuid = $event"
              @edit-submit="(uuid, newText, attachments) => emit('edit-submit', uuid, newText, attachments)"
              @regenerate="(uuid) => emit('regenerate', uuid)"
            />
          </template>
        </div>
      </template>
    </VList>
  </div>

  <ImageLightbox
    :images="transcriptLightboxImages"
    :initial-index="lightboxIndex"
    :open="lightboxOpen"
    @update:open="lightboxOpen = $event"
  />
</template>
