<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'

interface Props {
  data: number[]
  color?: string
  height?: number
  width?: number
}

const props = withDefaults(defineProps<Props>(), {
  color: '#6366f1',
  height: 40,
  width: 120,
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
  </svg>
</template>
