<script setup lang="ts">
import { computed } from 'vue'

interface Segment {
  label: string
  value: number
  color: string
}

interface Props {
  segments: Segment[]
  total: number
  size?: number
  thickness?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 80,
  thickness: 0.35,
})

const gradient = computed(() => {
  const sum = props.segments.reduce((s, seg) => s + seg.value, 0)
  if (sum === 0) return `conic-gradient(var(--color-muted) 0deg 360deg)`
  let angle = 0
  const stops = props.segments.map((seg) => {
    const deg = (seg.value / sum) * 360
    const stop = `${seg.color} ${angle}deg ${angle + deg}deg`
    angle += deg
    return stop
  })
  return `conic-gradient(${stops.join(', ')})`
})
</script>

<template>
  <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
    <div class="rounded-full w-full h-full" :style="{ background: gradient }" />
    <div
      class="absolute inset-0 m-auto rounded-full bg-card flex items-center justify-center"
      :style="{ width: `${size * (1 - thickness)}px`, height: `${size * (1 - thickness)}px` }"
    >
      <span class="text-sm font-bold">{{ total }}</span>
    </div>
  </div>
</template>
