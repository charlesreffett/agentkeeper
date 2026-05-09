<script setup lang="ts">
import { computed } from 'vue'
import { GitBranch, Users, Clock, Check, MessageSquare } from 'lucide-vue-next'
import type { LiveSessionStatus, TranscriptEvent } from '@shared/ipc-contract'
import { shortModel, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePlanProgress } from '@/composables/usePlanProgress'

export interface SessionCardData {
  id: string
  title: string
  status: LiveSessionStatus | 'inactive'
  /** Discriminates click routing in the sessions view. */
  source: 'live' | 'persisted' | 'agency' | 'historical'
  projectPath: string
  projectName: string
  projectColor: string
  model: string | null
  branch: string | null
  lastActivityAt: number
  workItemKey: string | null
  workItemTitle: string | null
  subAgentCount: number
  /** Message count — shown for historical JSONL sessions. */
  messageCount: number | null
  /** Live events for plan-progress widget; empty for non-live sessions. */
  events: TranscriptEvent[]
}

interface Props {
  session: SessionCardData
  selectMode?: boolean
  selected?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ click: []; select: [] }>()

const plan = usePlanProgress(() => props.session)

function borderClass(status: SessionCardData['status']): string {
  if (status === 'running' || status === 'starting') return 'border-green-500/60'
  if (status === 'error') return 'border-red-500/60'
  if (status === 'blocked') return 'border-amber-500/60'
  return 'border-border'
}

function badgeClass(status: SessionCardData['status']): string {
  if (status === 'running' || status === 'starting')
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  if (status === 'error')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  if (status === 'blocked')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
  return 'bg-muted text-muted-foreground'
}

function badgeDotClass(status: SessionCardData['status']): string {
  if (status === 'running' || status === 'starting') return 'bg-green-500'
  if (status === 'error') return 'bg-red-500'
  if (status === 'blocked') return 'bg-amber-500'
  return 'bg-muted-foreground/50'
}

function badgeLabel(status: SessionCardData['status']): string {
  if (status === 'running' || status === 'starting') return 'Running'
  if (status === 'error') return 'Error'
  if (status === 'blocked') return 'Blocked'
  if (status === 'idle' || status === 'suspended') return 'Idle'
  if (status === 'inactive') return 'Inactive'
  return status.charAt(0).toUpperCase() + status.slice(1)
}
</script>

<template>
  <div
    :class="cn(
      'rounded-xl border bg-card p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md transition-shadow',
      selectMode && selected ? 'ring-2 ring-primary border-primary' : borderClass(session.status),
    )"
    @click="props.selectMode ? emit('select') : emit('click')"
  >
    <!-- title row -->
    <div class="flex items-start gap-2">
      <!-- inline checkbox in select mode -->
      <div
        v-if="selectMode"
        class="size-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors"
        :class="selected ? 'bg-primary border-primary' : 'border-muted-foreground/50 bg-background'"
      >
        <Check v-if="selected" class="size-3 text-primary-foreground" />
      </div>
      <p class="font-semibold text-sm leading-snug line-clamp-2 flex-1">
        {{ session.title }}
      </p>
      <span
        :class="cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0',
          badgeClass(session.status),
        )"
      >
        <span :class="cn('size-1.5 rounded-full', badgeDotClass(session.status))" />
        {{ badgeLabel(session.status) }}
      </span>
    </div>

    <!-- ticket key — only shown when linked to a work item -->
    <span
      v-if="session.workItemKey"
      class="text-xs text-muted-foreground/60 font-mono"
    >
      {{ session.workItemKey }}
    </span>

    <!-- project chip -->
    <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs bg-muted/60 w-fit">
      <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: session.projectColor }" />
      <span class="text-muted-foreground">{{ session.projectName }}</span>
    </span>

    <!-- Plan progress — only available when the agent has used TodoWrite -->
    <div
      v-if="plan.hasPlan"
      class="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30 px-3 py-2 flex flex-col gap-1.5"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0 text-xs">
          <span class="text-amber-500 shrink-0 leading-none">✦</span>
          <span class="font-semibold text-foreground/70 shrink-0">PLAN</span>
          <span class="text-muted-foreground truncate">{{ session.title }}</span>
        </div>
        <span class="text-xs text-muted-foreground font-mono shrink-0">
          {{ plan.completedCount }}/{{ plan.totalCount }}
        </span>
      </div>

      <div class="h-1 rounded-full bg-amber-200/60 dark:bg-amber-800/30 overflow-hidden">
        <div
          class="h-full rounded-full bg-green-500 transition-all duration-300"
          :style="{ width: `${plan.totalCount > 0 ? (plan.completedCount / plan.totalCount) * 100 : 0}%` }"
        />
      </div>

      <div
        v-if="plan.activeTodo || plan.lastCompletedTodo"
        class="flex items-center gap-2"
      >
        <span
          v-if="plan.allDone"
          class="size-4 rounded-full bg-green-500 flex items-center justify-center shrink-0"
        >
          <Check class="size-2.5 text-white" />
        </span>
        <span
          v-else-if="plan.activeTodo"
          class="size-4 rounded-full bg-green-500 flex items-center justify-center shrink-0 text-[9px] font-bold text-white leading-none"
        >
          {{ plan.activeTodoIndex }}
        </span>
        <span class="text-xs text-foreground/70 truncate">
          {{ plan.allDone ? plan.lastCompletedTodo?.content : plan.activeTodo?.content }}
        </span>
      </div>
    </div>

    <!-- footer -->
    <div class="flex items-center flex-wrap gap-3 text-xs text-muted-foreground/70">
      <span v-if="session.model" class="flex items-center gap-1">
        <span class="size-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
        {{ shortModel(session.model) }}
      </span>
      <span v-if="session.branch" class="flex items-center gap-1">
        <GitBranch class="size-3 shrink-0" />
        {{ session.branch }}
      </span>
      <span v-if="session.subAgentCount > 1" class="flex items-center gap-1">
        <Users class="size-3 shrink-0" />
        {{ session.subAgentCount }}
      </span>
      <span v-if="session.messageCount !== null" class="flex items-center gap-1">
        <MessageSquare class="size-3 shrink-0" />
        {{ session.messageCount }}
      </span>
      <span class="flex items-center gap-1">
        <Clock class="size-3 shrink-0" />
        {{ formatRelativeTime(session.lastActivityAt) }}
      </span>
    </div>
  </div>
</template>
