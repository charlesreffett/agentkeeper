<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CommitGroup, CommitSuggestion } from '@shared/ipc-contract'

const props = defineProps<{ projectPath: string }>()
const emit = defineEmits<{ committed: [] }>()

// ─── State machine ──────────────────────────────────────────────────────────

type Phase = 'idle' | 'analyzing' | 'reviewing' | 'committing' | 'done' | 'error'

const phase = ref<Phase>('idle')
const errorMessage = ref('')
const overview = ref('')
const groups = ref<EditableGroup[]>([])
const committingIndex = ref(-1)
const pushOutput = ref('')
const pushing = ref(false)
const pushError = ref('')

interface EditableGroup {
  message: string
  files: string[]
  excluded: Set<string>
  explanation: string
  committed: boolean
}

function toEditable(suggestion: CommitSuggestion): EditableGroup[] {
  return suggestion.groups.map((g: CommitGroup) => ({
    message: g.message,
    files: g.files,
    excluded: new Set<string>(),
    explanation: g.explanation,
    committed: false,
  }))
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function analyze() {
  phase.value = 'analyzing'
  errorMessage.value = ''
  try {
    const result = await window.orchestral.git.suggestCommits(props.projectPath)
    overview.value = result.overview
    groups.value = toEditable(result)
    phase.value = result.groups.length === 0 ? 'idle' : 'reviewing'
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : String(err)
    phase.value = 'error'
  }
}

function toggleFile(groupIdx: number, file: string) {
  const group = groups.value[groupIdx]!
  if (group.excluded.has(file)) {
    group.excluded.delete(file)
  } else {
    group.excluded.add(file)
  }
}

function activeFiles(group: EditableGroup): string[] {
  return group.files.filter((f) => !group.excluded.has(f))
}

async function commitAll() {
  phase.value = 'committing'
  const git = window.orchestral.git

  for (let i = 0; i < groups.value.length; i++) {
    committingIndex.value = i
    const group = groups.value[i]!
    const files = activeFiles(group)
    if (!files.length || group.committed) continue
    try {
      await git.stageFiles(props.projectPath, files)
      await git.commit(props.projectPath, group.message)
      group.committed = true
    } catch (err: unknown) {
      errorMessage.value = `Commit ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`
      phase.value = 'error'
      return
    }
  }

  committingIndex.value = -1
  phase.value = 'done'
  emit('committed')
}

async function doPush() {
  pushing.value = true
  pushError.value = ''
  try {
    pushOutput.value = await window.orchestral.git.push(props.projectPath)
  } catch (err: unknown) {
    pushError.value = err instanceof Error ? err.message : String(err)
  } finally {
    pushing.value = false
  }
}

function reset() {
  phase.value = 'idle'
  errorMessage.value = ''
  overview.value = ''
  groups.value = []
  committingIndex.value = -1
  pushOutput.value = ''
  pushError.value = ''
  pushing.value = false
}

const totalActiveFiles = computed(() =>
  groups.value.reduce((n, g) => n + activeFiles(g).length, 0),
)
</script>

<template>
  <div class="select-none">
    <!-- Idle: entry point -->
    <div v-if="phase === 'idle'" class="pt-1 pb-2">
      <button
        class="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/30 py-2 px-3 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        @click="analyze"
      >
        <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
          <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        Commit with Claude
      </button>
    </div>

    <!-- Analyzing -->
    <div v-else-if="phase === 'analyzing'" class="py-4 flex flex-col items-center gap-2 text-xs text-muted-foreground">
      <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Analyzing changes…
    </div>

    <!-- Error -->
    <div v-else-if="phase === 'error'" class="py-2 space-y-2">
      <div class="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive leading-relaxed">
        {{ errorMessage }}
      </div>
      <button
        class="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        @click="reset"
      >
        ← Back
      </button>
    </div>

    <!-- Reviewing: show suggested groups -->
    <div v-else-if="phase === 'reviewing'" class="space-y-3 py-1">
      <!-- Overview banner -->
      <div class="text-[10px] text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5 leading-relaxed">
        {{ overview }}
      </div>

      <!-- Commit groups -->
      <div
        v-for="(group, idx) in groups"
        :key="idx"
        class="rounded-md border border-border bg-card/50 overflow-hidden"
      >
        <!-- Group header -->
        <div class="px-2.5 pt-2 pb-1.5 border-b border-border/50 bg-muted/20">
          <div class="flex items-center gap-1.5 mb-1.5">
            <span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest shrink-0">
              {{ idx + 1 }}/{{ groups.length }}
            </span>
          </div>
          <!-- Editable commit message -->
          <input
            v-model="group.message"
            class="w-full bg-transparent text-xs font-mono text-foreground focus:outline-none placeholder:text-muted-foreground/40"
            placeholder="scope: short description"
            spellcheck="false"
          />
        </div>

        <!-- Explanation -->
        <div
          v-if="group.explanation"
          class="px-2.5 py-1.5 text-[10px] text-muted-foreground/70 italic border-b border-border/30"
        >
          {{ group.explanation }}
        </div>

        <!-- File list with checkboxes -->
        <div class="px-2.5 py-1.5 space-y-0.5">
          <label
            v-for="file in group.files"
            :key="file"
            class="flex items-center gap-2 py-0.5 cursor-pointer group/file"
          >
            <input
              type="checkbox"
              :checked="!group.excluded.has(file)"
              class="size-3 rounded shrink-0 accent-primary cursor-pointer"
              @change="toggleFile(idx, file)"
            />
            <span
              class="truncate text-[11px] font-mono transition-colors"
              :class="group.excluded.has(file) ? 'text-muted-foreground/30 line-through' : 'text-foreground/80 group-hover/file:text-foreground'"
            >{{ file }}</span>
          </label>
        </div>
      </div>

      <!-- Action bar -->
      <div class="flex items-center justify-between gap-2 pt-1">
        <button
          class="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          @click="reset"
        >
          ← Reset
        </button>
        <button
          class="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium px-3 py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="totalActiveFiles === 0"
          @click="commitAll"
        >
          Commit {{ groups.length }} group{{ groups.length === 1 ? '' : 's' }}
        </button>
      </div>
    </div>

    <!-- Committing: progress -->
    <div v-else-if="phase === 'committing'" class="py-3 space-y-2">
      <div
        v-for="(group, idx) in groups"
        :key="idx"
        class="flex items-center gap-2 text-xs"
        :class="group.committed ? 'text-green-400' : idx === committingIndex ? 'text-foreground' : 'text-muted-foreground/40'"
      >
        <!-- Done checkmark -->
        <svg v-if="group.committed" class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
          <path d="M3 8l4 4 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <!-- Spinner for current -->
        <svg v-else-if="idx === committingIndex" class="size-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <!-- Pending dot -->
        <span v-else class="size-3.5 shrink-0 flex items-center justify-center">
          <span class="size-1.5 rounded-full bg-muted-foreground/30" />
        </span>

        <span class="font-mono truncate">{{ group.message }}</span>
      </div>
    </div>

    <!-- Done -->
    <div v-else-if="phase === 'done'" class="py-2 space-y-2">
      <div class="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs text-green-400">
        {{ groups.length }} commit{{ groups.length === 1 ? '' : 's' }} created ✓
      </div>

      <!-- Push row -->
      <div v-if="!pushOutput" class="flex items-center justify-between gap-2">
        <button
          class="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          @click="reset"
        >
          ← New commit
        </button>
        <button
          class="flex items-center gap-1.5 rounded-md border border-border text-[11px] font-medium px-3 py-1.5 hover:bg-muted/60 transition-colors disabled:opacity-50"
          :disabled="pushing"
          @click="doPush"
        >
          <svg v-if="pushing" class="size-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {{ pushing ? 'Pushing…' : 'Push' }}
        </button>
      </div>

      <!-- Push error -->
      <div v-if="pushError" class="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
        {{ pushError }}
      </div>

      <!-- Push success -->
      <div v-if="pushOutput && !pushError" class="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-[11px] font-mono text-green-400 whitespace-pre-wrap break-all">
        {{ pushOutput || 'Pushed ✓' }}
      </div>
    </div>
  </div>
</template>
