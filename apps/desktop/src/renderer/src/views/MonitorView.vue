<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/sessions'
import { useProjectStore } from '@/stores/project'
import type { LiveSession } from '@/stores/sessions'
import { formatRelativeTime, shortModel } from '@/lib/format'
import type { RecentProject } from '@shared/ipc-contract'

const router = useRouter()
const store = useSessionStore()
const projectStore = useProjectStore()

// Group live sessions by project so the grid gives a quick per-project read.
const grouped = computed(() => {
  const byProject = new Map<string, LiveSession[]>()
  for (const s of store.liveList) {
    const arr = byProject.get(s.projectPath) ?? []
    arr.push(s)
    byProject.set(s.projectPath, arr)
  }
  return Array.from(byProject.entries()).sort(([a], [b]) => a.localeCompare(b))
})

function projectFromPath(p: string): RecentProject {
  const name = p.split('/').filter(Boolean).pop() ?? p
  return { path: p, name, repo: null, lastOpenedAt: Date.now() }
}

function statusTone(s: LiveSession) {
  switch (s.status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'completed':
    case 'terminated':
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
    case 'terminated':
      return 'Terminated'
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

async function openSession(s: LiveSession) {
  projectStore.setProject(projectFromPath(s.projectPath))
  await router.push('/project')
  store.focus(s.localId)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <header
      class="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0"
    >
      <Button variant="ghost" size="sm" @click="router.push('/')">← Back</Button>
      <div class="flex-1">
        <div class="font-medium text-sm">Monitor</div>
        <div class="text-xs text-muted-foreground">
          {{ store.liveList.length }} active session{{
            store.liveList.length === 1 ? '' : 's'
          }}
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-6">
      <div
        v-if="store.liveList.length === 0"
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
                  v-if="shortModel(s.model)"
                  class="text-muted-foreground font-mono"
                >
                  · {{ shortModel(s.model) }}
                </span>
                <span class="ml-auto text-muted-foreground tabular-nums">
                  {{ formatRelativeTime(s.lastActivityAt) }}
                </span>
              </div>

              <div class="text-sm font-medium line-clamp-2 leading-snug min-h-10">
                {{ titleFor(s) }}
              </div>

              <div
                v-if="s.agencyName || s.roleName || s.branch"
                class="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]"
              >
                <span v-if="s.agencyName" class="text-foreground/80">
                  ◎ {{ s.agencyName }}
                </span>
                <span v-if="s.roleName" class="text-muted-foreground">
                  {{ s.roleName }}
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
