<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, CornerDownRight, Network, User2 } from 'lucide-vue-next'
import TokenBreakdownPopover from './TokenBreakdownPopover.vue'
import { useSessionStore, type LiveSession } from '@/stores/sessions'
import { shortModel } from '@/lib/format'
import type { LiveSessionStatus } from '@shared/ipc-contract'

const props = defineProps<{
  collapsed: boolean
  rootSessionId: string
  selectedId: string
}>()

defineEmits<{
  collapse: []
  expand: []
  'update:selectedId': [id: string]
}>()

const store = useSessionStore()

// ─── Agency group ────────────────────────────────────────────────────────────

const rootSession = computed(() => store.getSession(props.rootSessionId))

/** All sessions belonging to the same agency run, sorted: entry first then by startedAt. */
const agencyGroup = computed((): LiveSession[] => {
  const root = rootSession.value
  if (!root) return []
  if (!root.agencyInstanceId) return [root]

  const peers = Object.values(store.sessions).filter(
    (s) => s.agencyInstanceId === root.agencyInstanceId,
  )
  return peers.sort((a, b) => {
    const aEntry = isEntryPoint(a)
    const bEntry = isEntryPoint(b)
    if (aEntry && !bEntry) return -1
    if (!aEntry && bEntry) return 1
    return a.startedAt - b.startedAt
  })
})

const selectedSession = computed(() => store.getSession(props.selectedId))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isEntryPoint(s: LiveSession): boolean {
  if (!s.agencyInstanceId) return true
  if (s.initialPrompt === '(awaiting peers)') return false
  if (s.initialPrompt.startsWith('Agency "')) return false
  return true
}

/** Label shown in the tree row. Entry = "Main · <task>", sub-agents = role name only. */
function rowLabel(s: LiveSession): string {
  if (isEntryPoint(s)) {
    const title = s.title ?? s.agencyPrompt ?? s.initialPrompt
    return title ? `Main · ${title}` : 'Main'
  }
  return s.roleName ?? 'Agent'
}

function statusDotClass(status: LiveSessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'blocked':
      return 'bg-blue-500'
    case 'completed':
    case 'terminated':
      return 'bg-muted-foreground/40'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground/40'
  }
}

function statusLabel(status: LiveSessionStatus): string {
  switch (status) {
    case 'starting':   return 'Starting'
    case 'running':    return 'Running'
    case 'idle':       return 'Idle'
    case 'suspended':  return 'Suspended'
    case 'blocked':    return 'Blocked'
    case 'completed':  return 'Completed'
    case 'terminated': return 'Terminated'
    case 'error':      return 'Error'
    default:           return ''
  }
}

function statusTextClass(status: LiveSessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'text-emerald-500'
    case 'idle':
    case 'suspended':
      return 'text-amber-500'
    case 'blocked':
      return 'text-blue-500'
    case 'error':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

function turnCount(s: LiveSession): number {
  const fromEvents = s.events.filter((e) => e.kind === 'assistant').length
  const persisted = store.sessionTurns[s.localId] ?? 0
  return Math.max(fromEvents, persisted)
}

function agentTokens(s: LiveSession): number {
  return (
    (store.sessionTokens[s.localId]?.tokens ?? 0) +
    (store.sessionRunTokens[s.localId] ?? 0) +
    (store.sessionOutputEstimates[s.localId] ?? 0)
  )
}

function agentName(s: LiveSession): string {
  if (isEntryPoint(s)) return s.roleName ?? 'Main agent'
  return s.roleName ?? 'Agent'
}

function agentSubtitle(s: LiveSession): string {
  return s.title ?? s.agencyPrompt ?? s.initialPrompt
}
</script>

<template>
  <!-- Collapsed strip -->
  <div
    v-if="collapsed"
    class="w-7 shrink-0 flex flex-col items-center pt-2 border-r border-border"
  >
    <button
      class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
      title="Expand agent tree"
      @click="$emit('expand')"
    >
      <ChevronRight class="size-3.5" />
    </button>
  </div>

  <!-- Expanded panel -->
  <div
    v-else
    class="w-[220px] shrink-0 flex flex-col border-r border-border overflow-hidden"
  >
    <!-- Panel header -->
    <div class="px-3 py-2 shrink-0 flex items-center justify-between border-b border-border">
      <span
        class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
      >
        <Network class="size-3" />
        Agent Tree
      </span>
      <button
        class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
        title="Collapse agent tree"
        @click="$emit('collapse')"
      >
        <ChevronLeft class="size-3.5" />
      </button>
    </div>

    <!-- Agent rows + SELECTED section in one scrollable container -->
    <div class="flex-1 overflow-y-auto">
      <div class="py-1 px-1">
        <button
          v-for="s in agencyGroup"
          :key="s.localId"
          class="w-full flex items-center gap-1.5 px-2 py-1.5 text-left rounded transition-colors"
          :class="
            s.localId === selectedId
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          "
          @click="$emit('update:selectedId', s.localId)"
        >
          <User2 v-if="isEntryPoint(s)" class="size-3 shrink-0 text-primary/80" />
          <CornerDownRight v-else class="size-3 shrink-0 ml-2 opacity-50" />
          <span class="flex-1 text-[11px] font-medium truncate">{{ rowLabel(s) }}</span>
          <span class="size-1.5 rounded-full shrink-0" :class="statusDotClass(s.status)" />
        </button>
      </div>

    <!-- SELECTED section -->
    <div
      v-if="selectedSession"
      class="border-t border-border px-3 pt-2.5 pb-3"
    >
      <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
        Selected
      </div>

      <!-- Agent identity -->
      <div class="mb-2.5">
        <div class="text-xs font-semibold text-foreground leading-snug">
          {{ agentName(selectedSession) }}
        </div>
        <div class="text-[11px] text-muted-foreground truncate mt-0.5 leading-snug">
          {{ agentSubtitle(selectedSession) }}
        </div>
      </div>

      <!-- Stats grid -->
      <div class="space-y-1 text-[11px]">
        <div class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground shrink-0">Status</span>
          <span
            class="font-medium flex items-center gap-1 truncate"
            :class="statusTextClass(selectedSession.status)"
          >
            <span
              class="size-1.5 rounded-full shrink-0"
              :class="statusDotClass(selectedSession.status)"
            />
            {{ statusLabel(selectedSession.status) }}
          </span>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground shrink-0">Model</span>
          <span class="font-mono text-primary truncate text-right">
            {{ shortModel(selectedSession.model) ?? '—' }}
          </span>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground shrink-0 flex items-center gap-1">
            Tokens
            <TokenBreakdownPopover :session-id="selectedSession.localId" side="right" />
          </span>
          <span class="tabular-nums text-foreground">
            {{ agentTokens(selectedSession).toLocaleString() }}
          </span>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground shrink-0">Turns</span>
          <span class="tabular-nums text-foreground">{{ turnCount(selectedSession) }}</span>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>
