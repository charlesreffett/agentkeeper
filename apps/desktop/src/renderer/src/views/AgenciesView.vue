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
          @node-expand="graph.toggleExpanded"
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
      :all-roles="roles"
      :project-path="focusedProjectPath"
      @save="onCreateAgency"
      @cancel="showCreateModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import PageHeader from '@/components/PageHeader.vue'
import type { Agency, AgencyDraft, AgencyScope } from '@shared/ipc-contract'

const { focusedProject } = useProjectsQuery()

const focusedProjectPath = computed(() => focusedProject.value?.path ?? '')

const { agencies, isLoading, saveAgency: saveAgencyMutation, removeAgency: removeAgencyMutation } = useAgenciesQuery(focusedProjectPath)
const { roles } = useRolesQuery(focusedProjectPath)

const selectedAgencyId = ref<string | null>(null)

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
    graph.clearSelection()
  },
)
</script>
