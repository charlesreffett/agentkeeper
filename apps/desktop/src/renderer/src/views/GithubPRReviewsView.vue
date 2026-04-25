<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import type { PRReview, PRDetail, ReviewEvent } from '@shared/github-types'

const route = useRoute()
const prNumber = computed(() => Number(route.params.number))

const pr = ref<PRDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const reviewEvent = ref<ReviewEvent>('COMMENT')
const reviewBody = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    pr.value = await window.orchestral.github.getPR(prNumber.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function submitReview() {
  submitting.value = true
  submitError.value = null
  try {
    await window.orchestral.github.submitReview(prNumber.value, reviewEvent.value, reviewBody.value)
    reviewBody.value = ''
    reviewEvent.value = 'COMMENT'
    await load()
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function avatarInitial(author: string): string {
  return author.charAt(0).toUpperCase()
}

type ReviewState = PRReview['state']

const reviewStateMeta: Record<ReviewState, { label: string; cls: string }> = {
  APPROVED: { label: 'Approved', cls: 'bg-green-500/20 text-green-400' },
  CHANGES_REQUESTED: { label: 'Changes requested', cls: 'bg-red-500/20 text-red-400' },
  COMMENTED: { label: 'Commented', cls: 'bg-muted text-muted-foreground' },
  DISMISSED: { label: 'Dismissed', cls: 'bg-muted text-muted-foreground' },
  PENDING: { label: 'Pending', cls: 'bg-muted text-muted-foreground' },
}

const reviews = computed(() => pr.value?.reviews ?? [])
</script>

<template>
  <div class="flex flex-col h-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-pulse text-sm text-muted-foreground">Loading reviews…</div>
    </div>

    <div v-else-if="error" class="text-destructive text-sm p-4">{{ error }}</div>

    <div v-else class="flex-1 min-h-0 overflow-auto p-4 space-y-4">
      <div v-if="reviews.length === 0" class="text-sm text-muted-foreground text-center py-6">
        No reviews yet.
      </div>

      <div
        v-for="review in reviews"
        :key="review.id"
        class="rounded border border-border p-4"
      >
        <div class="flex items-start gap-2">
          <div class="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
            {{ avatarInitial(review.author) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="text-sm font-medium">{{ review.author }}</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="reviewStateMeta[review.state].cls"
              >{{ reviewStateMeta[review.state].label }}</span>
              <span class="text-xs text-muted-foreground">{{ relativeTime(review.submittedAt) }}</span>
            </div>
            <pre v-if="review.body" class="text-sm text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">{{ review.body }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Submit review form -->
    <div class="shrink-0 border-t border-border p-4 space-y-3">
      <div class="text-xs font-medium text-muted-foreground">Submit a review</div>
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-1.5 text-sm cursor-pointer">
          <input v-model="reviewEvent" type="radio" value="APPROVE" class="accent-green-500" />
          <span class="text-green-400">Approve</span>
        </label>
        <label class="flex items-center gap-1.5 text-sm cursor-pointer">
          <input v-model="reviewEvent" type="radio" value="REQUEST_CHANGES" class="accent-red-500" />
          <span class="text-red-400">Request changes</span>
        </label>
        <label class="flex items-center gap-1.5 text-sm cursor-pointer">
          <input v-model="reviewEvent" type="radio" value="COMMENT" />
          <span>Comment</span>
        </label>
      </div>
      <textarea
        v-model="reviewBody"
        placeholder="Leave a review comment…"
        rows="3"
        class="w-full text-sm bg-background border border-input rounded px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
      />
      <div class="flex items-center justify-between">
        <div v-if="submitError" class="text-destructive text-xs">{{ submitError }}</div>
        <div v-else class="flex-1" />
        <button
          class="text-sm px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          :disabled="submitting"
          @click="submitReview"
        >
          {{ submitting ? 'Submitting…' : 'Submit review' }}
        </button>
      </div>
    </div>
  </div>
</template>
