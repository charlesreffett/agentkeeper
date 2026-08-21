<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Folder, FolderPlus, Globe, Layers } from '@/components/icons/app-icons'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import ProjectManagerDialog from '@/components/ProjectManagerDialog.vue'
import BranchSwitcher from '@/components/BranchSwitcher.vue'
import type { ScopeOption, PageScope } from '@/composables/usePageScope'

const props = defineProps<{
  scope: PageScope | null
  options: ScopeOption[]
  label: string
  /** hsl color for a project scope, null otherwise */
  color: string | null
  /** Show the git branch switcher next to the trigger when a project is scoped. */
  showBranchSwitcher?: boolean
}>()

const emit = defineEmits<{
  select: [value: PageScope]
  pickAndAdd: []
}>()

const open = defineModel<boolean>('open', { default: false })

const manageOpen = ref(false)

const activeOption = computed(() => props.options.find((o) => o.value === props.scope) ?? null)

// The branch switcher is scoped to the working copy: shown only when a
// concrete project is selected (All/Global have no repo to switch).
const isProjectScope = computed(() => activeOption.value?.kind === 'project')
const branchProjectPath = computed(() => activeOption.value?.path ?? (isProjectScope.value ? props.scope : null))

function choose(opt: ScopeOption): void {
  open.value = false
  if (opt.kind === 'new') {
    emit('pickAndAdd')
    return
  }
  emit('select', opt.value)
}

function openManage(): void {
  open.value = false
  manageOpen.value = true
}
</script>

<template>
  <div class="flex items-center gap-1 min-w-0">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="ghost" class="h-7 px-2 gap-1.5 text-sm font-medium min-w-0">
          <span class="text-xs text-muted-foreground shrink-0">Working in</span>
          <span
            v-if="color"
            class="size-2 rounded-full shrink-0"
            :style="{ backgroundColor: color }"
          />
          <Globe v-else-if="activeOption?.kind === 'global'" class="size-3.5 text-muted-foreground shrink-0" />
          <Layers v-else class="size-3.5 text-muted-foreground shrink-0" />
          <span class="min-w-0 truncate">{{ label }}</span>
          <ChevronDown class="size-3.5 text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-64 p-1" align="start">
        <template v-for="opt in options" :key="opt.value">
          <button
            v-if="opt.kind !== 'new'"
            class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors hover:bg-accent"
            :class="{ 'bg-accent/50': opt.value === scope }"
            @click="choose(opt)"
          >
            <span
              v-if="opt.kind === 'project'"
              class="size-2.5 rounded-full shrink-0"
              :style="{ backgroundColor: opt.color }"
            />
            <Layers v-else-if="opt.kind === 'all'" class="size-4 shrink-0 text-muted-foreground" />
            <Globe v-else-if="opt.kind === 'global'" class="size-4 shrink-0 text-muted-foreground" />
            <span class="flex-1 min-w-0 truncate text-left">{{ opt.label }}</span>
          </button>
        </template>
        <div class="my-1 h-px bg-border" />
        <button
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors hover:bg-accent text-muted-foreground"
          @click="choose({ value: '__new__', label: '', kind: 'new' })"
        >
          <FolderPlus class="size-4 shrink-0" />
          New project…
        </button>
        <button
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors hover:bg-accent text-muted-foreground"
          @click="openManage"
        >
          <Folder class="size-4 shrink-0" />
          Manage projects…
        </button>
      </PopoverContent>
    </Popover>

    <BranchSwitcher
      v-if="showBranchSwitcher !== false && isProjectScope"
      :project-path="branchProjectPath"
    />
  </div>

  <ProjectManagerDialog v-model:open="manageOpen" />
</template>
