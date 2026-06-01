<template>
  <div
    class="relative rounded-lg border-2 bg-card shadow-md cursor-pointer select-none transition-all min-w-[160px]"
    :class="[
      selected ? 'border-blue-500 shadow-blue-500/20' : 'border-border hover:border-foreground/40',
      data.anyToAny ? 'border-dashed' : '',
    ]"
  >
    <Handle id="top" type="source" :position="Position.Top" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />
    <Handle id="left" type="source" :position="Position.Left" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />

    <div class="flex items-center gap-2.5 px-3 py-2.5 pr-8">
      <!-- Colored icon avatar -->
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        :style="{ backgroundColor: accentBg, color: accentFg }"
      >
        <component :is="iconComp" class="w-4 h-4" />
      </div>

      <!-- Name + id + badges -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold text-card-foreground truncate">{{ data.name }}</span>
          <span
            v-if="data.multiplicityLabel && !data.isExpanded"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
          >{{ data.multiplicityLabel }}</span>
          <span
            v-if="data.isEntryPoint"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0"
          >entry</span>
          <span
            v-if="data.anyToAny"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 shrink-0"
          >open</span>
        </div>
        <div class="text-[10px] font-mono text-muted-foreground truncate">{{ data.roleId ?? data.label }}</div>
      </div>
    </div>

    <!-- Expand / collapse toggle — top-right corner -->
    <button
      v-if="data.isExpandable"
      class="absolute top-1.5 right-1.5 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      :title="data.isExpanded ? 'Collapse instances' : 'Expand instances'"
      @click.stop="data.onToggleExpand?.()"
    >
      <svg v-if="data.isExpanded" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
      <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    </button>

    <Handle id="right" type="source" :position="Position.Right" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
  Layers, Code2, GitBranch, FlaskConical, Eye,
  FileText, Activity, Shield, Zap, Brain,
} from 'lucide-vue-next'

const ACCENT_PALETTE: Record<string, { bg: string; fg: string }> = {
  blue:   { bg: 'rgba(59,130,246,0.15)',  fg: '#3b82f6' },
  orange: { bg: 'rgba(245,158,11,0.15)',  fg: '#f59e0b' },
  purple: { bg: 'rgba(139,92,246,0.15)',  fg: '#8b5cf6' },
  teal:   { bg: 'rgba(20,184,166,0.15)',  fg: '#14b8a6' },
  green:  { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
  red:    { bg: 'rgba(239,68,68,0.15)',   fg: '#ef4444' },
}

const ICON_MAP: Record<string, ReturnType<typeof markRaw>> = {
  Layers:       markRaw(Layers),
  Code2:        markRaw(Code2),
  GitBranch:    markRaw(GitBranch),
  FlaskConical: markRaw(FlaskConical),
  Eye:          markRaw(Eye),
  FileText:     markRaw(FileText),
  Activity:     markRaw(Activity),
  Shield:       markRaw(Shield),
  Zap:          markRaw(Zap),
  Brain:        markRaw(Brain),
}

const props = defineProps<{
  data: {
    label: string
    roleId?: string
    name?: string
    icon?: string
    accent?: string
    isEntryPoint: boolean
    anyToAny: boolean
    multiplicityLabel: string
    isExpandable: boolean
    isExpanded: boolean
    onToggleExpand?: () => void
  }
  selected: boolean
}>()

const accentBg = computed(() =>
  (ACCENT_PALETTE[props.data.accent ?? 'blue'] ?? ACCENT_PALETTE['blue']!).bg
)
const accentFg = computed(() =>
  (ACCENT_PALETTE[props.data.accent ?? 'blue'] ?? ACCENT_PALETTE['blue']!).fg
)
const iconComp = computed(() =>
  ICON_MAP[props.data.icon ?? 'Layers'] ?? Layers
)
</script>
