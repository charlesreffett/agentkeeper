<template>
  <div
    class="elastic-capacity-group h-full w-full rounded-xl border border-dashed"
    :style="{ '--group-accent': accentHex }"
  >
    <span class="elastic-capacity-label">{{ data.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { accentColor } from './colors'

const props = defineProps<{
  data: {
    label: string
    accent?: string
  }
}>()

const accentHex = computed(() => accentColor(props.data.accent))
</script>

<style scoped>
.elastic-capacity-group {
  --group-accent: #3b82f6;
  position: relative;
  cursor: grab;
  border-color: color-mix(in srgb, var(--group-accent) 42%, transparent);
  background: color-mix(in srgb, var(--group-accent) 2%, transparent);
}

.elastic-capacity-group:active {
  cursor: grabbing;
}

.elastic-capacity-label {
  position: absolute;
  top: 0;
  left: 14px;
  transform: translateY(-50%);
  padding: 0 7px;
  color: color-mix(in srgb, var(--group-accent) 60%, var(--muted-foreground));
  background: var(--background);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
  white-space: nowrap;
}
</style>
