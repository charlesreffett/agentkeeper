<template>
  <div class="h-full flex flex-col overflow-hidden bg-background">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <h1 class="text-sm font-semibold text-foreground">Agencies</h1>
    </header>

    <!-- Three-panel body -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left sidebar: agency list -->
      <aside class="w-60 shrink-0 border-r border-border overflow-y-auto">
        <AgencyList
          :agencies="store.agencies"
          :selected-id="selectedAgencyId"
          :loading="store.loading"
          @select="selectAgency"
          @create="beginCreate"
        />
      </aside>

      <!-- Center: graph canvas -->
      <main class="flex-1 relative overflow-hidden">
        <div
          v-if="!selectedAgency"
          class="flex h-full items-center justify-center text-muted-foreground text-sm"
        >
          Select an agency to view its graph
        </div>
        <FlowCanvas
          v-else
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
          @node-move="graph.updateNodePosition"
        />
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
          @update-count="(mode, opts) => graph.updateInstanceCount(graph.selectedNodeId.value!, mode, opts)"
          @toggle-entry="() => graph.toggleEntryPoint(graph.selectedNodeId.value!)"
          @close="graph.clearSelection"
          @select-edge="graph.selectEdge"
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
      :all-roles="store.roles"
      :project-path="focusedProjectPath"
      @save="onCreateAgency"
      @cancel="showCreateModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAgenciesStore } from '@/stores/agencies'
import { useProjectsStore } from '@/stores/projects'
import { useFlowGraph } from '@/components/graph/useFlowGraph'
import FlowCanvas from '@/components/graph/FlowCanvas.vue'
import AgencyList from '@/components/agencies/AgencyList.vue'
import AgencyDetailPanel from '@/components/agencies/AgencyDetailPanel.vue'
import RoleInAgencyPanel from '@/components/agencies/RoleInAgencyPanel.vue'
import ConnectionPanel from '@/components/agencies/ConnectionPanel.vue'
import NewAgencyModal from '@/components/agencies/NewAgencyModal.vue'
import type { Agency, AgencyDraft, AgencyScope } from '@shared/ipc-contract'

const store = useAgenciesStore()
const projectsStore = useProjectsStore()

const focusedProjectPath = computed(() => projectsStore.focusedProject?.path ?? '')

const selectedAgencyId = ref<string | null>(null)

const selectedAgency = computed<Agency | null>(() => {
  if (!selectedAgencyId.value) return null
  return store.agencies.find(a => a.id === selectedAgencyId.value) ?? null
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
  await store.saveAgency(scope, projectPath, agencyDraft)
}

async function deleteHelper() {
  if (!selectedAgency.value) return
  await store.removeAgency(
    selectedAgency.value.scope,
    focusedProjectPath.value,
    selectedAgency.value.id,
  )
  selectedAgencyId.value = null
}

const graph = useFlowGraph(selectedAgency, saveHelper, deleteHelper)

function selectAgency(id: string) {
  selectedAgencyId.value = id
  graph.clearSelection()
}

const showCreateModal = ref(false)

function beginCreate() {
  showCreateModal.value = true
}

async function onCreateAgency(draft: AgencyDraft, scope: AgencyScope) {
  await store.saveAgency(scope, focusedProjectPath.value, draft)
  showCreateModal.value = false
  // Select the newly created agency
  selectedAgencyId.value = draft.id
}

async function onDeleteAgency() {
  await graph.deleteAgency()
}

async function onUpdateAgency(draft: Agency) {
  await saveHelper(draft)
}

watch(
  () => projectsStore.focusedProject,
  async () => {
    selectedAgencyId.value = null
    graph.clearSelection()
    await store.loadAll(focusedProjectPath.value)
  },
)

onMounted(async () => {
  await store.loadAll(focusedProjectPath.value)
})
</script>
