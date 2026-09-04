<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { ROLE_EFFORT_VALUES, type AppSettings, type RoleEffort } from '@shared/ipc-contract'
import { Button } from '@/components/ui/button'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import ExecutionTargetPicker from '@/components/ExecutionTargetPicker.vue'
import EffortPicker from '@/components/EffortPicker.vue'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { useHarnessAuth, useHarnessList, useSetActiveHarness } from '@/composables/useHarness'
import { useSettingsLeavePrompt } from '@/composables/useSettingsLeavePrompt'
import { queryKeys } from '@/lib/queryKeys'

const queryClient = useQueryClient()
const { settings: storedSettings, saveSettings } = useSettingsQuery()
const { data: harnesses } = useHarnessList()
const { data: harnessAuth } = useHarnessAuth()
const setActiveHarness = useSetActiveHarness()

const draft = ref<Pick<AppSettings, 'defaultModel' | 'defaultEffort' | 'harnessId' | 'harnessBins'> | null>(null)
const baseline = ref<typeof draft.value>(null)
const configValues = ref<Record<string, string | boolean>>({})
const configBaseline = ref<Record<string, string | boolean>>({})
const secretInputs = ref<Record<string, string>>({})
const storedSecretFields = ref<string[]>([])
const saving = ref(false)
const authenticatingId = ref<string | null>(null)

watch(storedSettings, (value) => {
  if (!value || draft.value) return
  const next = {
    defaultModel: value.defaultModel,
    defaultEffort: ROLE_EFFORT_VALUES.includes(value.defaultEffort) ? value.defaultEffort : 'medium',
    harnessId: value.harnessId,
    harnessBins: { ...value.harnessBins },
  }
  draft.value = { ...next, harnessBins: { ...next.harnessBins } }
  baseline.value = { ...next, harnessBins: { ...next.harnessBins } }
}, { immediate: true })

const activeHarness = computed(() => harnesses.value?.find(item => item.id === draft.value?.harnessId))

function binaryPathFor(harnessId: string): string {
  return draft.value?.harnessBins?.[harnessId] ?? ''
}

function setBinaryPath(harnessId: string, value: string): void {
  if (!draft.value) return
  const harnessBins = { ...draft.value.harnessBins }
  if (value) harnessBins[harnessId] = value
  else delete harnessBins[harnessId]
  draft.value.harnessBins = harnessBins
}

watch(() => draft.value?.harnessId, async (id) => {
  if (!id) return
  const config = await window.agentkeeper.harness.getConfiguration(id)
  configValues.value = { ...config.values }
  configBaseline.value = { ...config.values }
  secretInputs.value = {}
  storedSecretFields.value = config.secretFields
}, { immediate: true })

const isDirty = computed(() => {
  return JSON.stringify(draft.value) !== JSON.stringify(baseline.value)
    || JSON.stringify(configValues.value) !== JSON.stringify(configBaseline.value)
    || Object.values(secretInputs.value).some(value => value.trim())
})

function changeDefaultEffort(value: string) {
  const effort = value as RoleEffort
  if (draft.value && ROLE_EFFORT_VALUES.includes(effort)) draft.value.defaultEffort = effort
}

function authFor(id: string) {
  return harnessAuth.value?.find(item => item.id === id)
}

async function authenticate(id: string) {
  authenticatingId.value = id
  try {
    await window.agentkeeper.harness.authenticate(id)
    await queryClient.invalidateQueries({ queryKey: queryKeys.harness.auth() })
    toast.success('Authentication completed')
  } catch (error) {
    toast.error('Could not authenticate', { description: error instanceof Error ? error.message : String(error) })
  } finally {
    authenticatingId.value = null
  }
}

async function removeSecret(fieldId: string) {
  if (!draft.value?.harnessId) return
  await window.agentkeeper.harness.deleteSecret(draft.value.harnessId, fieldId)
  storedSecretFields.value = storedSecretFields.value.filter(id => id !== fieldId)
}

async function save() {
  if (!draft.value || !isDirty.value) return
  saving.value = true
  try {
    const harnessBins = Object.fromEntries(
      Object.entries(draft.value.harnessBins ?? {})
        .map(([id, value]) => [id, value.trim()])
        .filter(([, value]) => value),
    )
    const harnessId = draft.value.harnessId
    if (harnessId) {
      await window.agentkeeper.harness.setConfiguration(harnessId, configValues.value)
      for (const [fieldId, value] of Object.entries(secretInputs.value)) {
        if (value.trim()) await window.agentkeeper.harness.setSecret(harnessId, fieldId, value.trim())
      }
      await setActiveHarness.mutateAsync(harnessId)
    }
    await saveSettings({ ...draft.value, harnessBins })
    draft.value.harnessBins = { ...harnessBins }
    baseline.value = { ...draft.value, harnessBins: { ...harnessBins } }
    configBaseline.value = { ...configValues.value }
    secretInputs.value = {}
    toast.success('Models and harnesses saved')
  } finally {
    saving.value = false
  }
}

function discard() {
  if (baseline.value) draft.value = { ...baseline.value, harnessBins: { ...baseline.value.harnessBins } }
  configValues.value = { ...configBaseline.value }
  secretInputs.value = {}
}

useSettingsLeavePrompt(isDirty, save)
</script>

<template>
  <SettingsPage title="Models & Harnesses" description="Choose how AgentKeeper runs new sessions and authenticates agent tools.">
    <template v-if="draft">
      <section class="space-y-3" aria-labelledby="defaults-heading">
        <h2 id="defaults-heading" class="text-sm font-semibold">New session defaults</h2>
        <div class="divide-y rounded-lg border">
          <div class="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(16rem,22rem)] sm:items-center">
            <div><p class="text-sm font-medium">Harness and model</p><p class="mt-0.5 text-xs text-muted-foreground">Used initially for new sessions and overridable in the composer.</p></div>
            <ExecutionTargetPicker :model-value="draft.defaultModel" :harness-id="draft.harnessId" :allow-agencies="false" :harness-switchable="true" display="field" @update:model-value="draft.defaultModel = $event" @update:harness-id="draft.harnessId = $event" />
          </div>
          <label class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Default effort</span><span class="mt-0.5 block text-xs text-muted-foreground">Thinking budget used for new sessions.</span></span>
            <div class="w-full sm:w-52">
              <EffortPicker
                :model-value="draft.defaultEffort"
                :model="draft.defaultModel"
                :harness-id="draft.harnessId"
                display="field"
                @update:model-value="changeDefaultEffort"
              />
            </div>
          </label>
        </div>
      </section>

      <section v-if="harnesses?.length" class="space-y-3" aria-labelledby="harnesses-heading">
        <h2 id="harnesses-heading" class="text-sm font-semibold">Available harnesses</h2>
        <div class="divide-y rounded-lg border">
          <div v-for="harness in harnesses" :key="harness.id" class="space-y-3 px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="size-2 shrink-0 rounded-full" :class="!harness.available || ['unauthenticated', 'expired'].includes(authFor(harness.id)?.status ?? '') ? 'bg-destructive' : authFor(harness.id)?.status === 'unknown' ? 'bg-amber-500' : 'bg-emerald-500'" aria-hidden="true" />
              <div class="min-w-0 flex-1"><p class="text-sm font-medium">{{ harness.name }}</p><p class="mt-0.5 text-xs text-muted-foreground">{{ harness.available ? (authFor(harness.id)?.detail ?? 'Available') : (harness.unavailableReason ?? 'Unavailable') }}</p></div>
              <Button v-if="harness.available && harness.authentication?.login" size="sm" variant="outline" :disabled="authenticatingId !== null || authFor(harness.id)?.status === 'authenticated'" @click="authenticate(harness.id)">{{ authenticatingId === harness.id ? 'Authenticating…' : authFor(harness.id)?.status === 'authenticated' ? 'Authenticated' : (harness.authentication.login.label ?? 'Authenticate') }}</Button>
            </div>
            <div class="grid gap-1.5 pl-5 sm:grid-cols-[minmax(10rem,1fr)_minmax(16rem,22rem)] sm:items-center">
              <label :for="`harness-binary-${harness.id}`" class="text-xs text-muted-foreground">Binary executable <span class="sr-only">for {{ harness.name }}</span></label>
              <input :id="`harness-binary-${harness.id}`" :value="binaryPathFor(harness.id)" type="text" autocomplete="off" :placeholder="`Auto-detect ${harness.name}`" class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @input="setBinaryPath(harness.id, ($event.target as HTMLInputElement).value)">
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeHarness?.configuration?.fields.length" class="space-y-3" aria-labelledby="configuration-heading">
        <div><h2 id="configuration-heading" class="text-sm font-semibold">{{ activeHarness.name }} configuration</h2><p class="mt-1 text-xs text-muted-foreground">Harness-specific values and credentials.</p></div>
        <div class="space-y-4 rounded-lg border p-4">
          <div v-for="field in activeHarness.configuration?.fields ?? []" :key="field.id" class="space-y-1.5">
            <label :for="`harness-${field.id}`" class="text-xs font-medium">{{ field.label }}</label>
            <p v-if="field.description" class="text-xs text-muted-foreground">{{ field.description }}</p>
            <select v-if="field.type === 'select'" :id="`harness-${field.id}`" v-model="configValues[field.id]" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option v-for="choice in field.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select>
            <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 text-sm"><input v-model="configValues[field.id]" type="checkbox"> Enabled</label>
            <input v-else-if="field.type === 'secret'" :id="`harness-${field.id}`" v-model="secretInputs[field.id]" type="password" autocomplete="off" :placeholder="storedSecretFields.includes(field.id) ? 'Stored — enter to replace' : field.placeholder" class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <input v-else :id="`harness-${field.id}`" v-model="configValues[field.id]" :type="field.type === 'url' ? 'url' : 'text'" :placeholder="field.placeholder" class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div v-if="field.type === 'secret' && storedSecretFields.includes(field.id)" class="flex items-center justify-between"><span class="text-xs text-muted-foreground">Stored in the OS keychain.</span><button type="button" class="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="removeSecret(field.id)">Remove</button></div>
          </div>
        </div>
      </section>
    </template>
    <p v-else class="text-sm text-muted-foreground">Loading models and harnesses…</p>

    <template #footer><footer class="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:px-6"><Button variant="ghost" size="sm" :disabled="!isDirty || saving" @click="discard">Discard</Button><Button size="sm" :disabled="!isDirty || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</Button></footer></template>
  </SettingsPage>
</template>
