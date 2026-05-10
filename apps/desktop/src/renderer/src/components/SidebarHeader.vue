<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="px-3 py-2 shrink-0 flex items-center justify-between border-b border-border">
    <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
      <slot name="icon" />
      {{ title }}
    </span>
    <slot name="actions" />
  </div>
</template>
