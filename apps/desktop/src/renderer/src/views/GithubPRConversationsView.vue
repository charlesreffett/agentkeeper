<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import type { PRComment, PRDetail } from '@shared/github-types'

const route = useRoute()
const prNumber = computed(() => Number(route.params.number))

const pr = ref<PRDetail | null>(null)
const comments = ref<PRComment[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const newComment = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [detail, fetched] = await Promise.all([
      window.orchestral.github.getPR(prNumber.value),
      window.orchestral.github.getPRComments(prNumber.value),
    ])
    pr.value = detail
    comments.value = fetched.slice().sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function submitComment() {
  const body = newComment.value.trim()
  if (!body) return
  submitting.value = true
  submitError.value = null
  try {
    await window.orchestral.github.addComment(prNumber.value, body)
    newComment.value = ''
    comments.value = (await window.orchestral.github.getPRComments(prNumber.value)).slice().sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
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
</script>

<template>
  <div class="flex flex-col h-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-pulse text-sm text-muted-foreground">Loading…</div>
    </div>

    <div v-else-if="error" class="text-destructive text-sm p-4">{{ error }}</div>

    <div v-else class="flex-1 min-h-0 overflow-auto p-4 space-y-4">
      <!-- PR description -->
      <div v-if="pr?.body" class="rounded border border-border p-4">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
            {{ avatarInitial(pr.author) }}
          </div>
          <span class="text-sm font-medium">{{ pr.author }}</span>
          <span class="text-xs text-muted-foreground">opened this PR</span>
        </div>
        <pre class="text-sm text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">{{ pr.body }}</pre>
      </div>

      <!-- Comments -->
      <div v-for="comment in comments" :key="comment.id" class="rounded border border-border p-4">
        <div class="flex items-start gap-2">
          <div class="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
            {{ avatarInitial(comment.author) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-medium">{{ comment.author }}</span>
              <span class="text-xs text-muted-foreground">{{ relativeTime(comment.createdAt) }}</span>
              <span
                v-if="comment.path && comment.line"
                class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono"
              >{{ comment.path }}:{{ comment.line }}</span>
            </div>
            <pre class="text-sm text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">{{ comment.body }}</pre>
          </div>
        </div>
      </div>

      <div v-if="comments.length === 0 && !pr?.body" class="text-sm text-muted-foreground text-center py-6">
        No comments yet.
      </div>
    </div>

    <!-- Add comment form -->
    <div class="shrink-0 border-t border-border p-4 space-y-2">
      <textarea
        v-model="newComment"
        placeholder="Leave a comment…"
        rows="3"
        class="w-full text-sm bg-background border border-input rounded px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
      />
      <div class="flex items-center justify-between">
        <div v-if="submitError" class="text-destructive text-xs">{{ submitError }}</div>
        <div v-else class="flex-1" />
        <button
          class="text-sm px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          :disabled="submitting || !newComment.trim()"
          @click="submitComment"
        >
          {{ submitting ? 'Posting…' : 'Comment' }}
        </button>
      </div>
    </div>
  </div>
</template>
