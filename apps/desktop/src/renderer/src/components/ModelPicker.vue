<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Check, ChevronDown, Search, CornerDownLeft } from 'lucide-vue-next'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { useHarnessList } from '@/composables/useHarness'
import { featureFlags } from '@/lib/featureFlags'

const props = withDefaults(defineProps<{
  modelValue: string
  harnessId?: string
  // Rail may switch the session's harness only before it starts.
  harnessSwitchable?: boolean
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}>(), {
  align: 'start',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:harnessId': [value: string]
}>()

const open = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

// Rail selection browses a harness's catalog without committing the session to
// it; resets to the caller's harness whenever the popover reopens.
const selectedHarnessId = ref<string | undefined>(props.harnessId)

const { data: harnesses } = useHarnessList()
// Unreleased: rail only appears when the flag is on, more than one harness
// exists, and this session can still switch harness (drafts only).
const showRail = computed(
  () =>
    featureFlags.harnessRail &&
    props.harnessSwitchable === true &&
    (harnesses.value?.length ?? 0) > 1,
)

const { optionsFor, resolvedLabelFor } = useModelsQuery(() => selectedHarnessId.value)

const options = computed(() => optionsFor(props.modelValue))

// Always names the concrete model+version (resolves `default`/aliases), so a
// live session never just reads "Default".
const currentLabel = computed(() => resolvedLabelFor(props.modelValue))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return options.value
  return options.value.filter(
    (m) =>
      m.value.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      (m.description?.toLowerCase().includes(q) ?? false),
  )
})

// The search box doubles as free-text entry: any id the harness accepts (a
// snapshot or retired model not in the reported list) can be typed and used.
// Validation happens when the session starts.
const rawCandidate = computed(() => {
  const raw = query.value.trim()
  if (!raw) return null
  if (options.value.some((m) => m.value === raw)) return null
  return raw
})

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedHarnessId.value = props.harnessId
    void nextTick(() => searchInput.value?.focus())
  }
})

function select(value: string) {
  if (selectedHarnessId.value && selectedHarnessId.value !== props.harnessId) {
    emit('update:harnessId', selectedHarnessId.value)
  }
  emit('update:modelValue', value)
  open.value = false
}

function onEnter() {
  if (filtered.value.length === 1) select(filtered.value[0]!.value)
  else if (rawCandidate.value) select(rawCandidate.value)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child :disabled="disabled">
      <slot name="trigger" :label="currentLabel" :open="open">
        <button
          type="button"
          :disabled="disabled"
          class="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent transition-colors focus:outline-none focus:border-ring disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span class="truncate">{{ currentLabel }}</span>
          <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </slot>
    </PopoverTrigger>

    <PopoverContent :align="align" class="w-[380px] p-0">
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          placeholder="Search or type a model id…"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          class="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          @keydown.enter.prevent="onEnter"
          @keydown.esc="open = false"
        />
      </div>

      <div class="flex h-[380px] max-h-[calc(100dvh-14rem)]">
        <div
          v-if="showRail"
          class="flex h-full flex-col gap-1 overflow-y-auto border-r p-1.5"
        >
          <button
            v-for="h in harnesses"
            :key="h.id"
            type="button"
            :disabled="!h.available"
            :title="h.name"
            class="size-8 shrink-0 rounded-md border text-xs font-semibold uppercase transition-colors disabled:opacity-40"
            :class="selectedHarnessId === h.id
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-transparent text-muted-foreground hover:bg-accent'"
            @click="selectedHarnessId = h.id"
          >
            {{ h.name.charAt(0) }}
          </button>
        </div>

        <div class="flex-1 min-w-0 h-full overflow-y-auto p-1">
          <button
            v-for="m in filtered"
            :key="m.value"
            type="button"
            class="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            @click="select(m.value)"
          >
            <span class="mt-0.5 w-4 shrink-0">
              <Check v-if="m.value === modelValue" class="h-4 w-4 text-primary" />
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-medium truncate">{{ m.label }}</span>
              <span v-if="m.description" class="block text-xs text-muted-foreground truncate">
                {{ m.description }}
              </span>
            </span>
          </button>

          <button
            v-if="rawCandidate"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            @click="select(rawCandidate)"
          >
            <CornerDownLeft class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">Use <span class="font-mono">{{ rawCandidate }}</span></span>
          </button>

          <div
            v-if="!filtered.length && !rawCandidate"
            class="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            No models
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
