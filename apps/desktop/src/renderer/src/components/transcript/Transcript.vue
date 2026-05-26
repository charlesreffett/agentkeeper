<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { VList, type VListHandle } from 'virtua/vue'
import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'
import TranscriptEventView from './TranscriptEvent.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import {
  type VerbosityState,
  DEFAULT_VERBOSITY_STATE,
  isBlockVisible,
  passesEventFilter,
  hiddenToolCount,
} from '@/lib/verbosity'



const props = defineProps<{
  events: TranscriptEvent[]
  verbosityState?: VerbosityState
  roleName?: string | null
  streamingEventUuid?: string
  canRewrite?: boolean
}>()

const emit = defineEmits<{
  'show-all': []
  'edit-submit': [uuid: string, newText: string]
  'regenerate': [uuid: string]
  'scroll': [offset: number]
}>()

const state = computed(() => props.verbosityState ?? DEFAULT_VERBOSITY_STATE)

const hoverRewriteUuid = ref<string | null>(null)

type RenderItem =
  | { type: 'event'; event: TranscriptEvent }
  | { type: 'gap'; count: number }

const renderItems = computed((): RenderItem[] => {
  const items: RenderItem[] = []
  let pendingGap = 0

  for (const event of props.events) {
    if (!passesEventFilter(event, state.value)) continue

    const hasVisibleBlock = event.content.some((b) => isBlockVisible(b, state.value))

    if (!hasVisibleBlock) {
      pendingGap += hiddenToolCount(event.content, state.value)
      continue
    }

    if (pendingGap > 0) {
      items.push({ type: 'gap', count: pendingGap })
      pendingGap = 0
    }

    items.push({ type: 'event', event })
  }

  return items
})

// Index of the hovered event in renderItems (for doomed calculation).
const doomedFromIndex = computed(() => {
  if (!hoverRewriteUuid.value) return -1
  return renderItems.value.findIndex(
    (item) => item.type === 'event' && item.event.uuid === hoverRewriteUuid.value,
  )
})

const hasVisibleContent = computed(() => renderItems.value.length > 0)

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
  <div class="h-full relative">
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
          <div
            v-if="item.type === 'gap'"
            class="flex items-center gap-2 text-xs text-muted-foreground/50 select-none py-0.5"
          >
            <span class="flex-1 border-t border-border/25" />
            <span class="font-mono">
              {{ item.count }} tool {{ item.count === 1 ? 'call' : 'calls' }}
            </span>
            <span class="flex-1 border-t border-border/25" />
          </div>
          <TranscriptEventView
            v-else
            :event="item.event"
            :verbosity-state="state"
            :agent-name="roleName ?? undefined"
            :streaming="item.event.uuid === streamingEventUuid"
            :is-doomed="doomedFromIndex >= 0 && index > doomedFromIndex"
            :can-rewrite="canRewrite"
            @hover-rewrite="hoverRewriteUuid = $event"
            @edit-submit="(uuid, newText) => emit('edit-submit', uuid, newText)"
            @regenerate="(uuid) => emit('regenerate', uuid)"
          />
        </div>
      </template>
    </VList>

    <!-- Empty state: events exist but all hidden by current verbosity -->
    <div
      v-if="!hasVisibleContent && events.length > 0"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
    >
      <p class="text-sm text-muted-foreground">
        All messages are hidden by current verbosity.
      </p>
      <button
        class="text-xs text-muted-foreground/60 hover:text-foreground border border-border/40 hover:border-border rounded px-3 py-1 transition-colors"
        @click="emit('show-all')"
      >
        Show all
      </button>
    </div>
  </div>

  <ImageLightbox
    :images="transcriptLightboxImages"
    :initial-index="lightboxIndex"
    :open="lightboxOpen"
    @update:open="lightboxOpen = $event"
  />
</template>
