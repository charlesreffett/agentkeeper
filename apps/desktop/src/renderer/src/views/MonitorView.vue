<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/sessions'
import ScopeBar from '@/components/ScopeBar.vue'
import type { LiveSession } from '@/stores/sessions'
import { formatRelativeTime } from '@/lib/format'
import { getPlanProgress } from '@/composables/usePlanProgress'
import type { PlanProgress } from '@/composables/usePlanProgress'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { usePageScope } from '@/composables/usePageScope'

const router = useRouter()
const store = useSessionStore()
const { resolvedLabelFor } = useModelsQuery()

const { scope, scopePath, options, label, color, setScope, pickAndAdd, isAll } =
  usePageScope('monitor')

type SessionWithPlan = LiveSession & { plan: PlanProgress }

// The monitor is a per-project read — no-project sessions have no grid bucket.
function inScope(projectPath: string): boolean {
  if (isAll.value) return true
  return projectPath === scopePath.value
}

// Group live sessions by project so the grid gives a quick per-project read.
const grouped = computed(() => {
  const byProject = new Map<string, SessionWithPlan[]>()
  for (const s of store.liveList) {
    const path = s.projectPath
    if (!path || !inScope(path)) continue
    const arr = byProject.get(path) ?? []
    arr.push({ ...s, plan: getPlanProgress(s) })
    byProject.set(path, arr)
  }
  return Array.from(byProject.entries()).sort(([a], [b]) => a.localeCompare(b))
})

function statusTone(s: LiveSession) {
  switch (s.status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'completed':
    case 'inactive':
      return 'bg-muted-foreground'
    case 'error':
      return 'bg-destructive'
  }
}

function statusLabel(s: LiveSession) {
  switch (s.status) {
    case 'starting':
      return 'Starting'
    case 'running':
      return 'Working'
    case 'idle':
    case 'suspended':
      return 'Idle'
    case 'completed':
      return 'Completed'
    case 'inactive':
      return 'Inactive'
    case 'error':
      return 'Error'
  }
}

function currentTool(s: LiveSession): string | null {
  // Walk events from end back to find the most recent tool_use.
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]
    if (!e) continue
    for (let j = e.content.length - 1; j >= 0; j--) {
      const b = e.content[j]
      if (b && b.type === 'tool_use') return b.name
    }
    // Stop walking once we hit a user or a result-like event after an assistant —
    // limit work to the recent turn.
    if (i < s.events.length - 40) break
  }
  return null
}

function titleFor(s: LiveSession) {
  const firstLine = s.initialPrompt.trim().split('\n')[0] ?? '(session)'
  return firstLine.length > 120 ? firstLine.slice(0, 119) + '…' : firstLine
}

const subtitle = computed(() => {
  const count = store.liveList.length
  return `${count} active session${count === 1 ? '' : 's'}`
})

async function openSession(s: LiveSession) {
  await router.push(`/sessions/${s.localId}`)
}
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <aside class="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div class="p-3 border-b border-border shrink-0">
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
      </div>
      <div class="px-3 py-2 border-b border-border/50 shrink-0 text-xs text-muted-foreground">
        {{ subtitle }}
      </div>
    </aside>

    <div class="flex-1 overflow-y-auto p-6">
      <div
        v-if="grouped.length === 0"
        class="h-full flex items-center justify-center text-muted-foreground text-sm"
      >
        No active sessions. Start one from a project.
      </div>

      <div v-else class="max-w-7xl mx-auto space-y-8">
        <section v-for="[projectPath, sessions] in grouped" :key="projectPath">
          <header class="mb-3">
            <h2 class="text-sm font-medium truncate">
              {{ projectPath.split('/').filter(Boolean).pop() }}
            </h2>
            <p class="text-xs text-muted-foreground font-mono truncate">
              {{ projectPath }}
            </p>
          </header>
          <div
            class="grid gap-3"
            style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))"
          >
            <button
              v-for="s in sessions"
              :key="s.localId"
              type="button"
              class="text-left rounded-lg border border-border bg-card p-4 hover:border-ring transition flex flex-col gap-2"
              @click="openSession(s)"
            >
              <div class="flex items-center gap-2 text-xs">
                <span class="size-1.5 rounded-full shrink-0" :class="statusTone(s)" />
                <span class="font-medium">{{ statusLabel(s) }}</span>
                <span
                  v-if="s.model"
                  class="text-muted-foreground font-mono"
                >
                  · {{ resolvedLabelFor(s.model) }}
                </span>
                <span class="ml-auto text-muted-foreground tabular-nums">
                  {{ formatRelativeTime(s.lastActivityAt) }}
                </span>
              </div>

              <div class="text-sm font-medium line-clamp-2 leading-snug min-h-10">
                {{ titleFor(s) }}
              </div>

              <div
                v-if="s.plan.hasPlan"
                class="rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30 px-2.5 py-1.5 flex flex-col gap-1"
              >
                <div class="flex items-center justify-between gap-2 text-xs">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="text-amber-500 shrink-0 leading-none">✦</span>
                    <span class="font-semibold text-foreground/70 shrink-0">PLAN</span>
                    <span class="text-muted-foreground truncate">
                      {{ s.plan.activeTodo?.content ?? s.plan.lastCompletedTodo?.content ?? titleFor(s) }}
                    </span>
                  </div>
                  <span class="text-muted-foreground font-mono shrink-0">{{ s.plan.completedCount }}/{{ s.plan.totalCount }}</span>
                </div>
                <div class="h-0.5 rounded-full bg-amber-200/60 dark:bg-amber-800/30 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-green-500 transition-all duration-300"
                    :style="{ width: `${s.plan.totalCount > 0 ? (s.plan.completedCount / s.plan.totalCount) * 100 : 0}%` }"
                  />
                </div>
              </div>

              <div
                v-if="s.agencyName || s.agents.find(a => a.isEntryPoint)?.roleName || s.branch"
                class="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]"
              >
                <span v-if="s.agencyName" class="text-foreground/80">
                  ◎ {{ s.agencyName }}
                </span>
                <span v-if="s.agents.find(a => a.isEntryPoint)?.roleName" class="text-muted-foreground">
                  {{ s.agents.find(a => a.isEntryPoint)?.roleName }}
                </span>
                <span
                  v-if="s.branch"
                  class="text-muted-foreground font-mono"
                >
                  ⎇ {{ s.branch }}
                </span>
              </div>

              <div
                class="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums mt-auto pt-1 border-t border-border/60"
              >
                <span>{{ s.events.length }} events</span>
                <span v-if="currentTool(s)" class="font-mono">
                  ▸ {{ currentTool(s) }}
                </span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
