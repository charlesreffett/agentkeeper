<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Folder, FolderOpen, MessageCircle, MoreHorizontal, Pencil, Plus, Settings } from 'lucide-vue-next'
import { TreeItem, TreeRoot } from 'reka-ui'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ProjectManagerDialog from '@/components/ProjectManagerDialog.vue'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useUnifiedSessions, type UnifiedSession } from '@/composables/useUnifiedSessions'
import { formatRelativeTime } from '@/lib/format'
import type { LiveSessionStatus } from '@shared/ipc-contract'

const props = defineProps<{ collapsed: boolean; activeId: string }>()
defineEmits<{ collapse: []; expand: [] }>()

type SessionNode = { type: 'session'; key: string; session: UnifiedSession }
type ProjectNode = { type: 'project'; key: string; path: string; name: string; children: SessionNode[] }
type SectionNode = { type: 'section'; key: string; name: string; children: ProjectNode[] }
type TreeNode = SectionNode | ProjectNode | SessionNode

const router = useRouter()
const { projects } = useProjectsQuery()
const { unifiedSessions, open, createNewSession } = useUnifiedSessions()
const manageProjectsOpen = ref(false)
const expandedProjects = ref<string[]>([])

const sortedSessions = computed(() =>
  unifiedSessions.value.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt),
)

function toSessionNode(session: UnifiedSession): SessionNode {
  return { type: 'session', key: `session:${session.localId}`, session }
}

const projectNodes = computed<ProjectNode[]>(() => {
  const sessionsByPath = new Map<string, UnifiedSession[]>()
  for (const session of sortedSessions.value) {
    if (!session.projectPath) continue
    const sessions = sessionsByPath.get(session.projectPath) ?? []
    sessions.push(session)
    sessionsByPath.set(session.projectPath, sessions)
  }

  const knownPaths = new Set(projects.value.map((project) => project.path))
  const nodes = projects.value.map((project) => ({
    type: 'project' as const,
    key: `project:${project.path}`,
    path: project.path,
    name: project.name,
    children: (sessionsByPath.get(project.path) ?? []).map(toSessionNode),
  }))

  for (const [path, sessions] of sessionsByPath) {
    if (knownPaths.has(path)) continue
    nodes.push({
      type: 'project',
      key: `project:${path}`,
      path,
      name: sessions[0]?.projectName || path.split('/').at(-1) || path,
      children: sessions.map(toSessionNode),
    })
  }
  return nodes
})

const projectTree = computed<SectionNode[]>(() => [{
  type: 'section',
  key: 'section:projects',
  name: 'Projects',
  children: projectNodes.value,
}])

watch(projectNodes, (nodes, previous) => {
  const previousKeys = new Set(previous?.map((node) => node.key) ?? [])
  const added = nodes.filter((node) => !previousKeys.has(node.key)).map((node) => node.key)
  if (added.length) expandedProjects.value = [...new Set(['section:projects', ...expandedProjects.value, ...added])]
}, { immediate: true })

const recentSessions = computed(() => sortedSessions.value.filter((session) => !session.projectPath))

function treeChildren(node: TreeNode): TreeNode[] | undefined {
  return node.type === 'session' ? undefined : node.children
}

function statusDotClass(status: LiveSessionStatus | 'inactive'): string {
  switch (status) {
    case 'running':
    case 'starting': return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'inactive': return 'bg-muted-foreground'
    case 'suspended': return 'bg-amber-500'
    case 'blocked': return 'bg-blue-500'
    case 'error': return 'bg-destructive'
    default: return 'bg-muted-foreground'
  }
}

async function handleNew(projectPath: string | null = null) {
  const localId = await createNewSession(projectPath)
  if (!localId) void router.push('/')
}
</script>

<template>
  <div v-if="collapsed" class="w-7 shrink-0 flex flex-col items-center pt-2 border-r border-border">
    <button class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded" title="Expand sessions" @click="$emit('expand')">
      <ChevronRight class="size-3.5" />
    </button>
  </div>

  <div v-else class="w-[260px] shrink-0 flex flex-col border-r border-border overflow-hidden bg-background">
    <div class="p-2 shrink-0 border-b border-border">
      <Button class="w-full gap-1.5" @click="handleNew()">
        <Plus class="size-3.5" />
        New session
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto px-2 py-3">
      <section v-if="projectNodes.length">
        <TreeRoot
          v-slot="{ flattenItems }"
          v-model:expanded="expandedProjects"
          class="flex flex-col gap-0.5 outline-none"
          :items="projectTree"
          :get-key="(node: TreeNode) => node.key"
          :get-children="treeChildren"
        >
          <TreeItem
            v-for="item in flattenItems"
            :key="item._id"
            v-slot="{ isExpanded }"
            v-bind="item.bind"
            class="outline-none"
            @select.prevent
          >
            <div
              v-if="item.value.type === 'section'"
              class="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent"
            >
              <component :is="isExpanded ? ChevronDown : ChevronRight" class="size-3.5 shrink-0" />
              <span>{{ item.value.name }}</span>
            </div>

            <div
              v-else-if="item.value.type === 'project'"
              class="group flex h-8 items-center gap-1 rounded-md px-1.5 text-sm text-foreground hover:bg-accent"
            >
              <component :is="isExpanded ? FolderOpen : Folder" class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate font-medium">{{ item.value.name }}</span>
              <div class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" @click.stop>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <button class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground" :aria-label="`Actions for ${item.value.name}`">
                      <MoreHorizontal class="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-64">
                    <div class="px-2 py-1.5">
                      <div class="flex items-center gap-2 text-sm font-medium">
                        <Folder class="size-4 text-muted-foreground" />
                        <span class="truncate">{{ item.value.name }}</span>
                      </div>
                      <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <MessageCircle class="size-3.5" />
                        {{ item.value.children.length }} session{{ item.value.children.length === 1 ? '' : 's' }}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <div class="px-2 py-1.5 text-xs text-muted-foreground font-mono break-all">{{ item.value.path }}</div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem @click="manageProjectsOpen = true">
                      <Settings class="mr-2 size-4" />
                      Edit project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground"
                  :aria-label="`New session in ${item.value.name}`"
                  :title="`New session in ${item.value.name}`"
                  @click="handleNew(item.value.path)"
                >
                  <Pencil class="size-3.5" />
                </button>
              </div>
            </div>

            <button
              v-else
              class="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              :class="item.value.session.localId === activeId ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent hover:text-accent-foreground'"
              style="padding-left: 28px"
              @click="open(item.value.session)"
            >
              <span class="size-1.5 shrink-0 rounded-full" :class="statusDotClass(item.value.session.status)" />
              <span class="min-w-0 flex-1 truncate text-[12px]">{{ item.value.session.title }}</span>
              <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{{ formatRelativeTime(item.value.session.lastActivityAt) }}</span>
            </button>
          </TreeItem>
        </TreeRoot>
      </section>

      <section v-if="recentSessions.length" class="mt-4">
        <h2 class="px-1.5 pb-1.5 text-[11px] font-medium text-muted-foreground">Recents</h2>
        <button
          v-for="session in recentSessions"
          :key="session.localId"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          :class="session.localId === activeId ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent hover:text-accent-foreground'"
          @click="open(session)"
        >
          <span class="size-1.5 shrink-0 rounded-full" :class="statusDotClass(session.status)" />
          <span class="min-w-0 flex-1 truncate text-[12px]">{{ session.title }}</span>
          <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{{ formatRelativeTime(session.lastActivityAt) }}</span>
        </button>
      </section>

      <div v-if="projectNodes.length === 0 && recentSessions.length === 0" class="px-3 py-4 text-center text-[12px] text-muted-foreground/50">No sessions</div>
    </div>
  </div>

  <ProjectManagerDialog v-model:open="manageProjectsOpen" />
</template>
