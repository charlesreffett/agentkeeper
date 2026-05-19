<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import type { Attachment } from '../../../shared/ipc-contract'

const props = defineProps<{
  images: Attachment[]
  initialIndex: number
  open: boolean
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const currentIndex = ref(props.initialIndex)

watch(() => props.initialIndex, (v) => { currentIndex.value = v })
watch(() => props.open, (v) => { if (v) currentIndex.value = props.initialIndex })

function close() { emit('update:open', false) }

function prev() {
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length
}

function next() {
  currentIndex.value = (currentIndex.value + 1) % props.images.length
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') { close(); return }
  if (e.key === 'ArrowLeft') { prev(); return }
  if (e.key === 'ArrowRight') { next() }
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/80" @click="close" />
      <div class="relative z-50 flex flex-col items-center gap-3 p-4 max-w-[90vw]">
        <button
          class="absolute top-0 right-0 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
          @click="close"
        >
          <X :size="16" />
        </button>

        <img
          :src="`data:${images[currentIndex]?.mimeType};base64,${images[currentIndex]?.content}`"
          :alt="images[currentIndex]?.name"
          class="max-h-[85vh] max-w-[90vw] object-contain rounded-md"
        />

        <p class="text-sm text-white/80 max-w-[60ch] truncate">{{ images[currentIndex]?.name }}</p>

        <div v-if="images.length > 1" class="flex items-center gap-3">
          <button
            class="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            @click="prev"
          >
            <ChevronLeft :size="18" />
          </button>
          <span class="text-sm text-white/80 tabular-nums">{{ currentIndex + 1 }} / {{ images.length }}</span>
          <button
            class="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            @click="next"
          >
            <ChevronRight :size="18" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
