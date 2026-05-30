<template>
  <div class="h-full flex flex-col overflow-hidden bg-background">
    <PageHeader title="Agencies" />

    <!-- Three-panel body -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left sidebar: agency list -->
      <aside class="w-60 shrink-0 border-r border-border overflow-y-auto">
        <AgencyList
          :agencies="agencies"
          :selected-id="selectedAgencyId"
          :loading="isLoading"
          @select="selectAgency"
          @create="beginCreate"
        />
      </aside>

      <!-- Center: graph canvas -->
      <main class="flex-1 relative overflow-hidden flex flex-col">
        <!-- Toolbar above graph -->
        <div class="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border bg-background">
          <div class="flex items-center gap-1 text-xs rounded-lg border border-border p-0.5">
            <button
              class="flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors font-medium"
              :class="graphTab === 'graph' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="graphTab = 'graph'"
            >
              <PencilLine class="w-3.5 h-3.5" />
              Graph
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors font-medium"
              :class="graphTab === 'pipeline' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="graphTab = 'pipeline'"
            >
              <Layers class="w-3.5 h-3.5" />
              Pipeline
            </button>
          </div>

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
            <span v-if="selectedAgency" class="text-xs text-muted-foreground/60 select-none">
              drag handles to wire · ⌫ to delete
            </span>
          </div>

          <button
            v-if="selectedAgency"
            class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted transition-colors"
            @click="showAddRolePanel = !showAddRolePanel"
          >
            <Plus class="w-3.5 h-3.5" />
            Add role
          </button>
          <div v-else class="w-[90px]" />
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
            :project-path="focusedProjectPath"
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
          @update-count="(mode, opts) => graph.updateInstanceCount(graph.selectedNodeId.value!, mode, opts)"
          @update-slot="patch => graph.updateRoleSlot(graph.selectedNodeId.value!, patch)"
          @toggle-entry="() => graph.toggleEntryPoint(graph.selectedNodeId.value!)"
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
      :project-path="focusedProjectPath"
      @save="onCreateAgency"
      @cancel="showCreateModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PencilLine, Layers, Plus, Check } from 'lucide-vue-next'
import { useAgenciesQuery } from '@/composables/useAgenciesQuery'
import { useRolesQuery } from '@/composables/useRolesQuery'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useFlowGraph } from '@/components/graph/useFlowGraph'
import FlowCanvas from '@/components/graph/FlowCanvas.vue'
import AgencyList from '@/components/agencies/AgencyList.vue'
import AgencyDetailPanel from '@/components/agencies/AgencyDetailPanel.vue'
import RoleInAgencyPanel from '@/components/agencies/RoleInAgencyPanel.vue'
import ConnectionPanel from '@/components/agencies/ConnectionPanel.vue'
import NewAgencyModal from '@/components/agencies/NewAgencyModal.vue'
import AddRolePanel from '@/components/agencies/AddRolePanel.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { Agency, AgencyDraft, AgencyScope } from '@shared/ipc-contract'

const { focusedProject } = useProjectsQuery()

const focusedProjectPath = computed(() => focusedProject.value?.path ?? '')

const { agencies, isLoading, saveAgency: saveAgencyMutation, removeAgency: removeAgencyMutation } = useAgenciesQuery(focusedProjectPath)
const { roles } = useRolesQuery(focusedProjectPath)

const selectedAgencyId = ref<string | null>(null)
const graphTab = ref<'graph' | 'pipeline'>('graph')
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

async function saveHelper(draft: Agency) {
  const scope = draft.scope
  const { scope: _s, path: agencyFilePath, ...agencyDraft } = draft
  let projectPath = focusedProjectPath.value
  if (scope === 'project' && !projectPath && agencyFilePath) {
    // focusedProject may be unset; recover the project root from the agency's file path
    // agencyFilePath = <projectRoot>/.agentkeeper/agencies/<id>.md
    const marker = '/.agentkeeper/agencies/'
    const idx = agencyFilePath.indexOf(marker)
    if (idx !== -1) projectPath = agencyFilePath.slice(0, idx)
  }
  // Deep-unwrap reactive proxies — contextBridge structured-clone fails on
  // Vue proxy arrays (roles, entryPoints) that survive a top-level spread.
  const plainDraft = JSON.parse(JSON.stringify(agencyDraft)) as typeof agencyDraft
  await saveAgencyMutation({ scope, path: projectPath, draft: plainDraft })
  flashSaved()
}

async function deleteHelper() {
  if (!selectedAgency.value) return
  await removeAgencyMutation({
    scope: selectedAgency.value.scope,
    path: focusedProjectPath.value,
    id: selectedAgency.value.id,
  })
  selectedAgencyId.value = null
}

const graph = useFlowGraph(selectedAgency, saveHelper, deleteHelper)

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

async function onCreateAgency(draft: AgencyDraft, scope: AgencyScope) {
  await saveAgencyMutation({ scope, path: focusedProjectPath.value, draft })
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
      path: focusedProjectPath.value,
      id: current.id,
    })
  }

  if (idChanged) {
    selectedAgencyId.value = draft.id
  }
}

watch(
  () => focusedProject.value,
  () => {
    selectedAgencyId.value = null
    showAddRolePanel.value = false
    graph.clearSelection()
  },
)

watch(
  () => selectedAgencyId.value,
  () => { showAddRolePanel.value = false },
)
</script>
