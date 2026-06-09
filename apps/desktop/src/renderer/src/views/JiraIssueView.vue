<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { JiraActivityEntry } from '@shared/ipc-contract'
import { useRoute } from 'vue-router'
import { Bot, ChevronDown, Sparkles, User } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Comark } from '@comark/vue'
import { transcriptPlugins } from '@/lib/comark-config'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionStore } from '@/stores/sessions'
import { useJiraActivityStore, relativeTime } from '@/stores/jiraActivity'
import JiraStartSessionModal from './JiraStartSessionModal.vue'
import type { IssueTransition, StatusCategory, WorkItem, WorkItemStatus } from '@shared/ipc-contract'

const route = useRoute()
const { focusedProject } = useProjectsQuery()
const sessionStore = useSessionStore()
const activityStore = useJiraActivityStore()

const id = computed(() => route.params.id as string)
const item = ref<WorkItem | null>(null)
const loading = ref(false)
const availableTransitions = ref<IssueTransition[]>([])
const transitionsLoading = ref(false)
const statusUpdating = ref<string | null>(null)
const statusError = ref<string | null>(null)
const planError = ref<string | null>(null)
const planRunning = ref(false)
const startSessionOpen = ref(false)

const fallbackStatuses: WorkItemStatus[] = ['backlog', 'open', 'in_progress', 'in_review', 'done', 'closed']

const statusLabel: Record<WorkItemStatus, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

const statusClass: Record<WorkItemStatus, string> = {
  backlog: 'bg-slate-500/15 text-slate-400',
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  closed: 'bg-muted text-muted-foreground',
}

// Mirrors Jira's own lozenge palette keyed on statusCategory (To Do=gray, In Progress=blue,
// Done=green) — deterministic across orgs since status names are arbitrary.
const categoryClass: Record<StatusCategory, string> = {
  todo: 'bg-muted text-muted-foreground',
  'in-progress': 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
  unknown: 'bg-muted text-muted-foreground',
}

function transitionClass(t: IssueTransition): string {
  return t.toStatusCategory ? categoryClass[t.toStatusCategory] : statusClass[t.toStatus]
}

const itemStatusClass = computed(() => {
  const it = item.value
  if (!it) return ''
  return it.statusCategory ? categoryClass[it.statusCategory] : statusClass[it.status]
})

const priorityClass: Record<string, string> = {
  critical: 'text-red-500',
  highest: 'text-red-500',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  lowest: 'text-muted-foreground',
}

interface IssueTypeBadge { icon: string; cls: string }

function issueTypeBadge(type: string | undefined): IssueTypeBadge | null {
  if (!type) return null
  switch (type.toLowerCase()) {
    case 'epic':    return { icon: '⚡', cls: 'bg-purple-500/20 text-purple-400' }
    case 'story':   return { icon: '📋', cls: 'bg-blue-500/20 text-blue-400' }
    case 'task':    return { icon: '✓', cls: 'bg-blue-500/20 text-blue-400' }
    case 'bug':
    case 'defect':  return { icon: '●', cls: 'bg-red-500/20 text-red-400' }
    case 'sub-task':
    case 'subtask': return { icon: '↳', cls: 'bg-muted text-muted-foreground' }
    case 'feature': return { icon: '★', cls: 'bg-teal-500/20 text-teal-400' }
    default:        return { icon: '', cls: 'bg-muted text-muted-foreground' }
  }
}

async function loadTransitions(itemId: string) {
  transitionsLoading.value = true
  try {
    availableTransitions.value = await window.agentkeeper.workItems.getTransitions(itemId)
  } catch {
    availableTransitions.value = []
  } finally {
    transitionsLoading.value = false
  }
}

async function load() {
  loading.value = true
  statusError.value = null
  planError.value = null
  try {
    item.value = (await window.agentkeeper.workItems.get(id.value)) ?? null
    if (item.value) await loadTransitions(item.value.id)
  } finally {
    loading.value = false
  }
}

watch(id, load, { immediate: true })

async function applyTransition(t: IssueTransition) {
  if (!item.value) return
  statusError.value = null
  const prev = item.value
  // Optimistic: reflect the target status immediately; rollback on failure.
  item.value = { ...prev, status: t.toStatus, statusLabel: t.toStatusLabel, statusCategory: t.toStatusCategory }
  statusUpdating.value = t.name
  try {
    await window.agentkeeper.workItems.transition(prev.id, t.name)
    const refreshed = await window.agentkeeper.workItems.get(prev.id)
    if (refreshed) item.value = refreshed
    await loadTransitions(prev.id)
  } catch (err) {
    item.value = prev
    statusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    statusUpdating.value = null
  }
}

async function setStatus(newStatus: WorkItemStatus) {
  if (!item.value || newStatus === item.value.status) return
  statusError.value = null
  const prev = item.value
  // Optimistic update; no category color known for the fallback path.
  item.value = { ...prev, status: newStatus, statusLabel: statusLabel[newStatus], statusCategory: undefined }
  statusUpdating.value = newStatus
  try {
    await window.agentkeeper.workItems.updateStatus(prev.id, newStatus)
    const refreshed = await window.agentkeeper.workItems.get(prev.id)
    if (refreshed) item.value = refreshed
    await loadTransitions(prev.id)
  } catch (err) {
    item.value = prev
    statusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    statusUpdating.value = null
  }
}

async function planWithClaude() {
  if (!item.value) return
  planError.value = null
  planRunning.value = true
  const cur = item.value

  let projectPath: string | undefined
  try {
    const projKey = cur.externalRef.match(/^[A-Z]+/)?.[0]
    if (projKey) {
      const cfg = await window.agentkeeper.plugins.getConfig('jira') as { projectMappings?: { jiraProjectKey: string; projectPath: string }[] } | null
      const mapping = cfg?.projectMappings?.find(m => m.jiraProjectKey === projKey && m.projectPath)
      if (mapping) projectPath = mapping.projectPath
    }
  } catch {
    // config fetch failure is non-fatal; fall through to focused project
  }
  if (!projectPath) projectPath = focusedProject.value?.path
  if (!projectPath) {
    planError.value = 'No project mapping found for this Jira project. Configure mappings in Jira settings or focus a project in the sidebar.'
    planRunning.value = false
    return
  }

  let planId: string | null = null
  try {
    const plan = await window.agentkeeper.plans.create(projectPath, {
      title: `${cur.externalRef}: ${cur.title}`,
      externalRef: cur.externalRef,
      workItemId: cur.id,
      status: 'drafting',
      estimatedMinutes: 0,
      steps: [],
    })
    planId = plan.id
  } catch (err) {
    console.warn('[JiraIssueView] plan stub creation failed (non-fatal):', err)
  }
  const planRef = planId ? `id "${planId}"` : `externalRef "${cur.externalRef}"`
  const planningPrompt = `Analyze this Jira ticket and create a detailed implementation plan.
Ticket: ${cur.externalRef} — ${cur.title}${cur.body ? '\nDescription:\n' + cur.body : ''}

A draft plan has been created (status: "drafting")${planId ? ` with id "${planId}"` : ''}.

Research the codebase thoroughly, then call mcp__agentkeeper__update_plan with:
- ${planRef}
- status: "planned"
- estimatedMinutes: <sum of all step estimates>
- steps: array of 4–8 focused, concrete implementation steps

For each step:
- model: "claude-haiku-4-5" for fast reads/audits, "claude-sonnet-4-5" for implementation/refactoring, "claude-opus-4-5" for complex architecture
- agent: "explorer" for codebase analysis, "main" for implementation, "qa" for testing, "doc" for documentation
- parallel: true if this step can safely run concurrently with adjacent steps
- estimatedMinutes: realistic estimate
- instructions: specific actionable instructions for the agent that will execute this step

Do not use the Write tool for the plan. Use mcp__agentkeeper__update_plan only.`
  try {
    await sessionStore.start({
      projectPath,
      workItemId: cur.id,
      initialPrompt: planningPrompt,
    })
    await activityStore.addEntry(cur.externalRef, 'claude', 'Claude opened planning session')
    activity.value = await activityStore.getEntries(cur.externalRef)
  } catch (err) {
    planError.value = err instanceof Error ? err.message : String(err)
  } finally {
    planRunning.value = false
  }
}

const activity = ref<JiraActivityEntry[]>([])
watch(() => item.value?.externalRef, async (ticketRef) => {
  if (ticketRef) activity.value = await activityStore.getEntries(ticketRef)
}, { immediate: true })

const breadcrumb = computed(() => {
  if (!item.value) return ''
  const parts: string[] = []
  const projKey = item.value.externalRef.match(/^[A-Z]+/)?.[0]
  if (projKey) parts.push(`${projKey} Project`)
  if (item.value.parentRef) parts.push(item.value.parentRef)
  parts.push(item.value.externalRef)
  return parts
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      Loading…
    </div>

    <div v-else-if="!item" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      Issue not found.
    </div>

    <template v-else>
      <!-- Header bar -->
      <div class="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-border">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <template v-for="(seg, i) in breadcrumb" :key="i">
            <span v-if="i > 0" class="opacity-40">·</span>
            <span :class="i > 0 ? 'font-mono' : ''">{{ seg }}</span>
          </template>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <div v-if="planError" class="text-xs text-destructive max-w-48 truncate">{{ planError }}</div>
          <button
            class="text-xs px-2.5 py-1 rounded bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="planRunning"
            @click="planWithClaude"
          >
            {{ planRunning ? 'Planning…' : 'Plan with Claude' }}
          </button>
          <button
            class="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="startSessionOpen = true"
          >
            Start session
          </button>
        </div>
      </div>

      <!-- Two-column layout -->
      <div class="flex-1 min-h-0 flex overflow-hidden">
        <!-- Main content -->
        <div class="flex-1 min-w-0 overflow-y-auto p-6 space-y-5">
          <div>
            <div class="text-xs font-mono text-muted-foreground mb-1.5">{{ item.externalRef }}</div>
            <h1 class="text-lg font-semibold leading-snug">{{ item.title }}</h1>
            <div class="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span v-if="item.priority" :class="priorityClass[item.priority.toLowerCase()] ?? 'text-muted-foreground'">
                ⬆ {{ item.priority }}
              </span>
              <span v-if="item.issueType && issueTypeBadge(item.issueType)" class="px-1.5 py-0.5 rounded-full"
                :class="issueTypeBadge(item.issueType)!.cls">
                {{ item.issueType }}
              </span>
              <span v-if="item.storyPoints" class="text-muted-foreground">{{ item.storyPoints }}pts</span>
            </div>
          </div>

          <!-- Description -->
          <div v-if="item.body">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Description</div>
            <div class="prose prose-sm dark:prose-invert max-w-none text-sm bg-muted/20 rounded p-3">
              <Suspense>
                <Comark :markdown="item.body" :plugins="transcriptPlugins" />
                <template #fallback>
                  <span class="whitespace-pre-wrap break-words">{{ item.body }}</span>
                </template>
              </Suspense>
            </div>
          </div>

          <!-- Custom fields (rich-text only, e.g. Acceptance Criteria) -->
          <template v-if="item.customFields && Object.keys(item.customFields).length > 0">
            <div v-for="(value, name) in item.customFields" :key="name">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{{ name }}</div>
              <div class="prose prose-sm dark:prose-invert max-w-none text-sm bg-muted/20 rounded p-3">
                <Suspense>
                  <Comark :markdown="value" :plugins="transcriptPlugins" />
                  <template #fallback>
                    <span class="whitespace-pre-wrap break-words">{{ value }}</span>
                  </template>
                </Suspense>
              </div>
            </div>
          </template>
        </div>

        <!-- Right panel -->
        <aside class="w-72 shrink-0 border-l border-border overflow-y-auto p-4 space-y-5">
          <!-- Details -->
          <div>
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Details</div>
            <div class="space-y-2">
              <!-- Status with transitions -->
              <div class="space-y-1">
                <div class="text-xs text-muted-foreground">Status</div>
                <div v-if="transitionsLoading && availableTransitions.length === 0" class="text-xs text-muted-foreground">Loading…</div>
                <DropdownMenu v-else>
                  <DropdownMenuTrigger
                    class="text-xs px-2 py-0.5 rounded-full border border-current inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-wait"
                    :class="itemStatusClass"
                    :disabled="statusUpdating !== null"
                  >
                    {{ item.statusLabel ?? statusLabel[item.status] }}
                    <ChevronDown class="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <template v-if="availableTransitions.length > 0">
                      <DropdownMenuItem
                        v-for="t in availableTransitions"
                        :key="t.name"
                        class="text-xs"
                        @select="applyTransition(t)"
                      >
                        <span class="size-2 rounded-full" :class="transitionClass(t)" />
                        {{ t.toStatusLabel }}
                      </DropdownMenuItem>
                    </template>
                    <template v-else>
                      <DropdownMenuItem
                        v-for="s in fallbackStatuses"
                        :key="s"
                        class="text-xs"
                        :disabled="s === item.status"
                        @select="setStatus(s)"
                      >
                        <span class="size-2 rounded-full" :class="statusClass[s]" />
                        {{ statusLabel[s] }}
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div v-if="statusError" class="text-xs text-destructive">{{ statusError }}</div>
              </div>

              <div v-if="item.assignee" class="flex items-start gap-2">
                <span class="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Assignee</span>
                <span class="text-xs text-foreground">{{ item.assignee }}</span>
              </div>
              <div v-if="item.reporter" class="flex items-start gap-2">
                <span class="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Reporter</span>
                <span class="text-xs text-foreground">{{ item.reporter }}</span>
              </div>
              <div v-if="item.priority" class="flex items-start gap-2">
                <span class="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Priority</span>
                <span class="text-xs font-medium" :class="priorityClass[item.priority.toLowerCase()] ?? 'text-foreground'">
                  {{ item.priority }}
                </span>
              </div>
              <div v-if="item.issueType" class="flex items-start gap-2">
                <span class="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Type</span>
                <span class="text-xs px-1.5 py-0.5 rounded-full"
                  :class="issueTypeBadge(item.issueType)?.cls ?? 'bg-muted text-muted-foreground'">
                  {{ item.issueType }}
                </span>
              </div>
              <div v-if="item.storyPoints != null" class="flex items-start gap-2">
                <span class="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Points</span>
                <span class="text-xs text-foreground">{{ item.storyPoints }}</span>
              </div>

              <!-- Links -->
              <template v-if="item.links.length > 0">
                <div class="text-xs text-muted-foreground mt-1">Links</div>
                <div class="space-y-1">
                  <a
                    v-for="link in item.links"
                    :key="link.url"
                    :href="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-1.5 text-xs text-blue-400 hover:underline"
                  >
                    <span class="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">{{ link.type }}</span>
                    <span class="truncate">{{ link.label ?? link.url }}</span>
                  </a>
                </div>
              </template>
            </div>
          </div>

          <!-- Activity -->
          <div>
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Activity</div>
            <div v-if="activity.length === 0" class="text-xs text-muted-foreground/60">
              No activity yet.
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="entry in activity"
                :key="entry.id"
                class="flex items-start gap-2"
              >
                <component
                  :is="entry.actor === 'user' ? User : entry.actor === 'claude' ? Sparkles : Bot"
                  :size="12"
                  class="mt-0.5 shrink-0"
                  :class="entry.actor === 'claude' ? 'text-primary' : 'text-muted-foreground'"
                />
                <div class="min-w-0 flex-1">
                  <span class="text-xs text-foreground/80">{{ entry.message }}</span>
                  <span class="text-xs text-muted-foreground/60 ml-1.5">· {{ relativeTime(entry.createdAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </div>

  <JiraStartSessionModal
    v-if="item"
    :open="startSessionOpen"
    :item="item"
    @close="startSessionOpen = false"
    @started="startSessionOpen = false"
  />
</template>
