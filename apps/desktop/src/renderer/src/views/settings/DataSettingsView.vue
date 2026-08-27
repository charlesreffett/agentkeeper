<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import ScopeBar from '@/components/ScopeBar.vue'
import { usePageScope } from '@/composables/usePageScope'
import { useSettingsQuery } from '@/composables/useSettingsQuery'

const { scope, options, setScope, pickAndAdd, label, color, isProject, currentProject } = usePageScope('settings-data', { includeGlobal: true })
const { invalidateAll } = useSettingsQuery()
const projectPath = computed(() => isProject.value ? currentProject.value?.path ?? '' : '')
const resetApp = ref(false)
const resetProject = ref(false)
const resetGlobal = ref(false)
const resetting = ref(false)
const message = ref<string | null>(null)
const canReset = computed(() => resetApp.value || resetGlobal.value || (resetProject.value && !!projectPath.value))

async function resetSelected() {
  if (!canReset.value) return
  const scopes = [resetApp.value && 'app settings', resetProject.value && projectPath.value && 'project definitions', resetGlobal.value && 'global definitions'].filter(Boolean)
  if (!window.confirm(`Permanently reset ${scopes.join(', ')}? This cannot be undone.`)) return
  resetting.value = true
  try {
    const result = await window.agentkeeper.reset.execute({
      appSettings: resetApp.value,
      projectDefinitions: resetProject.value && projectPath.value ? { projectPath: projectPath.value } : null,
      globalDefinitions: resetGlobal.value,
    })
    const cleared = [result.appSettingsCleared && 'app settings', result.projectDefinitionsCleared && 'project definitions', result.globalDefinitionsCleared && 'global definitions'].filter(Boolean)
    message.value = result.errors.length ? `Cleared: ${cleared.join(', ') || 'nothing'}. Errors: ${result.errors.join('; ')}` : `Cleared: ${cleared.join(', ')}. Restart AgentKeeper to pick up all changes.`
    resetApp.value = resetProject.value = resetGlobal.value = false
    invalidateAll()
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <SettingsPage title="Data & Reset" description="Reset application or project configuration.">
    <template #actions><ScopeBar :scope="scope" :options="options" :label="label" :color="color" @select="setScope" @pick-and-add="pickAndAdd" /></template>
    <section class="space-y-3" aria-labelledby="reset-heading">
      <div><h2 id="reset-heading" class="text-sm font-semibold text-destructive">Danger zone</h2><p class="mt-1 text-xs text-muted-foreground">Worktrees and agent CLI state are never removed.</p></div>
      <div class="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <label class="flex items-start gap-3"><input v-model="resetApp" type="checkbox" class="mt-0.5 size-4 rounded border-input"><span><span class="block text-sm font-medium">App settings</span><span class="block text-xs text-muted-foreground">Restore model, effort, appearance, and application preferences.</span></span></label>
        <label v-if="projectPath" class="flex items-start gap-3"><input v-model="resetProject" type="checkbox" class="mt-0.5 size-4 rounded border-input"><span class="min-w-0"><span class="block text-sm font-medium">Project definitions</span><span class="block truncate font-mono text-xs text-muted-foreground">{{ projectPath }}/.agentkeeper/</span></span></label>
        <label class="flex items-start gap-3"><input v-model="resetGlobal" type="checkbox" class="mt-0.5 size-4 rounded border-input"><span><span class="block text-sm font-medium">Global definitions</span><span class="block font-mono text-xs text-muted-foreground">~/.agentkeeper/</span></span></label>
        <p v-if="message" class="rounded-md border bg-background/70 px-3 py-2 text-xs" role="status">{{ message }}</p>
        <div class="flex justify-end"><Button variant="destructive" size="sm" :disabled="!canReset || resetting" @click="resetSelected">{{ resetting ? 'Resetting…' : 'Reset selected' }}</Button></div>
      </div>
    </section>
  </SettingsPage>
</template>
