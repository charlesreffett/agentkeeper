<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Directive } from 'vue'
import { ChevronDown, ChevronRight, Folder, FolderOpen, MessageCircle, MoreHorizontal, Pencil, Plus, Settings } from 'lucide-vue-next'
import { TreeItem, TreeRoot } from 'reka-ui'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview'
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'
import { attachInstruction, extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotVariants } from '@/components/ui/status-dot'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ProjectManagerDialog from '@/components/ProjectManagerDialog.vue'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useUnifiedSessions, type UnifiedSession } from '@/composables/useUnifiedSessions'
import { formatRelativeTime } from '@/lib/format'
import type { LiveSessionStatus } from '@shared/ipc-contract'

const props = defineProps<{ collapsed: boolean; activeId: string }>()
defineEmits<{ collapse: []; expand: [] }>()

type SessionNode = { type: 'session'; key: string; session: UnifiedSession }
type EmptyNode = { type: 'empty'; key: string }
type ProjectNode = { type: 'project'; key: string; path: string; name: string; registered: boolean; children: SessionNode[] }
type SectionNode = { type: 'section'; key: string; name: string; children: ProjectNode[] }
type TreeNode = SectionNode | ProjectNode | SessionNode | EmptyNode

const EXPANDED_PROJECTS_STORAGE_KEY = 'agentkeeper:sessions-sidebar:expanded-projects'

function readExpandedProjects(): string[] | null {
  try {
    const stored = localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY)
    if (stored === null) return null
    const parsed = JSON.parse(stored) as unknown
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : null
  } catch {
    return null
  }
}

const router = useRouter()
const { projects, reorder } = useProjectsQuery()
const { unifiedSessions, open, createNewSession } = useUnifiedSessions()
const manageProjectsOpen = ref(false)
const restoredExpandedProjects = readExpandedProjects()
const expandedProjects = ref<string[]>(restoredExpandedProjects ?? [])
let projectExpansionHydrated = false
const draggedProjectPath = ref<string | null>(null)
const dropTarget = ref<{ path: string; position: 'before' | 'after' } | null>(null)
let stopProjectMonitor: (() => void) | null = null

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
    registered: true,
    children: (sessionsByPath.get(project.path) ?? []).map(toSessionNode),
  }))

  for (const [path, sessions] of sessionsByPath) {
    if (knownPaths.has(path)) continue
    nodes.push({
      type: 'project',
      key: `project:${path}`,
      path,
      name: sessions[0]?.projectName || path.split('/').at(-1) || path,
      registered: false,
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
const lastRegisteredProject = computed(() =>
  projectNodes.value.slice().reverse().find((project) => project.registered) ?? null,
)

watch(projectNodes, (nodes, previous) => {
  if (!projectExpansionHydrated) {
    if (nodes.length === 0) return
    if (restoredExpandedProjects === null) {
      expandedProjects.value = ['section:projects', ...nodes.map((node) => node.key)]
    }
    projectExpansionHydrated = true
    return
  }
  const previousKeys = new Set(previous?.map((node) => node.key) ?? [])
  const added = nodes.filter((node) => !previousKeys.has(node.key)).map((node) => node.key)
  if (added.length) expandedProjects.value = [...new Set(['section:projects', ...expandedProjects.value, ...added])]
}, { immediate: true })

watch(expandedProjects, (keys) => {
  try {
    localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Expansion persistence is optional when storage is unavailable.
  }
})

const recentSessions = computed(() => sortedSessions.value.filter((session) => !session.projectPath))

function treeChildren(node: TreeNode): TreeNode[] | undefined {
  if (node.type === 'section') return node.children
  if (node.type === 'project') {
    return node.children.length ? node.children : [{ type: 'empty', key: `empty:${node.path}` }]
  }
  return undefined
}

function statusDotVariant(status: LiveSessionStatus | 'inactive'): StatusDotVariants['variant'] {
  switch (status) {
    case 'running':
    case 'starting': return 'running'
    case 'idle':
    case 'inactive': return 'idle'
    case 'suspended': return 'suspended'
    case 'blocked': return 'blocked'
    case 'error': return 'error'
    default: return 'idle'
  }
}

async function handleNew(projectPath: string | null = null) {
  const localId = await createNewSession(projectPath)
  if (!localId) void router.push('/')
}

function createProjectDragPreview(source: HTMLElement, container: HTMLElement) {
  const content = source.querySelector<HTMLElement>('[data-project-drag-preview]')
  if (!content) return
  const preview = content.cloneNode(true) as HTMLElement
  Object.assign(preview.style, {
    display: 'inline-flex',
    width: 'max-content',
    maxWidth: '220px',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    padding: '6px 10px',
    borderRadius: '8px',
    background: 'var(--popover)',
    color: 'var(--popover-foreground)',
    boxShadow: 'var(--shadow-popover)',
  })
  const label = preview.querySelector<HTMLElement>('[data-project-drag-label]')
  if (label) Object.assign(label.style, { flex: 'none', maxWidth: '170px' })
  container.append(preview)
}

type ProjectDndBinding = { project: ProjectNode; isExpanded: boolean }
const projectDndCleanups = new WeakMap<HTMLElement, { cleanup: () => void; isExpanded: boolean; path: string }>()

function registerProjectDnd(element: HTMLElement, binding: ProjectDndBinding) {
  const { project, isExpanded } = binding
  if (!project.registered) return
  const cleanup = combine(
    draggable({
      element,
      getInitialData: () => ({ type: 'project', path: project.path }),
      onDragStart: () => {
        draggedProjectPath.value = project.path
      },
      onDrop: handleProjectDragEnd,
      onGenerateDragPreview({ nativeSetDragImage }) {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: pointerOutsideOfPreview({ x: '16px', y: '8px' }),
          render({ container }) {
            createProjectDragPreview(element, container)
            return () => {}
          },
        })
      },
    }),
    dropTargetForElements({
      element,
      canDrop: ({ source }) => source.data.type === 'project' && source.data.path !== project.path,
      getData: ({ input, element: targetElement }) => attachInstruction(
        { type: 'project', path: project.path },
        {
          input,
          element: targetElement,
          operations: {
            'reorder-before': 'available',
            'reorder-after': isExpanded ? 'not-available' : 'available',
          },
        },
      ),
      onDrag({ self }) {
        const instruction = extractInstruction(self.data)
        dropTarget.value = instruction
          ? { path: project.path, position: instruction.operation === 'reorder-before' ? 'before' : 'after' }
          : null
      },
      onDragLeave() {
        if (dropTarget.value?.path === project.path) dropTarget.value = null
      },
      onDrop() {
        if (dropTarget.value?.path === project.path) dropTarget.value = null
      },
      getIsSticky: () => true,
    }),
  )
  projectDndCleanups.set(element, { cleanup, isExpanded, path: project.path })
}

const vProjectDnd: Directive<HTMLElement, ProjectDndBinding> = {
  mounted(element, { value }) {
    registerProjectDnd(element, value)
  },
  updated(element, { value }) {
    const current = projectDndCleanups.get(element)
    if (current?.path === value.project.path && current.isExpanded === value.isExpanded) return
    current?.cleanup()
    registerProjectDnd(element, value)
  },
  unmounted(element) {
    projectDndCleanups.get(element)?.cleanup()
    projectDndCleanups.delete(element)
  },
}

const projectEndDndCleanups = new WeakMap<HTMLElement, () => void>()
const vProjectDndEnd: Directive<HTMLElement, string> = {
  mounted(element, { value: path }) {
    const cleanup = dropTargetForElements({
      element,
      canDrop: ({ source }) => source.data.type === 'project' && source.data.path !== path,
      getData: ({ input, element: targetElement }) => attachInstruction(
        { type: 'project', path },
        {
          input,
          element: targetElement,
          operations: { 'reorder-after': 'available' },
        },
      ),
      onDrag({ self }) {
        const instruction = extractInstruction(self.data)
        dropTarget.value = instruction ? { path, position: 'after' } : null
      },
      onDragLeave() {
        if (dropTarget.value?.path === path) dropTarget.value = null
      },
      onDrop() {
        if (dropTarget.value?.path === path) dropTarget.value = null
      },
    })
    projectEndDndCleanups.set(element, cleanup)
  },
  unmounted(element) {
    projectEndDndCleanups.get(element)?.()
    projectEndDndCleanups.delete(element)
  },
}

async function persistProjectDrop(sourcePath: string, targetPath: string, position: 'before' | 'after') {
  if (sourcePath === targetPath) return
  const paths = projects.value.map((entry) => entry.path).filter((path) => path !== sourcePath)
  const targetIndex = paths.indexOf(targetPath)
  if (targetIndex < 0) return
  paths.splice(targetIndex + (position === 'after' ? 1 : 0), 0, sourcePath)
  await reorder(paths)
}

onMounted(() => {
  stopProjectMonitor = monitorForElements({
    canMonitor: ({ source }) => source.data.type === 'project',
    onDrop({ source, location }) {
      const target = location.current.dropTargets[0]
      const instruction = target ? extractInstruction(target.data) : null
      const sourcePath = source.data.path
      const targetPath = target?.data.path
      if (typeof sourcePath !== 'string' || typeof targetPath !== 'string' || !instruction) return
      const position = instruction.operation === 'reorder-before' ? 'before' : 'after'
      void persistProjectDrop(sourcePath, targetPath, position)
    },
  })
})

onUnmounted(() => {
  stopProjectMonitor?.()
  stopProjectMonitor = null
})

function handleProjectDragEnd() {
  draggedProjectPath.value = null
  dropTarget.value = null
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
              class="group relative flex h-[30px] items-center gap-1 rounded-md px-1.5 text-sm text-foreground hover:bg-accent"
              :class="[
                item.value.registered ? 'cursor-grab active:cursor-grabbing' : '',
                draggedProjectPath === item.value.path ? 'opacity-40' : '',
              ]"
              v-project-dnd="{ project: item.value, isExpanded }"
            >
              <span
                v-if="dropTarget?.path === item.value.path"
                class="pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-primary"
                :class="dropTarget.position === 'before' ? 'top-0' : 'bottom-0'"
              />
              <div data-project-drag-preview class="flex min-w-0 flex-1 items-center gap-1">
                <component :is="isExpanded ? FolderOpen : Folder" class="size-3.5 shrink-0 text-muted-foreground" />
                <span data-project-drag-label class="min-w-0 flex-1 truncate font-normal">{{ item.value.name }}</span>
              </div>
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
              v-else-if="item.value.type === 'session'"
              class="flex w-full items-center gap-2 rounded-md py-[5px] pr-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              :class="item.value.session.localId === activeId ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent hover:text-accent-foreground'"
              style="padding-left: 28px"
              @click="open(item.value.session)"
            >
              <StatusDot :variant="statusDotVariant(item.value.session.status)" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ item.value.session.title }}</span>
              <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{{ formatRelativeTime(item.value.session.lastActivityAt) }}</span>
            </button>

            <div
              v-else
              class="flex h-[30px] items-center text-xs text-muted-foreground"
              style="padding-left: 28px"
            >
              No sessions
            </div>
          </TreeItem>
        </TreeRoot>
        <div
          v-if="draggedProjectPath && lastRegisteredProject && draggedProjectPath !== lastRegisteredProject.path"
          v-project-dnd-end="lastRegisteredProject.path"
          class="relative h-2"
        >
          <span
            v-if="dropTarget?.path === lastRegisteredProject.path && dropTarget.position === 'after'"
            class="pointer-events-none absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-primary"
          />
        </div>
      </section>

      <section v-if="recentSessions.length" class="mt-4">
        <h2 class="px-1.5 pb-1.5 text-[11px] font-medium text-muted-foreground">Recents</h2>
        <button
          v-for="session in recentSessions"
          :key="session.localId"
          class="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          :class="session.localId === activeId ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent hover:text-accent-foreground'"
          @click="open(session)"
        >
          <StatusDot :variant="statusDotVariant(session.status)" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ session.title }}</span>
          <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{{ formatRelativeTime(session.lastActivityAt) }}</span>
        </button>
      </section>

      <div v-if="projectNodes.length === 0 && recentSessions.length === 0" class="px-3 py-4 text-center text-[12px] text-muted-foreground/50">No sessions</div>
    </div>
  </div>

  <ProjectManagerDialog v-model:open="manageProjectsOpen" />
</template>
