<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Bot, Check, ChevronDown, Network, Search } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useActiveHarness, useHarnessList } from '@/composables/useHarness'
import { useModelsQuery, type ModelOption } from '@/composables/useModelsQuery'
import type { Agency, AvailableModel } from '@shared/ipc-contract'

const props = defineProps<{ modelValue: string; harnessId?: string; agencyKey: string; agencies: Agency[]; disabled?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:harnessId': [value: string]
  'update:agencyKey': [value: string]
}>()

const open = ref(false)
const tab = ref<'models' | 'agencies'>(props.agencyKey ? 'agencies' : 'models')
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const browsingHarnessId = ref<string | undefined>(props.harnessId)
const { data: harnesses } = useHarnessList()
const { data: activeHarness } = useActiveHarness()
const { models, isLoading, error } = useModelsQuery(() => browsingHarnessId.value)
const { resolvedLabelFor } = useModelsQuery(() => props.harnessId)
const allHarnessModels = ref<Array<{ harnessId: string; harnessName: string; model: AvailableModel }>>([])
const isLoadingAllModels = ref(false)

const selectedAgency = computed(() => props.agencies.find((a) => `${a.scope}:${a.id}` === props.agencyKey))
const triggerLabel = computed(() => selectedAgency.value?.name ?? resolvedLabelFor(props.modelValue))
const filteredModels = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? models.value.filter((m) => `${m.label} ${m.value} ${m.provider ?? ''} ${m.description ?? ''}`.toLowerCase().includes(q))
    : models.value
})
const groupedModels = computed(() => {
  const groups = new Map<string, ModelOption[]>()
  for (const model of filteredModels.value) {
    const provider = model.provider || 'Models'
    groups.set(provider, [...(groups.get(provider) ?? []), model])
  }
  return [...groups.entries()].map(([provider, items]) => ({ provider, items }))
})
const globalSearchResults = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return allHarnessModels.value.filter(({ harnessName, model }) =>
    `${harnessName} ${model.label} ${model.value} ${model.provider ?? ''} ${model.description ?? ''}`.toLowerCase().includes(q),
  )
})
const filteredAgencies = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.agencies.filter((agency) => `${agency.name} ${agency.description} ${agency.roles.length} roles`.toLowerCase().includes(q))
    : props.agencies
})

async function loadAllHarnessModels() {
  const available = (harnesses.value ?? []).filter((harness) => harness.available)
  if (!available.length) return
  isLoadingAllModels.value = true
  try {
    const catalogs = await Promise.all(available.map(async (harness) => ({
      harness,
      result: await window.agentkeeper.models.list(harness.id),
    })))
    allHarnessModels.value = catalogs.flatMap(({ harness, result }) =>
      result.models.map((model) => ({ harnessId: harness.id, harnessName: harness.name, model })),
    )
  } finally {
    isLoadingAllModels.value = false
  }
}

watch(open, (value) => {
  if (!value) return
  tab.value = props.agencyKey ? 'agencies' : 'models'
  browsingHarnessId.value = props.harnessId ?? activeHarness.value?.id ?? harnesses.value?.[0]?.id
  query.value = ''
  void loadAllHarnessModels()
  void nextTick(() => searchInput.value?.focus())
})
watch(harnesses, () => {
  if (open.value) void loadAllHarnessModels()
})
watch(tab, () => {
  query.value = ''
  void nextTick(() => searchInput.value?.focus())
})

function chooseModel(value: string) {
  const harnessId = browsingHarnessId.value ?? props.harnessId ?? activeHarness.value?.id
  if (harnessId) emit('update:harnessId', harnessId)
  emit('update:agencyKey', '')
  emit('update:modelValue', value)
  open.value = false
}
function chooseModelFromHarness(harnessId: string, value: string) {
  browsingHarnessId.value = harnessId
  emit('update:harnessId', harnessId)
  emit('update:agencyKey', '')
  emit('update:modelValue', value)
  open.value = false
}
function chooseAgency(agency: Agency) {
  emit('update:agencyKey', `${agency.scope}:${agency.id}`)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button type="button" :disabled="disabled" class="flex h-7 max-w-48 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
        <Network v-if="selectedAgency" class="size-3.5 shrink-0" />
        <Bot v-else class="size-3.5 shrink-0" />
        <span class="truncate">{{ triggerLabel }}</span>
        <span v-if="selectedAgency" class="shrink-0 text-[10px]">{{ selectedAgency.roles.length }} roles</span>
        <ChevronDown class="size-3 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-[460px] border-muted-foreground/40 p-0">
      <Tabs v-model="tab" class="border-b border-border p-1.5 dark:border-white/30">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="agencies">Agencies</TabsTrigger>
        </TabsList>
      </Tabs>

      <div v-if="tab === 'models'" class="flex h-[380px] flex-col">
        <div class="flex items-center gap-2 border-b border-border dark:border-white/30 px-3 py-2">
          <Search class="size-4 shrink-0 text-muted-foreground" />
          <input ref="searchInput" v-model="query" class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search models" />
        </div>
        <div class="flex min-h-0 flex-1">
          <div class="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border dark:border-white/30 p-1.5">
          <button v-for="harness in harnesses" :key="harness.id" type="button" :disabled="!harness.available" :title="harness.available ? harness.name : harness.unavailableReason" :aria-label="harness.name" class="grid size-8 shrink-0 place-items-center rounded-md border text-xs font-semibold uppercase transition-colors disabled:opacity-40" :class="browsingHarnessId === harness.id ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'" @click="browsingHarnessId = harness.id; query = ''">
            {{ harness.name.charAt(0) }}
          </button>
          </div>

          <div class="min-w-0 flex-1 overflow-y-auto p-1.5">
            <template v-if="query.trim()">
              <div v-if="isLoadingAllModels" class="py-12 text-center text-xs text-muted-foreground">Searching model catalogs…</div>
              <button v-for="result in globalSearchResults" v-else :key="`${result.harnessId}:${result.model.value}`" type="button" :aria-pressed="result.harnessId === harnessId && result.model.value === modelValue" class="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors" :class="result.harnessId === harnessId && result.model.value === modelValue ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'" @click="chooseModelFromHarness(result.harnessId, result.model.value)">
                <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded border border-muted-foreground/40 text-[9px] font-semibold uppercase">{{ result.harnessName.charAt(0) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5"><span class="truncate text-sm font-medium">{{ result.model.label }}</span><span v-if="result.model.isDefault" class="rounded border border-muted-foreground/40 px-1 text-[9px] uppercase text-muted-foreground">Default</span></span>
                  <span class="block truncate text-xs text-muted-foreground">{{ result.harnessName }}<template v-if="result.model.provider"> · {{ result.model.provider }}</template><template v-if="result.model.description"> · {{ result.model.description }}</template></span>
                </span>
              </button>
              <div v-if="!isLoadingAllModels && !globalSearchResults.length" class="py-12 text-center text-xs text-muted-foreground">No matching models across any harness</div>
            </template>
            <div v-else-if="isLoading" class="py-12 text-center text-xs text-muted-foreground">Loading models…</div>
            <div v-else-if="error" class="px-3 py-8 text-center text-xs text-destructive">{{ error }}</div>
            <template v-for="group in groupedModels" v-else :key="group.provider">
              <button v-for="model in group.items" :key="model.value" type="button" :aria-pressed="browsingHarnessId === harnessId && model.value === modelValue" class="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors" :class="browsingHarnessId === harnessId && model.value === modelValue ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'" @click="chooseModel(model.value)">
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5"><span class="truncate text-sm font-medium">{{ model.label }}</span><span v-if="model.isDefault" class="rounded border border-muted-foreground/40 px-1 text-[9px] uppercase text-muted-foreground">Default</span></span>
                  <span v-if="model.description" class="block truncate text-xs text-muted-foreground">{{ model.description }}</span>
                </span>
              </button>
            </template>
            <div v-if="!query.trim() && !isLoading && !error && !groupedModels.length" class="py-12 text-center text-xs text-muted-foreground">No models</div>
          </div>
        </div>
      </div>

      <div v-else class="flex h-[380px] flex-col">
        <div class="flex items-center gap-2 border-b border-border dark:border-white/30 px-3 py-2">
          <Search class="size-4 shrink-0 text-muted-foreground" />
          <input ref="searchInput" v-model="query" class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search agencies" />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <div class="px-2 pb-2 pt-1 text-xs text-muted-foreground">Agencies run their assigned roles and models. Session-level model controls won’t apply.</div>
          <button v-for="agency in filteredAgencies" :key="`${agency.scope}:${agency.id}`" type="button" class="flex w-full items-start gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-muted" @click="chooseAgency(agency)">
            <Network class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">{{ agency.name }}</span><span class="block truncate text-xs text-muted-foreground">{{ agency.roles.length }} roles<span v-if="agency.description"> · {{ agency.description }}</span></span></span>
            <Check v-if="`${agency.scope}:${agency.id}` === agencyKey" class="size-4 text-primary" />
          </button>
          <div v-if="!filteredAgencies.length" class="py-12 text-center text-xs text-muted-foreground">No matching agencies</div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
