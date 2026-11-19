<script setup lang="ts">
import { ref } from 'vue'
import { Comark } from '@comark/vue'
import { transcriptComponents, transcriptPlugins } from '@/lib/comark-config'
import { Pencil } from '@/components/icons/app-icons'

const props = defineProps<{ brief: string | undefined }>()
const emit = defineEmits<{ save: [brief: string] }>()

const editing = ref(false)
const draft = ref('')

function startEdit() {
  draft.value = props.brief ?? ''
  editing.value = true
}

function commit() {
  editing.value = false
  if (draft.value.trim() !== (props.brief ?? '').trim()) emit('save', draft.value.trim())
}
</script>

<template>
  <div class="rounded-lg border border-border px-4 py-3">
    <div class="flex items-center justify-between mb-2">
      <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Brief</p>
      <div v-if="editing" class="flex gap-2">
        <button class="text-xs text-muted-foreground hover:text-foreground" @click="editing = false">Cancel</button>
        <button class="text-xs font-medium text-primary hover:underline" @click="commit()">Save</button>
      </div>
    </div>
    <textarea
      v-if="editing"
      v-model="draft"
      rows="10"
      autofocus
      placeholder="Goal, why it matters, acceptance criteria, constraints. Every job on this plan reads this first."
      class="w-full text-sm font-mono bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring resize-y"
      @keydown.meta.enter.prevent="commit()"
      @keydown.escape.prevent="editing = false"
    />
    <div
      v-else
      class="group flex items-start gap-1.5 cursor-text hover:bg-muted/40 px-2 py-1 rounded -mx-2 transition-colors"
      @click="startEdit()"
    >
      <Suspense v-if="brief">
        <Comark
          class="flex-1 prose prose-sm dark:prose-invert max-w-none"
          :markdown="brief"
          :plugins="transcriptPlugins"
          :components="transcriptComponents"
        />
        <template #fallback>
          <span class="flex-1 whitespace-pre-wrap text-sm">{{ brief }}</span>
        </template>
      </Suspense>
      <span v-else class="flex-1 text-sm text-muted-foreground/60">
        Add a brief — goal, acceptance criteria, constraints. Jobs read it with get_plan.
      </span>
      <Pencil :size="10" class="opacity-0 group-hover:opacity-50 text-muted-foreground shrink-0 mt-1 transition-opacity" />
    </div>
  </div>
</template>
