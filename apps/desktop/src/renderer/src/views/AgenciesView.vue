<template>
  <div class="h-full flex overflow-hidden bg-background">
    <!-- Three-panel body -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left sidebar: scope + new agency + agency list -->
      <aside class="w-60 shrink-0 border-r border-border flex flex-col overflow-hidden">
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
        <div class="p-2 border-b border-border shrink-0">
          <Button class="w-full gap-1.5" @click="beginCreate">
            <Plus class="size-3.5" />
            New agency
          </Button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <AgencyList
            :agencies="agencies"
            :selected-id="selectedAgencyId"
            :loading="isLoading"
            @select="selectAgency"
          />
        </div>
      </aside>

      <!-- Center: graph canvas -->
      <main class="flex-1 relative overflow-hidden flex flex-col">
        <!-- Toolbar above graph — only when an agency is selected -->
        <div
          v-if="selectedAgency"
          class="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border bg-background"
        >
          <div class="flex items-center gap-3">
            <Transition
              enter-active-class="transition-opacity duration-150"
              leave-active-class="transition-opacity duration-500"
              enter-from-class="opacity-0"
              leave-to-class="opacity-0"
            >
              <span v-if="savedFlash" class="flex items-center gap-1 text-xs text-green-500">
                <Check class="w-3 h-3" />
                Saved
              </span>
            </Transition>
          </div>

          <button
            class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted transition-colors"
            @click="showAddRolePanel = !showAddRolePanel"
          >
            <Plus class="w-3.5 h-3.5" />
            Add role
          </button>
        </div>

        <div
          v-if="!selectedAgency"
          class="flex flex-1 items-center justify-center text-muted-foreground text-sm"
        >
          Select an agency to view its graph
        </div>

        <div v-else class="flex-1 relative overflow-hidden">
          <AddRolePanel
            v-if="showAddRolePanel"
            :roles="roles"
            :agency="selectedAgency"
            :project-path="scopedProjectPath"
            class="absolute top-0 left-0 z-10 h-full"
            @add-role="graph.addRole"
            @close="showAddRolePanel = false"
          />

          <FlowCanvas
            :nodes="graph.nodes.value"
            :edges="graph.edges.value"
            :flow-mode="graph.flowMode.value"
            :selected-node-id="graph.selectedNodeId.value"
            :selected-edge-id="graph.selectedEdgeId.value"
            :fit-on-load="true"
            @node-click="graph.selectNode"
            @edge-click="graph.selectEdge"
            @edge-remove="graph.removeConnection"
            @pane-click="graph.clearSelection"
            @connection="graph.addConnection"
            @edge-update="(id, conn) => graph.updateConnection(id, conn)"
            @node-move="graph.updateNodePosition"
            @node-expand="graph.toggleExpanded"
          />
        </div>
      </main>

      <!-- Right sidebar: context panel -->
      <aside v-if="selectedAgency" class="w-72 shrink-0 border-l border-border overflow-y-auto">
        <ConnectionPanel
          v-if="graph.selectedEdge.value"
          :edge="graph.selectedEdge.value"
          :agency="selectedAgency"
          @flip="() => graph.flipConnection(graph.selectedEdge.value!.id)"
          @remove="() => graph.removeConnection(graph.selectedEdge.value!.id)"
          @close="graph.clearSelection"
        />
        <RoleInAgencyPanel
          v-else-if="graph.selectedRoleSlot.value"
          :role-slot="graph.selectedRoleSlot.value"
          :agency="graph.effectiveAgency.value ?? selectedAgency"
          :role="roles.find(r => r.id === graph.selectedRoleSlot.value?.roleId)"
          @update-count="(mode, opts) => graph.updateInstanceCount(graph.selectedRoleSlot.value!.roleId, mode, opts)"
          @update-slot="patch => graph.updateRoleSlot(graph.selectedRoleSlot.value!.roleId, patch)"
          @toggle-entry="() => graph.toggleEntryPoint(graph.selectedRoleSlot.value!.roleId)"
          @close="graph.clearSelection"
          @select-edge="graph.selectEdge"
          @open-editor="openRoleEditor"
          @remove-role="id => { graph.removeRole(id); graph.clearSelection() }"
        />
        <AgencyDetailPanel
          v-else
          :agency="selectedAgency"
          @delete="onDeleteAgency"
          @update="onUpdateAgency"
        />
      </aside>
    </div>

    <!-- New agency modal -->
    <NewAgencyModal
      v-if="showCreateModal"
      :all-roles="roles"
      :project-path="scopedProjectPath"
      @save="onCreateAgency"
      @cancel="showCreateModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Plus, Check } from '@/components/icons/app-icons'
import { Button } from '@/components/ui/button'
import { useAgenciesQuery } from '@/composables/useAgenciesQuery'
import { useRolesQuery } from '@/composables/useRolesQuery'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePageScope, SCOPE_ALL } from '@/composables/usePageScope'
import { useFlowGraph } from '@/components/graph/useFlowGraph'
import FlowCanvas from '@/components/graph/FlowCanvas.vue'
import AgencyList from '@/components/agencies/AgencyList.vue'
import AgencyDetailPanel from '@/components/agencies/AgencyDetailPanel.vue'
import RoleInAgencyPanel from '@/components/agencies/RoleInAgencyPanel.vue'
import ConnectionPanel from '@/components/agencies/ConnectionPanel.vue'
import NewAgencyModal from '@/components/agencies/NewAgencyModal.vue'
import AddRolePanel from '@/components/agencies/AddRolePanel.vue'
import ScopeBar from '@/components/ScopeBar.vue'
import { type Agency, type AgencyDraft, type AgencyScope } from '@shared/ipc-contract'

const { scope, options, label, color, setScope, pickAndAdd, isAll, isGlobal, isProject, currentProject } =
  usePageScope('agencies', { includeGlobal: true })
const { projects } = useProjectsQuery()
const queryClient = useQueryClient()

// Concrete project path when a project is scoped, else '' (global/all).
const scopedProjectPath = computed(() => (isProject.value ? currentProject.value?.path ?? '' : ''))

// Scoped list input: project → its path (project + global); Global → null
// (global-only); All → '' to disable this query (the union query below serves
// All).
const agenciesQueryPath = computed(() =>
  isAll.value ? '' : isProject.value ? scopedProjectPath.value : null,
)

// Editor role options: project + global when a project is scoped, else global-only.
const rolesQueryPath = computed(() =>
  isProject.value && currentProject.value ? currentProject.value.path : null,
)

const {
  agencies: scopedAgencies,
  isLoading: scopedLoading,
  saveAgency: saveAgencyMutation,
  removeAgency: removeAgencyMutation,
} = useAgenciesQuery(agenciesQueryPath)
const { roles } = useRolesQuery(rolesQueryPath)

// All scope = union of global + every project's agencies, deduped by file path.
const { data: allAgencies, isLoading: allLoading } = useQuery({
  queryKey: computed(() => ['agencies', 'list', SCOPE_ALL, projects.value.map((p) => p.path).sort().join('|')]),
  enabled: isAll,
  queryFn: async () => {
    const paths = [null, ...projects.value.map((p) => p.path)]
    const lists = await Promise.all(paths.map((p) => window.agentkeeper.agencies.list(p)))
    const byPath = new Map<string, Agency>()
    for (const list of lists) for (const a of list) byPath.set(a.path, a)
    return Array.from(byPath.values()).sort((a, b) => a.name.localeCompare(b.name))
  },
})

const agencies = computed<Agency[]>(() => (isAll.value ? allAgencies.value ?? [] : scopedAgencies.value))
const isLoading = computed(() => (isAll.value ? allLoading.value : scopedLoading.value))

function invalidateAllScope(): void {
  void queryClient.invalidateQueries({ queryKey: ['agencies', 'list', SCOPE_ALL] })
}

const selectedAgencyId = ref<string | null>(null)
const showAddRolePanel = ref(false)
const savedFlash = ref(false)
let savedFlashTimer: ReturnType<typeof setTimeout> | null = null

function flashSaved() {
  savedFlash.value = true
  if (savedFlashTimer) clearTimeout(savedFlashTimer)
  savedFlashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
}

const selectedAgency = computed<Agency | null>(() => {
  if (!selectedAgencyId.value) return null
  return agencies.value.find(a => a.id === selectedAgencyId.value) ?? null
})

// Derive the project root for a project-scoped agency from its own file path.
// This is always authoritative: the scoped path can diverge from the agency's
// actual location if the user switches scope while a mutation is in-flight.
function agencyProjectPath(agencyScope: Agency['scope'], filePath: string): string {
  if (agencyScope === 'project' && filePath) {
    const marker = '/.agentkeeper/agencies/'
    const idx = filePath.indexOf(marker)
    if (idx !== -1) return filePath.slice(0, idx)
  }
  return scopedProjectPath.value
}

async function saveHelper(draft: Agency) {
  const scope = draft.scope
  const { scope: _s, path: agencyFilePath, ...agencyDraft } = draft
  const projectPath = agencyProjectPath(scope, agencyFilePath)
  // Deep-unwrap reactive proxies — contextBridge structured-clone fails on
  // Vue proxy arrays (roles, entryPoints) that survive a top-level spread.
  const plainDraft = JSON.parse(JSON.stringify(agencyDraft)) as typeof agencyDraft
  await saveAgencyMutation({ scope, path: projectPath, draft: plainDraft })
  invalidateAllScope()
  flashSaved()
}

async function deleteHelper() {
  if (!selectedAgency.value) return
  const { scope, path: agencyFilePath, id } = selectedAgency.value
  await removeAgencyMutation({
    scope,
    path: agencyProjectPath(scope, agencyFilePath),
    id,
  })
  invalidateAllScope()
  selectedAgencyId.value = null
}

const graph = useFlowGraph(selectedAgency, saveHelper, deleteHelper, roles)

const router = useRouter()

function openRoleEditor(roleId: string) {
  router.push({ path: '/roles', query: { select: roleId } })
}

function selectAgency(id: string) {
  selectedAgencyId.value = id
  graph.clearSelection()
}

const showCreateModal = ref(false)

function beginCreate() {
  showCreateModal.value = true
}

async function onCreateAgency(draft: AgencyDraft) {
  // Write target derives from the page context: Global/All → global (no
  // project to write to), a scoped project → that project.
  const scope: AgencyScope = isGlobal.value || isAll.value ? 'global' : 'project'
  await saveAgencyMutation({ scope, path: scopedProjectPath.value, draft })
  invalidateAllScope()
  showCreateModal.value = false
  // Select the newly created agency
  selectedAgencyId.value = draft.id
}

async function onDeleteAgency() {
  await graph.deleteAgency()
}

async function onUpdateAgency(draft: Agency) {
  const current = selectedAgency.value
  const idChanged = current && draft.id !== current.id
  const scopeChanged = current && draft.scope !== current.scope

  // Write new file first; only delete the old one once the write succeeds.
  await saveHelper(draft)

  if (current && (idChanged || scopeChanged)) {
    await removeAgencyMutation({
      scope: current.scope,
      path: agencyProjectPath(current.scope, current.path),
      id: current.id,
    })
    invalidateAllScope()
  }

  if (idChanged) {
    selectedAgencyId.value = draft.id
  }
}

watch(scope, () => {
  selectedAgencyId.value = null
  showAddRolePanel.value = false
  graph.clearSelection()
})

watch(
  () => selectedAgencyId.value,
  () => { showAddRolePanel.value = false },
)
</script>
