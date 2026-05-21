<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { PluginRecord, UpdateAvailable } from '@shared/ipc-contract'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/PageHeader.vue'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import PluginSettingsForm from './PluginSettingsForm.vue'

const queryClient = useQueryClient()

// ── Queries ──────────────────────────────────────────────────────────────────

const { data: plugins, isLoading } = useQuery({
  queryKey: queryKeys.plugins.list(),
  queryFn: () => window.agentkeeper.plugins.list(),
})

const { data: pendingUpdatesRaw } = useQuery({
  queryKey: queryKeys.plugins.updates(),
  queryFn: () => window.agentkeeper.plugins.checkUpdates(),
  staleTime: 5 * 60 * 1000,
})

const pendingUpdates = computed<Map<string, UpdateAvailable>>(() => {
  const map = new Map<string, UpdateAvailable>()
  for (const u of pendingUpdatesRaw.value ?? []) {
    map.set(u.pluginId, u)
  }
  return map
})

function invalidate() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

const mutationError = ref<string | null>(null)

function onMutationError(err: unknown) {
  mutationError.value = err instanceof Error ? err.message : String(err)
}

const { mutate: doEnable }    = useMutation({ mutationFn: (id: string) => window.agentkeeper.plugins.enable(id),    onSuccess: invalidate, onError: onMutationError })
const { mutate: doDisable }   = useMutation({ mutationFn: (id: string) => window.agentkeeper.plugins.disable(id),   onSuccess: invalidate, onError: onMutationError })
const { mutate: doUninstall } = useMutation({ mutationFn: (id: string) => window.agentkeeper.plugins.uninstall(id), onSuccess: invalidate, onError: onMutationError })
const { mutate: doUpdate }    = useMutation({ mutationFn: (id: string) => window.agentkeeper.plugins.update(id),    onSuccess: invalidate, onError: onMutationError })

// ── Enable / Disable toggle ───────────────────────────────────────────────────

function toggleEnabled(plugin: PluginRecord) {
  if (plugin.enabled) {
    doDisable(plugin.id)
  } else {
    doEnable(plugin.id)
  }
}

// ── Install ───────────────────────────────────────────────────────────────────

const installing = ref(false)
const installError = ref<string | null>(null)

async function installFromFile() {
  installing.value = true
  installError.value = null
  try {
    await window.agentkeeper.plugins.install()
    invalidate()
  } catch (e) {
    installError.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

async function loadDev() {
  installing.value = true
  installError.value = null
  try {
    await window.agentkeeper.plugins.loadDev()
    invalidate()
  } catch (e) {
    installError.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

// ── Uninstall confirmation ────────────────────────────────────────────────────

const confirmUninstallId = ref<string | null>(null)
const confirmUninstallName = ref('')

function promptUninstall(plugin: PluginRecord) {
  confirmUninstallId.value = plugin.id
  confirmUninstallName.value = plugin.name
}

function confirmUninstall() {
  if (confirmUninstallId.value) {
    doUninstall(confirmUninstallId.value)
  }
  confirmUninstallId.value = null
}

// ── Update confirmation ───────────────────────────────────────────────────────

const confirmUpdateId = ref<string | null>(null)
const confirmUpdateInfo = computed<UpdateAvailable | null>(() =>
  confirmUpdateId.value ? (pendingUpdates.value.get(confirmUpdateId.value) ?? null) : null,
)

function promptUpdate(plugin: PluginRecord) {
  confirmUpdateId.value = plugin.id
}

function confirmUpdate() {
  if (confirmUpdateId.value) {
    doUpdate(confirmUpdateId.value)
  }
  confirmUpdateId.value = null
}

// ── Settings sheet ────────────────────────────────────────────────────────────

const settingsPlugin = ref<PluginRecord | null>(null)

// ── Helpers ───────────────────────────────────────────────────────────────────

const sourceBadgeClass: Record<string, string> = {
  bundled: 'bg-blue-500/20 text-blue-400',
  local:   'bg-green-500/20 text-green-400',
  dev:     'bg-orange-500/20 text-orange-400',
}

const statusDotClass: Record<string, string> = {
  active:    'bg-green-500',
  inactive:  'bg-muted-foreground',
  unhealthy: 'bg-red-500',
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Plugins">
      <template #actions>
        <span v-if="installError || mutationError" class="text-xs text-destructive">{{ installError ?? mutationError }}</span>
        <Button size="sm" variant="outline" :disabled="installing" @click="loadDev">
          Load dev plugin
        </Button>
        <Button size="sm" :disabled="installing" @click="installFromFile">
          {{ installing ? 'Installing…' : 'Install from file' }}
        </Button>
      </template>
    </PageHeader>

    <div class="flex-1 overflow-y-auto min-h-0">
      <div v-if="isLoading" class="p-6 text-sm text-muted-foreground animate-pulse">
        Loading plugins…
      </div>

      <div
        v-else-if="!plugins || plugins.length === 0"
        class="p-6 text-sm text-muted-foreground"
      >
        No plugins installed. Click <strong>Install from file</strong> to add a
        <code class="font-mono text-foreground">.akp</code> plugin package, or
        <strong>Load dev plugin</strong> to point at a local directory during development.
      </div>

      <ul v-else class="divide-y divide-border/50">
        <li
          v-for="plugin in plugins"
          :key="plugin.id"
          class="px-6 py-4 flex items-start gap-4"
        >
          <!-- Icon -->
          <div class="shrink-0 size-10 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center">
            <img
              v-if="plugin.manifest.icon"
              :src="plugin.manifest.icon"
              :alt="plugin.name"
              class="size-8 object-contain"
            />
            <!-- puzzle-piece fallback -->
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="size-5 text-muted-foreground">
              <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.836l-1.61 1.612a2.415 2.415 0 0 1-1.705.707 2.415 2.415 0 0 1-1.704-.707l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.415 2.415 0 0 1 1 12c0-.617.236-1.234.706-1.704L3.317 8.69a.979.979 0 0 1 .836-.276c.47.07.803.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.445-.165-.854-.497-.925-.967a.979.979 0 0 1 .276-.837l1.61-1.61a2.415 2.415 0 0 1 1.705-.707 2.415 2.415 0 0 1 1.704.707l1.568 1.567c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z"/>
            </svg>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0 space-y-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold">{{ plugin.name }}</span>
              <span class="text-xs text-muted-foreground font-mono">v{{ plugin.version }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                :class="sourceBadgeClass[plugin.source] ?? 'bg-muted text-muted-foreground'"
              >{{ plugin.source }}</span>
              <!-- update badge -->
              <button
                v-if="pendingUpdates.has(plugin.id)"
                class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                @click="promptUpdate(plugin)"
              >
                Update available
              </button>
            </div>
            <p v-if="plugin.manifest.description" class="text-xs text-muted-foreground truncate">
              {{ plugin.manifest.description }}
            </p>
            <!-- status indicator -->
            <div class="flex items-center gap-1.5 pt-0.5">
              <span
                class="inline-block size-1.5 rounded-full"
                :class="statusDotClass[plugin.status] ?? 'bg-muted-foreground'"
                :title="plugin.status === 'unhealthy' ? plugin.unhealthyReason : plugin.status"
              />
              <span class="text-[10px] text-muted-foreground">{{ plugin.status }}</span>
              <span
                v-if="plugin.status === 'unhealthy' && plugin.unhealthyReason"
                class="text-[10px] text-destructive truncate"
              >— {{ plugin.unhealthyReason }}</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="shrink-0 flex items-center gap-1.5">
            <!-- Settings gear -->
            <button
              v-if="plugin.manifest.settings_schema"
              class="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              title="Plugin settings"
              @click="settingsPlugin = plugin"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="size-4">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>

            <!-- Enable / Disable toggle (hidden for bundled) -->
            <button
              v-if="plugin.source !== 'bundled'"
              class="text-xs px-2.5 py-1 rounded border transition-colors"
              :class="plugin.enabled
                ? 'border-border text-muted-foreground hover:text-destructive hover:border-destructive'
                : 'border-green-500/40 text-green-400 hover:bg-green-500/10'"
              @click="toggleEnabled(plugin)"
            >
              {{ plugin.enabled ? 'Disable' : 'Enable' }}
            </button>

            <!-- Uninstall (hidden for bundled) -->
            <Button
              v-if="plugin.source !== 'bundled'"
              variant="ghost"
              size="sm"
              class="text-xs text-destructive hover:text-destructive"
              @click="promptUninstall(plugin)"
            >
              Remove
            </Button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Uninstall confirmation -->
    <AlertDialog :open="confirmUninstallId !== null" @update:open="(v) => { if (!v) confirmUninstallId = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove plugin?</AlertDialogTitle>
          <AlertDialogDescription>
            This will uninstall <strong>{{ confirmUninstallName }}</strong> and remove all
            associated files. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="confirmUninstallId = null">Cancel</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmUninstall">
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Update confirmation -->
    <AlertDialog :open="confirmUpdateId !== null" @update:open="(v) => { if (!v) confirmUpdateId = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update plugin?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="confirmUpdateInfo">
              Update from <strong>v{{ confirmUpdateInfo.currentVersion }}</strong> to
              <strong>v{{ confirmUpdateInfo.availableVersion }}</strong>.
              <div v-if="confirmUpdateInfo.releaseNotes" class="mt-2 text-xs bg-muted/40 rounded p-2 font-mono whitespace-pre-wrap">
                {{ confirmUpdateInfo.releaseNotes }}
              </div>
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="confirmUpdateId = null">Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmUpdate">Update</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Settings sheet -->
    <Sheet :open="settingsPlugin !== null" @update:open="(v) => { if (!v) settingsPlugin = null }">
      <SheetContent side="right" class="w-96 p-0 flex flex-col">
        <PluginSettingsForm
          v-if="settingsPlugin"
          :plugin-id="settingsPlugin.id"
          :manifest="settingsPlugin.manifest"
          @close="settingsPlugin = null"
        />
      </SheetContent>
    </Sheet>
  </div>
</template>
