<script setup lang="ts">
import type { Attachment, ContentBlock, TranscriptEvent } from '@shared/ipc-contract'
import TextBlock from './TextBlock.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolUseBlock from './ToolUseBlock.vue'
import ToolResultBlock from './ToolResultBlock.vue'
import ImageBlock from './ImageBlock.vue'
import UnknownBlock from './UnknownBlock.vue'
import { CornerDownRight, Info, Pencil, Plus, RefreshCw } from '@/components/icons/app-icons'
import { formatTimestamp } from '@/lib/format'
import { computed, ref, toRaw } from 'vue'
import { type VerbosityState, DEFAULT_VERBOSITY_STATE, isBlockVisible } from '@/lib/verbosity'
import { useModelsQuery } from '@/composables/useModelsQuery'

const props = defineProps<{
  event: TranscriptEvent
  verbosityState?: VerbosityState
  /** Display name for the agent that produced this event. Used for sub-agent progress events. */
  agentName?: string | null
  /** Harness the session runs on — scopes model-label resolution to the right
   *  provider so an opencode model isn't resolved against Claude's list. */
  harnessId?: string | null
  /** Assistant author label (harness name). Falls back to 'Claude'. */
  assistantName?: string | null
  /** True while this event's text is still streaming — passed to Comark for auto-close mode. */
  streaming?: boolean
  isDoomed?: boolean
  canRewrite?: boolean
}>()

const emit = defineEmits<{
  'hover-rewrite': [uuid: string | null]
  'edit-submit': [uuid: string, newText: string, attachments: Attachment[]]
  'regenerate': [uuid: string]
}>()

const { resolvedLabelFor } = useModelsQuery(() => props.harnessId ?? undefined)

const state = computed(() => props.verbosityState ?? DEFAULT_VERBOSITY_STATE)

const isToolResultOnly = computed(
  () =>
    props.event.role === 'user' &&
    props.event.content.length > 0 &&
    props.event.content.every((b) => b.type === 'tool_result'),
)

const isUser = computed(
  () => props.event.role === 'user' && !isToolResultOnly.value,
)

const isSubAgent = computed(() => props.event.kind === 'progress')

const isDelegatedTask = computed(
  () => props.event.systemSubtype === 'delegated-task',
)

// Non-interrupted, non-delegated system events render as slim info bars.
const isSystemBar = computed(
  () =>
    props.event.kind === 'system' &&
    props.event.systemSubtype !== 'interrupted' &&
    props.event.systemSubtype !== 'delegated-task',
)

const displayName = computed(() => {
  if (isToolResultOnly.value) return ''
  if (isUser.value) return 'you'
  if (isSubAgent.value) return props.agentName ?? 'agent'
  return props.agentName ?? props.assistantName ?? 'Claude'
})

const avatarLetter = computed(() =>
  isUser.value ? 'Y' : (displayName.value.charAt(0).toUpperCase() || 'C'),
)

type BlockGroup =
  | { kind: 'single'; key: number; block: ContentBlock }
  | { kind: 'images'; key: number; blocks: Array<{ block: ContentBlock & { type: 'image' }; key: number }> }

const groupedContent = computed((): BlockGroup[] => {
  const groups: BlockGroup[] = []
  props.event.content.forEach((block, idx) => {
    if (!isBlockVisible(block, state.value)) return
    if (block.type === 'image') {
      const last = groups[groups.length - 1]
      if (last?.kind === 'images') {
        last.blocks.push({ block: block as ContentBlock & { type: 'image' }, key: idx })
      } else {
        groups.push({ kind: 'images', key: idx, blocks: [{ block: block as ContentBlock & { type: 'image' }, key: idx }] })
      }
    } else {
      groups.push({ kind: 'single', key: idx, block })
    }
  })
  return groups
})

function blockExtraProps(block: ContentBlock): Record<string, unknown> {
  if (block.type === 'text' || block.type === 'thinking') {
    return { streaming: props.streaming ?? false }
  }
  return {}
}

const hiddenToolUseCount = computed(
  () =>
    props.event.content.filter(
      (b) => b.type === 'tool_use' && !isBlockVisible(b, state.value),
    ).length,
)

function blockComponent(block: ContentBlock) {
  switch (block.type) {
    case 'text':
      return TextBlock
    case 'thinking':
      return ThinkingBlock
    case 'tool_use':
      return ToolUseBlock
    case 'tool_result':
      return ToolResultBlock
    case 'image':
      return ImageBlock
    default:
      return UnknownBlock
  }
}

// ─── Inline edit ────────────────────────────────────────────────────────────

const editMode = ref(false)
const editText = ref('')
const editImages = ref<Attachment[]>([])

function imageBlockToAttachment(block: ContentBlock & { type: 'image' }): Attachment | null {
  const src = block.source as { type?: string; media_type?: string; data?: string } | null
  if (src?.type !== 'base64' || !src.media_type || !src.data) return null
  const ext = src.media_type.split('/')[1] ?? 'png'
  return { name: `image-${editImages.value.length + 1}.${ext}`, mimeType: src.media_type, content: src.data }
}

function startEdit() {
  const textBlocks = props.event.content.filter(b => b.type === 'text')
  editText.value = textBlocks.map(b => (b as { type: 'text'; text: string }).text).join('\n')
  const kept: Attachment[] = []
  for (const b of props.event.content) {
    if (b.type !== 'image') continue
    const att = imageBlockToAttachment(b as ContentBlock & { type: 'image' })
    if (att) kept.push(att)
  }
  editImages.value = kept
  editMode.value = true
}

function cancelEdit() {
  editMode.value = false
  editText.value = ''
  editImages.value = []
}

function submitEdit() {
  if (!editText.value.trim() && editImages.value.length === 0) return
  emit('edit-submit', props.event.uuid, editText.value.trim(), editImages.value.map(toRaw))
  editMode.value = false
  editText.value = ''
  editImages.value = []
}

function removeEditImage(index: number) {
  editImages.value.splice(index, 1)
}

async function attachEditImages() {
  const picked = await window.agentkeeper.dialog.openFiles()
  editImages.value.push(...picked.filter((a) => a.mimeType.startsWith('image/')))
}

async function handleEditPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  const imageItems: DataTransferItem[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item && item.kind === 'file' && item.type.startsWith('image/')) {
      imageItems.push(item)
    }
  }
  if (imageItems.length === 0) return
  event.preventDefault()
  const promises = imageItems.map((item) => new Promise<void>((resolve) => {
    const file = item.getAsFile()
    if (!file) { resolve(); return }
    const mimeType = file.type || 'image/png'
    const ext = mimeType.split('/')[1] ?? 'png'
    const name = `pasted-image-${Date.now()}.${ext}`
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (base64) editImages.value.push({ name, mimeType, content: base64 })
      resolve()
    }
    reader.onerror = () => resolve()
    reader.readAsDataURL(file)
  }))
  await Promise.all(promises)
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { cancelEdit(); return }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { submitEdit() }
}
</script>

<template>
  <!-- ── Interrupted divider ─────────────────────────────────────────────── -->
  <div
    v-if="event.systemSubtype === 'interrupted'"
    class="flex items-center gap-3 text-xs text-destructive/60 select-none py-1"
  >
    <span class="flex-1 border-t border-destructive/20" />
    <span>Interrupted</span>
    <span class="flex-1 border-t border-destructive/20" />
  </div>

  <!-- ── System info bar ─────────────────────────────────────────────────── -->
  <div
    v-else-if="isSystemBar"
    class="flex items-center gap-2 text-xs text-muted-foreground/60 bg-muted/20 rounded-md px-3 py-1.5 select-none"
  >
    <Info class="size-3 shrink-0 text-muted-foreground/40" />
    <span class="italic truncate min-w-0 select-text">
      {{
        event.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as Extract<typeof b, { type: 'text' }>).text)
          .join(' ')
      }}
    </span>
    <span class="ml-auto tabular-nums shrink-0">
      {{ formatTimestamp(event.timestamp) }}
    </span>
  </div>

  <!-- ── Delegated task brief ──────────────────────────────────────────── -->
  <div
    v-else-if="isDelegatedTask"
    class="border-l-2 border-violet-500/40 bg-violet-500/5 rounded-r-md px-3 py-2 space-y-1.5"
  >
    <header class="flex items-center gap-1.5 text-xs select-none">
      <CornerDownRight class="size-3 shrink-0 text-violet-400/70" />
      <span class="font-medium text-violet-400/70">delegated task</span>
      <span class="ml-auto tabular-nums text-muted-foreground/50">
        {{ formatTimestamp(event.timestamp) }}
      </span>
    </header>
    <div class="space-y-1 text-sm text-foreground/70 select-text">
      <template v-for="group in groupedContent" :key="group.key">
        <component
          v-if="group.kind === 'single' && group.block.type === 'text'"
          :is="blockComponent(group.block)"
          :block="group.block"
          v-bind="blockExtraProps(group.block)"
        />
      </template>
    </div>
  </div>

  <!-- ── Tool-result continuation (no avatar) ───────────────────────────── -->
  <div
    v-else-if="isToolResultOnly"
    class="ml-10 space-y-1.5"
  >
    <template v-for="group in groupedContent" :key="group.key">
      <div v-if="group.kind === 'images'" class="flex flex-wrap gap-2">
        <ImageBlock
          v-for="item in group.blocks"
          :key="item.key"
          :block="item.block"
        />
      </div>
      <component
        v-else
        :is="blockComponent(group.block)"
        :block="group.block"
        v-bind="blockExtraProps(group.block)"
      />
    </template>
  </div>

  <!-- ── Normal user / assistant message ────────────────────────────────── -->
  <article
    v-else
    class="group flex gap-3 transition-opacity duration-150"
    :class="isDoomed ? 'opacity-40' : 'opacity-100'"
  >
    <!-- Avatar -->
    <div
      class="mt-0.5 size-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white select-none"
      :class="isUser ? 'bg-blue-500' : 'bg-orange-400'"
    >
      {{ avatarLetter }}
    </div>

    <!-- Content column -->
    <div class="flex-1 min-w-0 space-y-2">
      <!-- Header row: name · sub-agent badge · model · timestamp · action buttons -->
      <header class="flex items-center gap-2 text-xs text-muted-foreground leading-none">
        <span class="font-medium text-foreground">{{ displayName }}</span>
        <!-- Sub-agent badge -->
        <span
          v-if="isSubAgent"
          class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20"
        >
          sub-agent
        </span>
        <span v-if="event.model" class="font-mono text-muted-foreground/60">
          {{ resolvedLabelFor(event.model) }}
        </span>
        <span class="ml-auto tabular-nums text-muted-foreground/50">
          {{ formatTimestamp(event.timestamp) }}
        </span>
        <!-- Edit button — only for user messages that can be rewritten -->
        <button
          v-if="isUser && canRewrite !== false"
          class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity text-muted-foreground/50 hover:text-foreground"
          title="Edit message"
          @mouseenter="emit('hover-rewrite', event.uuid)"
          @mouseleave="emit('hover-rewrite', null)"
          @click.stop="startEdit"
        >
          <Pencil class="size-3" />
        </button>
        <!-- Regenerate button — only for assistant messages that can be rewritten -->
        <button
          v-if="!isUser && !isSubAgent && canRewrite !== false"
          class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity text-muted-foreground/50 hover:text-foreground"
          title="Regenerate response"
          @mouseenter="emit('hover-rewrite', event.uuid)"
          @mouseleave="emit('hover-rewrite', null)"
          @click.stop="emit('regenerate', event.uuid)"
        >
          <RefreshCw class="size-3" />
        </button>
      </header>

      <!-- Edit mode textarea -->
      <div v-if="editMode" class="space-y-2">
        <div v-if="editImages.length > 0" class="flex flex-wrap gap-2">
          <div
            v-for="(a, i) in editImages"
            :key="i"
            class="relative group cursor-pointer rounded-md overflow-hidden w-16 h-16 shrink-0 border border-border"
            :title="a.name"
          >
            <img
              :src="`data:${a.mimeType};base64,${a.content}`"
              :alt="a.name"
              class="w-full h-full object-cover"
            />
            <button
              type="button"
              class="absolute top-0.5 right-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 text-xs leading-none"
              title="Remove image"
              @click.stop="removeEditImage(i)"
            >×</button>
          </div>
        </div>
        <textarea
          v-model="editText"
          class="w-full rounded-md border border-border bg-background text-sm text-foreground px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-[80px]"
          autofocus
          @keydown="onEditKeydown"
          @paste="handleEditPaste"
        />
        <div class="flex gap-2 items-center justify-end">
          <button
            type="button"
            class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground mr-auto"
            @click="attachEditImages"
          >
            <Plus class="size-3" />
            Attach image
          </button>
          <button
            class="text-xs px-3 py-1 rounded border border-border hover:bg-muted text-muted-foreground"
            @click="cancelEdit"
          >Cancel</button>
          <button
            class="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            :disabled="!editText.trim() && editImages.length === 0"
            @click="submitEdit"
          >Send edit</button>
        </div>
      </div>

      <!-- Normal blocks display -->
      <div v-else class="space-y-2">
        <template v-for="group in groupedContent" :key="group.key">
          <div v-if="group.kind === 'images'" class="flex flex-wrap gap-2">
            <ImageBlock
              v-for="item in group.blocks"
              :key="item.key"
              :block="item.block"
            />
          </div>
          <component
            v-else
            :is="blockComponent(group.block)"
            :block="group.block"
            v-bind="blockExtraProps(group.block)"
          />
        </template>
        <!-- Hidden tool call hint -->
        <div
          v-if="hiddenToolUseCount > 0"
          class="text-xs text-muted-foreground/40 font-mono select-none"
        >
          · {{ hiddenToolUseCount }} tool {{ hiddenToolUseCount === 1 ? 'call' : 'calls' }} ·
        </div>
      </div>
    </div>
  </article>
</template>
