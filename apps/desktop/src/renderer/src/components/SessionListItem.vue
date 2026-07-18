<script setup lang="ts">
import { Pencil } from 'lucide-vue-next'
import { formatRelativeTime } from '@/lib/format'
import { useModelsQuery } from '@/composables/useModelsQuery'

const { resolvedLabelFor } = useModelsQuery()

withDefaults(
  defineProps<{
    title: string
    /** Optional muted prefix rendered before the title (e.g. '◎' for agencies). */
    titlePrefix?: string
    /** Tailwind bg-* classes for the status dot. */
    statusDot: string
    statusLabel: string
    /** Non-empty string causes the draft-message pencil icon to appear. */
    draftMessage?: string
    messageCount?: number | null
    model?: string | null
    branch?: string | null
    roleName?: string | null
    agencyName?: string | null
    /** When supplied, a relative-time string is shown in the sub-line. */
    lastActivityAt?: number | null
    isSelected?: boolean
    canDismiss?: boolean
    showCheckbox?: boolean
    checked?: boolean
  }>(),
  {
    titlePrefix: undefined,
    draftMessage: '',
    messageCount: null,
    model: null,
    branch: null,
    roleName: null,
    agencyName: null,
    lastActivityAt: null,
    isSelected: false,
    canDismiss: false,
    showCheckbox: false,
    checked: false,
  },
)

const emit = defineEmits<{
  click: []
  dismiss: []
  toggle: []
}>()
</script>

<template>
  <li
    class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
    :class="isSelected ? 'bg-accent' : ''"
    @click="showCheckbox ? emit('toggle') : emit('click')"
  >
    <!-- Title row -->
    <div class="flex items-center gap-2">
      <input
        v-if="showCheckbox"
        type="checkbox"
        :checked="checked"
        class="size-3 accent-primary cursor-pointer shrink-0"
        @click.stop="emit('toggle')"
      />
      <span class="size-1.5 rounded-full shrink-0" :class="statusDot" />
      <Pencil
        v-if="draftMessage"
        :size="11"
        class="text-amber-500 shrink-0"
        title="Has unsent message"
      />
      <div class="text-sm font-medium truncate leading-snug flex-1 min-w-0">
        <span v-if="titlePrefix" class="text-muted-foreground mr-1">{{ titlePrefix }}</span
        >{{ title }}
      </div>
      <!-- Caller-supplied action buttons (e.g. "Keep" expiry reset) -->
      <slot name="actions" />
      <button
        v-if="canDismiss && !showCheckbox"
        class="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition shrink-0"
        title="Dismiss"
        @click.stop="emit('dismiss')"
      >
        ×
      </button>
    </div>

    <!-- Sub-line: status · time · messages · model -->
    <div
      class="mt-1 pl-3.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums flex-wrap"
    >
      <span>{{ statusLabel }}</span>
      <template v-if="lastActivityAt != null">
        <span>·</span>
        <span>{{ formatRelativeTime(lastActivityAt) }}</span>
      </template>
      <template v-if="messageCount != null">
        <span>·</span>
        <span>{{ messageCount }} msg</span>
      </template>
      <template v-if="model">
        <span>·</span>
        <span class="font-mono">{{ resolvedLabelFor(model) }}</span>
      </template>
    </div>

    <!-- Context row: agency / branch / role -->
    <div
      v-if="agencyName || branch || roleName"
      class="mt-1 pl-3.5 text-[10px] text-muted-foreground truncate flex gap-2 flex-wrap"
    >
      <span v-if="agencyName" class="text-foreground/80">◎ {{ agencyName }}</span>
      <span v-if="branch" class="font-mono">⎇ {{ branch }}</span>
      <span v-if="roleName">{{ roleName }}</span>
    </div>

    <!-- Optional extra content (e.g. expiry warning) -->
    <slot />
  </li>
</template>
