<script setup lang="ts">
import { computed } from 'vue'
import { useModelsQuery } from '@/composables/useModelsQuery'

// Resolves a model label against the SESSION's harness, so a row in a
// mixed-harness list (e.g. the monitor grid) isn't resolved against the default
// harness and mislabeled. Vue Query dedups by harnessId, so many rows of the
// same harness share one models fetch.
const props = defineProps<{
  model?: string | null
  harnessId?: string | null
}>()

const { resolvedLabelFor } = useModelsQuery(() => props.harnessId ?? undefined)

const label = computed(() => resolvedLabelFor(props.model ?? null))
</script>

<template>
  <span>{{ label }}</span>
</template>
