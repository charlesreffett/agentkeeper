<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { AppSettings } from '@shared/ipc-contract'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { useSettingsLeavePrompt } from '@/composables/useSettingsLeavePrompt'
import { NOTIFICATION_SOUND_LABELS, NOTIFICATION_SOUND_VALUES, playNotificationSound } from '@/lib/notificationSound'

type GeneralDraft = Pick<AppSettings,
  'defaultUseWorktree' | 'gitSwitchWithoutSoftReject' | 'sessionExpiryEnabled' |
  'sessionExpiryDays' | 'notifications' | 'notificationSound' | 'enterToSend' | 'sendModifier'>

const { settings: storedSettings, saveSettings } = useSettingsQuery()
const draft = ref<GeneralDraft | null>(null)
const baseline = ref<GeneralDraft | null>(null)
const saving = ref(false)

function selectGeneral(settings: AppSettings): GeneralDraft {
  return {
    defaultUseWorktree: settings.defaultUseWorktree,
    gitSwitchWithoutSoftReject: settings.gitSwitchWithoutSoftReject,
    sessionExpiryEnabled: settings.sessionExpiryEnabled,
    sessionExpiryDays: settings.sessionExpiryDays,
    notifications: settings.notifications,
    notificationSound: settings.notificationSound,
    enterToSend: settings.enterToSend,
    sendModifier: settings.sendModifier,
  }
}

watch(storedSettings, (value) => {
  if (!value || draft.value) return
  draft.value = selectGeneral(value)
  baseline.value = selectGeneral(value)
}, { immediate: true })

const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(baseline.value))

async function save() {
  if (!draft.value || !isDirty.value) return
  saving.value = true
  try {
    await saveSettings({ ...draft.value })
    baseline.value = { ...draft.value }
    toast.success('General settings saved')
  } finally {
    saving.value = false
  }
}

function discard() {
  if (baseline.value) draft.value = { ...baseline.value }
}

useSettingsLeavePrompt(isDirty, save)
</script>

<template>
  <SettingsPage title="General" description="Set defaults for sessions, notifications, and message sending.">
    <template v-if="draft">
      <section class="space-y-3" aria-labelledby="session-defaults-heading">
        <h2 id="session-defaults-heading" class="text-sm font-semibold">Session defaults</h2>
        <div class="divide-y rounded-lg border">
          <label class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Use worktree by default</span><span class="mt-0.5 block text-xs text-muted-foreground">Run new sessions in isolated git worktrees.</span></span>
            <Switch v-model="draft.defaultUseWorktree" aria-label="Use worktree by default" />
          </label>
          <label class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Switch branches without warning</span><span class="mt-0.5 block text-xs text-muted-foreground">Carry uncommitted changes across branch switches without prompting.</span></span>
            <Switch v-model="draft.gitSwitchWithoutSoftReject" aria-label="Switch branches without warning" />
          </label>
          <label class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Auto-delete old sessions</span><span class="mt-0.5 block text-xs text-muted-foreground">Remove inactive persisted sessions during startup and shutdown.</span></span>
            <Switch v-model="draft.sessionExpiryEnabled" aria-label="Auto-delete old sessions" />
          </label>
          <label v-if="draft.sessionExpiryEnabled" class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Session age limit</span><span class="mt-0.5 block text-xs text-muted-foreground">Sessions inactive longer than this can be deleted.</span></span>
            <select v-model="draft.sessionExpiryDays" class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52">
              <option :value="1">1 day</option><option :value="3">3 days</option><option :value="7">7 days</option><option :value="14">14 days</option><option :value="21">21 days</option><option :value="30">30 days</option><option :value="null">Never</option>
            </select>
          </label>
        </div>
      </section>

      <section class="space-y-3" aria-labelledby="notifications-heading">
        <h2 id="notifications-heading" class="text-sm font-semibold">Notifications</h2>
        <div class="divide-y rounded-lg border">
          <label class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Session notifications</span><span class="mt-0.5 block text-xs text-muted-foreground">Choose how AgentKeeper alerts you when work completes.</span></span>
            <select v-model="draft.notifications" class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-60">
              <option value="all">Desktop notification + sound</option><option value="notification-only">Desktop notification only</option><option value="sound-only">Sound only</option><option value="toast">In-app toast only</option><option value="disabled">Disabled</option>
            </select>
          </label>
          <div v-if="draft.notifications === 'all' || draft.notifications === 'sound-only'" class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div class="min-w-0 flex-1"><p class="text-sm font-medium">Notification sound</p><p class="mt-0.5 text-xs text-muted-foreground">Preview the sound used for completed sessions.</p></div>
            <div class="flex gap-2"><select v-model="draft.notificationSound" aria-label="Notification sound" class="min-w-36 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option v-for="sound in NOTIFICATION_SOUND_VALUES" :key="sound" :value="sound">{{ NOTIFICATION_SOUND_LABELS[sound] }}</option></select><Button size="sm" variant="outline" @click="playNotificationSound(draft.notificationSound)">Preview</Button></div>
          </div>
        </div>
      </section>

      <section class="space-y-3" aria-labelledby="message-heading">
        <h2 id="message-heading" class="text-sm font-semibold">Message sending</h2>
        <div class="divide-y rounded-lg border">
          <label class="flex items-center gap-4 px-4 py-3"><span class="min-w-0 flex-1"><span class="block text-sm font-medium">Enter to send</span><span class="mt-0.5 block text-xs text-muted-foreground">When off, modifier+Enter sends and Enter inserts a newline.</span></span><Switch v-model="draft.enterToSend" aria-label="Enter to send" /></label>
          <label class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"><span class="min-w-0 flex-1"><span class="block text-sm font-medium">Send modifier</span><span class="mt-0.5 block text-xs text-muted-foreground">Modifier used with Enter when Enter-to-send is disabled.</span></span><select v-model="draft.sendModifier" class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52"><option value="auto">System default</option><option value="meta">Command / Meta</option><option value="ctrl">Control</option><option value="alt">Alt / Option</option><option value="shift">Shift</option></select></label>
        </div>
      </section>
    </template>
    <p v-else class="text-sm text-muted-foreground">Loading settings…</p>

    <template #footer>
      <footer class="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:px-6">
        <Button variant="ghost" size="sm" :disabled="!isDirty || saving" @click="discard">Discard</Button>
        <Button size="sm" :disabled="!isDirty || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</Button>
      </footer>
    </template>
  </SettingsPage>
</template>
