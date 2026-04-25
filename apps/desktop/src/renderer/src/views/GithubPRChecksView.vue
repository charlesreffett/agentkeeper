<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import type { CheckRun, CheckState } from '@shared/github-types'

const route = useRoute()
const prNumber = computed(() => Number(route.params.number))
const prRepo = computed(() => String(route.query.repo ?? ''))

const checks = ref<CheckRun[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    checks.value = await window.orchestral.github.getPRChecks(prRepo.value, prNumber.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

function stateOrder(state: CheckState): number {
  switch (state) {
    case 'fail':    return 0
    case 'pending': return 1
    case 'pass':    return 2
    default:        return 3
  }
}

const sorted = computed(() =>
  checks.value.slice().sort((a, b) => stateOrder(a.state) - stateOrder(b.state))
)

const counts = computed(() => ({
  fail: checks.value.filter((c) => c.state === 'fail').length,
  pending: checks.value.filter((c) => c.state === 'pending').length,
  pass: checks.value.filter((c) => c.state === 'pass').length,
}))

function stateIcon(state: CheckState): { symbol: string; cls: string } {
  switch (state) {
    case 'pass':    return { symbol: '✓', cls: 'text-green-400' }
    case 'fail':    return { symbol: '✗', cls: 'text-red-400' }
    case 'pending': return { symbol: '○', cls: 'text-amber-400' }
    default:        return { symbol: '−', cls: 'text-muted-foreground' }
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-pulse text-sm text-muted-foreground">Loading checks…</div>
    </div>

    <div v-else-if="error" class="text-destructive text-sm p-4">{{ error }}</div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <!-- Summary bar -->
      <div class="flex items-center gap-4 px-4 py-3 border-b border-border text-xs">
        <span v-if="counts.fail > 0" class="text-red-400">{{ counts.fail }} failed</span>
        <span v-if="counts.pending > 0" class="text-amber-400">{{ counts.pending }} pending</span>
        <span v-if="counts.pass > 0" class="text-green-400">{{ counts.pass }} passed</span>
        <span v-if="checks.length === 0" class="text-muted-foreground">No checks reported.</span>
      </div>

      <ul class="divide-y divide-border/50">
        <li
          v-for="check in sorted"
          :key="check.name"
          class="flex items-center gap-3 px-4 py-3"
        >
          <span
            class="shrink-0 font-mono text-base w-5 text-center"
            :class="stateIcon(check.state).cls"
          >{{ stateIcon(check.state).symbol }}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ check.name }}</div>
            <div v-if="check.conclusion" class="text-xs text-muted-foreground">{{ check.conclusion }}</div>
          </div>
          <a
            v-if="check.link"
            :href="check.link"
            target="_blank"
            rel="noopener noreferrer"
            class="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
            @click.stop
          >Details</a>
        </li>
      </ul>

      <div v-if="checks.length === 0" class="text-sm text-muted-foreground text-center py-8">
        No check runs found.
      </div>
    </div>
  </div>
</template>
