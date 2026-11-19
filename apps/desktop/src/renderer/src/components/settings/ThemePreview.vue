<script setup lang="ts">
import { computed } from 'vue'
import { Check, CircleAlert, FolderGit2, Terminal } from 'lucide-vue-next'
import { deriveTheme, type ThemeConfig, type ThemeVariant } from '@shared/theme'

const props = defineProps<{ config: ThemeConfig; variant: ThemeVariant; codeFontSize: number }>()

// Scoping the derived variables on this element lets the preview show the
// theme being edited even when the app is in the other mode. Avoid `dark:`
// utilities inside: they key off <html>, not this subtree.
const style = computed(() => ({
  ...deriveTheme(props.config, props.variant).cssVars,
  '--code-font-size': `${props.codeFontSize}px`,
  colorScheme: props.variant,
}))
</script>

<template>
  <div
    :style="style"
    class="overflow-hidden rounded-lg border border-border bg-background font-sans text-foreground shadow-sm"
    aria-label="Theme preview"
    role="img"
  >
    <div class="flex h-56">
      <aside class="flex w-28 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 text-xs text-sidebar-foreground">
        <span class="rounded-md bg-sidebar-accent px-2 py-1.5 font-medium text-sidebar-accent-foreground">Sessions</span>
        <span class="px-2 py-1.5 text-muted-foreground">Monitor</span>
        <span class="px-2 py-1.5 text-muted-foreground">Planner</span>
        <span class="px-2 py-1.5 text-muted-foreground">Agencies</span>
      </aside>
      <div class="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
        <div class="flex items-center gap-2">
          <FolderGit2 class="size-3.5 text-muted-foreground" />
          <span class="truncate text-xs font-medium">feat/theme-engine</span>
          <span class="ml-auto rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">running</span>
        </div>
        <div class="rounded-md border border-border bg-card p-2.5 text-xs text-card-foreground">
          <p>Updated the token derivation and added tests.</p>
          <p class="mt-1 text-muted-foreground">3 files changed · <span class="text-diff-added">+42</span> <span class="text-diff-removed">−7</span></p>
        </div>
        <pre class="overflow-hidden rounded-md border border-border bg-code px-2.5 py-2 font-mono text-[length:var(--code-font-size)] leading-relaxed text-code-foreground"><span class="text-highlight">const</span> t = <span class="text-info">derive</span>(seeds)</pre>
        <div class="mt-auto flex flex-wrap items-center gap-1.5 text-[11px]">
          <span class="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 font-medium text-brand-foreground"><Check class="size-3" />Approve</span>
          <span class="rounded-md border border-border bg-background px-2 py-1">Cancel</span>
          <span class="rounded-md bg-accent px-2 py-1 text-accent-foreground">Hover</span>
          <span class="ml-auto inline-flex items-center gap-1 text-warning"><CircleAlert class="size-3" />Needs review</span>
          <span class="inline-flex items-center gap-1 text-destructive"><Terminal class="size-3" />Exit 1</span>
        </div>
      </div>
    </div>
  </div>
</template>
