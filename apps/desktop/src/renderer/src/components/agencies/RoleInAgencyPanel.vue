<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <!-- Header -->
    <div class="shrink-0 border-b border-border">
      <div class="flex items-center gap-2 px-4 pt-4 pb-3">
        <button
          class="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          @click="emit('close')"
        >
          <ChevronLeft class="w-4 h-4" />
        </button>
        <!-- Icon badge -->
        <div
          class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          :style="{ backgroundColor: accentBg, color: accentFg }"
        >
          <component :is="iconComponent" class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-0.5">
            Agent · This Agency
          </div>
          <div class="text-base font-semibold text-foreground leading-tight truncate">
            {{ role?.name ?? roleSlot.roleId }}
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 px-4 py-4 space-y-6">
      <!-- PLACEMENT -->
      <section class="space-y-2">
        <div class="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          <Users class="w-3 h-3" />
          Placement
        </div>
        <!-- Entry point -->
        <div class="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
          <div>
            <div class="text-sm font-medium text-foreground">Entry point</div>
            <div class="text-[11px] text-muted-foreground mt-0.5">Receives the ticket first</div>
          </div>
          <Switch :checked="isEntry" @update:checked="emit('toggle-entry')" />
        </div>
        <!-- Open messaging -->
        <div class="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
          <div>
            <div class="text-sm font-medium text-foreground">Open messaging</div>
            <div class="text-[11px] text-muted-foreground mt-0.5">Any-to-any, ignores wired edges</div>
          </div>
          <Switch
            :checked="openMessaging"
            @update:checked="(val: boolean) => saveSlotPatch({ openMessaging: val || undefined })"
          />
        </div>
      </section>

      <!-- INSTANCES -->
      <section class="space-y-2">
        <div class="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          <Copy class="w-3 h-3" />
          Instances
          <span class="normal-case tracking-normal font-normal text-muted-foreground/60">parallel copies</span>
        </div>
        <NumberField
          :model-value="fixedCount"
          :min="1"
          :max="99"
          class="w-fit"
          @update:model-value="val => setCount(val ?? 1)"
        >
          <NumberFieldContent class="w-28">
            <NumberFieldDecrement />
            <NumberFieldInput class="text-center font-semibold" />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </section>

      <!-- RUN POLICY -->
      <section class="space-y-3">
        <div class="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          <Activity class="w-3 h-3" />
          Run policy
        </div>

        <div class="space-y-1.5">
          <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">On failure</div>
          <div class="flex rounded-lg border border-border overflow-hidden text-sm">
            <button
              v-for="opt in FAILURE_OPTS"
              :key="opt.value"
              class="flex-1 px-2 py-2 transition-colors font-medium"
              :class="onFailure === opt.value
                ? 'bg-secondary text-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted'"
              @click="saveSlotPatch({ onFailure: opt.value })"
            >
              {{ opt.label }}
            </button>
          </div>
          <p class="text-[11px] text-muted-foreground">{{ failureDescription }}</p>
        </div>

        <!-- Pause for review -->
        <div class="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
          <div>
            <div class="text-sm font-medium text-foreground">Pause for review</div>
            <div class="text-[11px] text-muted-foreground mt-0.5">Hold this agent's output for a human before handoff</div>
          </div>
          <Switch
            :checked="pauseForReview"
            @update:checked="(val: boolean) => saveSlotPatch({ pauseForReview: val || undefined })"
          />
        </div>
      </section>

      <div class="border-t border-border" />

      <!-- Open role editor -->
      <button
        class="w-full flex items-center justify-center gap-2 text-sm text-foreground rounded-lg border border-border bg-card hover:bg-muted transition-colors px-4 py-2.5"
        @click="emit('open-editor', roleSlot.roleId)"
      >
        <ExternalLink class="w-3.5 h-3.5" />
        Open role editor
      </button>

      <!-- Remove -->
      <button
        class="text-sm text-red-500 hover:text-red-400 transition-colors"
        @click="emit('remove-role', roleSlot.roleId)"
      >
        Remove from this agency
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, markRaw } from 'vue'
import {
  ChevronLeft, Users, Copy, Activity, ExternalLink,
  Layers, Code2, GitBranch, FlaskConical, Eye,
  FileText, Shield, Zap, Brain,
} from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/components/ui/number-field'
import type { Agency, OnFailurePolicy, Role, RoleSlot } from '../../../../shared/ipc-contract'

const props = defineProps<{
  roleSlot: RoleSlot
  agency: Agency
  role?: Role
}>()

const emit = defineEmits<{
  (e: 'update-count', mode: 'fixed' | 'dynamic', opts: { count?: number; min?: number; max?: number }): void
  (e: 'update-slot', patch: Partial<Omit<RoleSlot, 'roleId'>>): void
  (e: 'toggle-entry'): void
  (e: 'close'): void
  (e: 'select-edge', edgeId: string): void
  (e: 'open-editor', roleId: string): void
  (e: 'remove-role', roleId: string): void
}>()

// ─── Icon / accent ───────────────────────────────────────────────────────────

const ICON_MAP: Record<string, ReturnType<typeof markRaw>> = {
  Layers:       markRaw(Layers),
  Code2:        markRaw(Code2),
  GitBranch:    markRaw(GitBranch),
  FlaskConical: markRaw(FlaskConical),
  Eye:          markRaw(Eye),
  FileText:     markRaw(FileText),
  Activity:     markRaw(Activity),
  Shield:       markRaw(Shield),
  Zap:          markRaw(Zap),
  Brain:        markRaw(Brain),
}

const ACCENT_PALETTE: Record<string, { bg: string; fg: string }> = {
  blue:   { bg: 'rgba(59,130,246,0.15)',  fg: '#3b82f6' },
  orange: { bg: 'rgba(245,158,11,0.15)',  fg: '#f59e0b' },
  purple: { bg: 'rgba(139,92,246,0.15)',  fg: '#8b5cf6' },
  teal:   { bg: 'rgba(20,184,166,0.15)',  fg: '#14b8a6' },
  green:  { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
  red:    { bg: 'rgba(239,68,68,0.15)',   fg: '#ef4444' },
}

const iconComponent = computed(() => ICON_MAP[props.role?.icon ?? ''] ?? Layers)
const accentBg = computed(() => (ACCENT_PALETTE[props.role?.accent ?? 'blue'] ?? ACCENT_PALETTE['blue']!).bg)
const accentFg = computed(() => (ACCENT_PALETTE[props.role?.accent ?? 'blue'] ?? ACCENT_PALETTE['blue']!).fg)

// ─── Placement ───────────────────────────────────────────────────────────────

const isEntry = computed(() => props.agency.entryPoints.includes(props.roleSlot.roleId))
const openMessaging = computed(() => props.roleSlot.openMessaging ?? false)

// ─── Instance count ──────────────────────────────────────────────────────────

const fixedCount = ref(1)

function syncFromSlot() {
  fixedCount.value = props.roleSlot.count ?? props.roleSlot.min ?? 1
}
watch(() => props.roleSlot.roleId, syncFromSlot, { immediate: true })
watch(() => props.roleSlot.count, syncFromSlot)

function setCount(val: number) {
  fixedCount.value = val
  emit('update-count', 'fixed', { count: Math.max(1, val) })
}

// ─── Run policy ──────────────────────────────────────────────────────────────

const FAILURE_OPTS: { value: OnFailurePolicy; label: string }[] = [
  { value: 'block',    label: 'Block' },
  { value: 'continue', label: 'Continue' },
  { value: 'retry',    label: 'Retry' },
]

const onFailure = computed<OnFailurePolicy>(() => props.roleSlot.onFailure ?? 'block')
const pauseForReview = computed(() => props.roleSlot.pauseForReview ?? false)

const failureDescription = computed(() => {
  if (onFailure.value === 'block')    return 'A failure here halts the whole agency.'
  if (onFailure.value === 'continue') return 'Other agents proceed; this failure is noted.'
  return 'The agent is retried up to the run limit before continuing.'
})

// ─── Patch helper ────────────────────────────────────────────────────────────

function saveSlotPatch(patch: Partial<Omit<RoleSlot, 'roleId'>>) {
  emit('update-slot', patch)
}
</script>
