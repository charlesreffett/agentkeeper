<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'

interface Props {
  data: number[]
  color?: string
  height?: number
  width?: number
  hoveredIndex?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  color: '#6366f1',
  height: 40,
  width: 120,
  hoveredIndex: null,
})

const emit = defineEmits<{ hover: [index: number | null] }>()

function onMouseMove(e: MouseEvent) {
  const el = e.currentTarget as SVGElement
  const rect = el.getBoundingClientRect()
  const fraction = (e.clientX - rect.left) / rect.width
  const idx = Math.max(0, Math.min(props.data.length - 1, Math.round(fraction * (props.data.length - 1))))
  emit('hover', idx)
}

function onMouseLeave() {
  emit('hover', null)
}

const hoverPoint = computed(() => {
  const idx = props.hoveredIndex
  if (idx == null || props.data.length === 0) return null
  const pts = props.data
  const w = props.width
  const h = props.height
  const pad = 2
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1
  const x = (idx / Math.max(pts.length - 1, 1)) * w
  const y = pts.length === 1
    ? h - pad
    : pad + ((1 - (pts[idx]! - min) / range) * (h - pad * 2))
  return { x, y }
})

const _uid = getCurrentInstance()?.uid ?? Math.random().toString(36).slice(2)

const path = computed(() => {
  const pts = props.data
  if (pts.length === 0) return ''

  const w = props.width
  const h = props.height
  const pad = 2

  if (pts.length === 1) {
    const y = h - pad
    return `M 0 ${y} L ${w} ${y}`
  }

  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1

  const xs = pts.map((_, i) => (i / Math.max(pts.length - 1, 1)) * w)
  const ys = pts.map((v) => pad + ((1 - (v - min) / range) * (h - pad * 2)))

  let d = `M ${xs[0]} ${ys[0]}`
  for (let i = 1; i < pts.length; i++) {
    const x0 = xs[i - 1]!, y0 = ys[i - 1]!
    const x1 = xs[i]!, y1 = ys[i]!
    const cpx = (x0 + x1) / 2
    d += ` C ${cpx} ${y0}, ${cpx} ${y1}, ${x1} ${y1}`
  }
  return d
})

const fillPath = computed(() => {
  if (!path.value) return ''
  const w = props.width
  const h = props.height
  const pts = props.data
  if (pts.length === 1) {
    const y = h - 2
    return `M 0 ${y} L ${w} ${y} L ${w} ${h} L 0 ${h} Z`
  }
  const lastX = (pts.length - 1) / Math.max(pts.length - 1, 1) * w
  return `${path.value} L ${lastX} ${h} L 0 ${h} Z`
})
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    width="100%"
    :height="height"
    preserveAspectRatio="none"
    class="overflow-visible"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
    style="cursor: crosshair;"
  >
    <defs>
      <linearGradient :id="`sg-${_uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.25" />
        <stop offset="100%" :stop-color="color" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    <path
      :d="fillPath"
      :fill="`url(#sg-${_uid})`"
    />
    <path
      :d="path"
      fill="none"
      :stroke="color"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <template v-if="hoverPoint">
      <line
        :x1="hoverPoint.x" :y1="0"
        :x2="hoverPoint.x" :y2="height"
        :stroke="color"
        stroke-width="1"
        stroke-opacity="0.4"
        stroke-dasharray="2 2"
      />
      <circle
        :cx="hoverPoint.x"
        :cy="hoverPoint.y"
        r="2.5"
        :fill="color"
      />
    </template>
  </svg>
</template>
