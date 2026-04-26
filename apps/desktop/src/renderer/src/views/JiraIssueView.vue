<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Bot, Sparkles, User } from 'lucide-vue-next'
import { useProjectsStore } from '@/stores/projects'
import { useSessionStore } from '@/stores/sessions'
import { useJiraActivityStore, relativeTime } from '@/stores/jiraActivity'
import JiraStartSessionModal from './JiraStartSessionModal.vue'
import type { IssueTransition, WorkItem, WorkItemStatus } from '@shared/ipc-contract'

const route = useRoute()
const projectsStore = useProjectsStore()
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
    availableTransitions.value = await window.orchestral.workItems.getTransitions(itemId)
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
    item.value = (await window.orchestral.workItems.get(id.value)) ?? null
    if (item.value) await loadTransitions(item.value.id)
  } finally {
    loading.value = false
  }
}

watch(id, load, { immediate: true })

async function applyTransition(transitionName: string) {
  if (!item.value) return
  statusError.value = null
  statusUpdating.value = transitionName
  try {
    await window.orchestral.workItems.transition(item.value.id, transitionName)
    const refreshed = await window.orchestral.workItems.get(item.value.id)
    if (refreshed) {
      item.value = refreshed
      await loadTransitions(item.value.id)
    }
  } catch (err) {
    statusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    statusUpdating.value = null
  }
}

async function setStatus(newStatus: WorkItemStatus) {
  if (!item.value || newStatus === item.value.status) return
  statusError.value = null
  statusUpdating.value = newStatus
  try {
    await window.orchestral.workItems.updateStatus(item.value.id, newStatus)
    const refreshed = await window.orchestral.workItems.get(item.value.id)
    if (refreshed) {
      item.value = refreshed
      await loadTransitions(item.value.id)
    }
  } catch (err) {
    statusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    statusUpdating.value = null
  }
}

async function planWithClaude() {
  if (!item.value) return
  planError.value = null
  const focusedProject = projectsStore.focusedProject
  if (!focusedProject) {
    planError.value = 'Focus a project in the sidebar before planning.'
    return
  }
  planRunning.value = true
  const cur = item.value
  const planningPrompt = `Analyze this Jira ticket and create a detailed implementation plan.
Ticket: ${cur.externalRef} — ${cur.title}${cur.body ? '\nDescription:\n' + cur.body : ''}

Write the plan as a markdown file to .claude/plans/${cur.externalRef}-plan.md (create the directory if needed).
Structure the plan with: Overview, Acceptance Criteria, Technical Approach, Implementation Steps, and Open Questions.`
  try {
    await sessionStore.start({
      projectPath: focusedProject.path,
      workItemId: cur.id,
      initialPrompt: planningPrompt,
    })
    activityStore.addEntry(cur.id, 'claude', 'Claude opened planning session')
  } catch (err) {
    planError.value = err instanceof Error ? err.message : String(err)
  } finally {
    planRunning.value = false
  }
}

const activity = computed(() => item.value ? activityStore.getEntries(item.value.id) : [])

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
            <div class="text-sm text-foreground/80 whitespace-pre-wrap font-mono bg-muted/20 rounded p-3 leading-relaxed">
              {{ item.body }}
            </div>
          </div>
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
                <div v-if="transitionsLoading" class="text-xs text-muted-foreground">Loading…</div>
                <div v-else class="flex flex-wrap gap-1">
                  <template v-if="availableTransitions.length > 0">
                    <button
                      v-for="t in availableTransitions"
                      :key="t.name"
                      class="text-xs px-2 py-0.5 rounded-full bg-muted/40 text-foreground/80 hover:opacity-90 transition-opacity"
                      :class="statusUpdating === t.name ? 'opacity-40 cursor-wait' : ''"
                      :disabled="statusUpdating !== null"
                      @click="applyTransition(t.name)"
                    >
                      {{ statusUpdating === t.name ? '…' : t.toStatusLabel }}
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-for="s in fallbackStatuses"
                      :key="s"
                      class="text-xs px-2 py-0.5 rounded-full border transition-opacity"
                      :class="[
                        statusClass[s],
                        s === item.status ? 'border-current opacity-100 ring-1 ring-current' : 'border-transparent opacity-60 hover:opacity-90',
                        statusUpdating === s ? 'opacity-40 cursor-wait' : '',
                      ]"
                      :disabled="statusUpdating !== null"
                      @click="setStatus(s)"
                    >
                      {{ statusUpdating === s ? '…' : statusLabel[s] }}
                    </button>
                  </template>
                </div>
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
                  <span class="text-xs text-muted-foreground/60 ml-1.5">· {{ relativeTime(entry.timestamp) }}</span>
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
