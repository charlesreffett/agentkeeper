<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import { toast } from 'vue-sonner'
import type { PluginRecord, UpdateAvailable } from '@shared/ipc-contract'
import type { PluginManifest } from '@agentkeeper/sdk'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import PluginSettingsForm from './PluginSettingsForm.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

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
const { mutate: doUpdate }    = useMutation({
  mutationFn: (id: string) => window.agentkeeper.plugins.update(id),
  onSuccess: (result) => {
    invalidate()
    if (result.actionRequired) {
      toast.warning('Plugin updated and disabled', { description: 'Its requested access changed. Review the new permissions to continue using it.' })
    }
  },
  onError: onMutationError,
})
const { mutate: doApprovePermissions } = useMutation({
  mutationFn: (id: string) => window.agentkeeper.plugins.approvePermissions(id),
  onSuccess: () => {
    reviewPermissionsPlugin.value = null
    toast.success('Plugin permissions approved')
    invalidate()
  },
  onError: onMutationError,
})

// ── Enable / Disable toggle ───────────────────────────────────────────────────

// Local switch state — one boolean per plugin id, writable by the Switch v-model.
// Initialised from query data for newly appearing plugins; existing entries are
// left alone so a user-initiated toggle isn't clobbered by the next refetch.
const localEnabled = reactive<Record<string, boolean>>({})

watch(plugins, (list) => {
  const liveIds = new Set(list?.map(p => p.id) ?? [])
  for (const p of list ?? []) {
    if (!(p.id in localEnabled) || p.actionRequired) localEnabled[p.id] = p.enabled
  }
  for (const id of Object.keys(localEnabled)) {
    if (!liveIds.has(id)) delete localEnabled[id]
  }
}, { immediate: true })

// Drive mutations whenever a switch is flipped.
watch(() => ({ ...localEnabled }), (cur, prev) => {
  for (const [id, enabled] of Object.entries(cur)) {
    if (id in prev && enabled !== prev[id]) {
      enabled ? doEnable(id) : doDisable(id)
    }
  }
})

// ── Install ───────────────────────────────────────────────────────────────────

// ── Install dialog ────────────────────────────────────────────────────────────

type InstallStep = 'input' | 'review'

const installDialogOpen = ref(false)
const installStep = ref<InstallStep>('input')
const installUrl = ref('')
const preparing = ref(false)
const installing = ref(false)
const installError = ref<string | null>(null)
const pendingManifest = ref<PluginManifest | null>(null)
const installToken = ref<string | null>(null)

const canContinue = computed(() =>
  !preparing.value && !installing.value && installUrl.value.trim().length > 0,
)

const permissionLabels: Record<string, string> = {
  workItems:  'Read and create work items',
  secrets:    'Store credentials in the OS keychain',
  commands:   'Register slash commands in sessions',
  ui:         'Add plugin routes and navigation',
  background: 'Run tasks in the background',
  network:    'Make outbound network requests',
  nativeProcess: 'Execute arbitrary programs with your user permissions',
  environment: 'Read declared environment variables',
}

function resetInstallDialog() {
  installStep.value = 'input'
  installUrl.value = ''
  installError.value = null
  pendingManifest.value = null
  if (installToken.value) {
    void window.agentkeeper.plugins.cancelAkpInstall(installToken.value)
    installToken.value = null
  }
}

function openInstallDialog() {
  resetInstallDialog()
  installDialogOpen.value = true
}

// Cancel any pending token when dialog is closed externally (Escape / backdrop)
watch(installDialogOpen, (open) => { if (!open) resetInstallDialog() })

async function browseForFile() {
  preparing.value = true
  installError.value = null
  try {
    const filePath = await window.agentkeeper.plugins.pickAkpFile()
    if (!filePath) return
    const result = await window.agentkeeper.plugins.prepareAkpInstall({ filePath })
    pendingManifest.value = result.manifest
    installToken.value = result.token
    installStep.value = 'review'
  } catch (e) {
    installError.value = e instanceof Error ? e.message : String(e)
  } finally {
    preparing.value = false
  }
}

async function prepareFromUrl() {
  if (!canContinue.value) return
  preparing.value = true
  installError.value = null
  try {
    const result = await window.agentkeeper.plugins.prepareAkpInstall({ manifestUrl: installUrl.value.trim() })
    pendingManifest.value = result.manifest
    installToken.value = result.token
    installStep.value = 'review'
  } catch (e) {
    installError.value = e instanceof Error ? e.message : String(e)
  } finally {
    preparing.value = false
  }
}

async function confirmInstall() {
  if (!installToken.value) return
  installing.value = true
  installError.value = null
  try {
    await window.agentkeeper.plugins.confirmAkpInstall(installToken.value)
    installToken.value = null
    installDialogOpen.value = false
    invalidate()
  } catch (e) {
    installError.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

function denyInstall() {
  if (installToken.value) {
    void window.agentkeeper.plugins.cancelAkpInstall(installToken.value)
    installToken.value = null
  }
  pendingManifest.value = null
  installStep.value = 'input'
  installError.value = null
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

const reviewPermissionsPlugin = ref<PluginRecord | null>(null)

const addedAuthority = computed(() => {
  const plugin = reviewPermissionsPlugin.value
  if (!plugin) return { permissions: [], networkHosts: [], environmentVariables: [] }
  return {
    permissions: plugin.manifest.permissions.filter(value => !plugin.grantedAuthority.permissions.includes(value)),
    networkHosts: (plugin.manifest.network?.hosts ?? []).filter(value => !plugin.grantedAuthority.networkHosts.includes(value)),
    environmentVariables: (plugin.manifest.environment?.variables ?? []).filter(value => !plugin.grantedAuthority.environmentVariables.includes(value)),
  }
})

// ── Settings sheet ────────────────────────────────────────────────────────────

const settingsPlugin = ref<PluginRecord | null>(null)

// ── Computed counts ───────────────────────────────────────────────────────────

const installedCount = computed(() => plugins.value?.length ?? 0)
const activeCount = computed(() => plugins.value?.filter(p => p.status === 'active').length ?? 0)

// ── Helpers ───────────────────────────────────────────────────────────────────

const sourceBadgeClass: Record<string, string> = {
  bundled: 'bg-blue-500/20 text-blue-400',
  local:   'bg-green-500/20 text-green-400',
  dev:     'bg-orange-500/20 text-orange-400',
}

const statusBadgeClass: Record<string, string> = {
  active:    'bg-green-500/15 text-green-600 dark:text-green-400',
  inactive:  'bg-muted text-muted-foreground',
  unhealthy: 'bg-red-500/15 text-red-500',
}

const AVATAR_COLORS: string[] = ['#3b82f6', '#1e293b', '#7c3aed', '#0d9488', '#ea580c', '#16a34a', '#dc2626']

function pluginAvatarColor(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!
}

function pluginInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function openExternal(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div v-if="!embedded" class="px-6 py-4 border-b border-border">
      <h1 class="text-lg font-semibold">Plugin Management</h1>
      <p class="text-sm text-muted-foreground">{{ installedCount }} installed · {{ activeCount }} active</p>
      <div class="flex items-center gap-2 mt-3">
        <Button size="sm" variant="outline" @click="loadDev">Load unpacked</Button>
        <Button size="sm" @click="openInstallDialog">Install from AKP</Button>
        <span v-if="mutationError" class="text-xs text-destructive">{{ mutationError }}</span>
      </div>
    </div>

    <!-- Install dialog -->
    <Dialog v-model:open="installDialogOpen">
      <DialogContent class="max-w-[600px]">

        <!-- Step 1: input -->
        <template v-if="installStep === 'input'">
          <DialogHeader>
            <DialogTitle>Install from AKP</DialogTitle>
            <DialogDescription>
              Paste a URL to a plugin update manifest, or browse for a <code class="font-mono text-foreground">.akp</code> file on your computer.
            </DialogDescription>
          </DialogHeader>

          <div class="flex items-center gap-2">
            <input
              v-model="installUrl"
              type="url"
              placeholder="https://example.com/my-plugin/update-manifest.json"
              class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              :disabled="preparing"
              @keydown.enter="prepareFromUrl"
            />
            <Button size="sm" variant="outline" :disabled="preparing" @click="browseForFile">
              Browse…
            </Button>
          </div>

          <p v-if="installError" class="text-xs text-destructive -mt-2">{{ installError }}</p>

          <div v-if="installUrl.trim()" class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 mt-px shrink-0">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <path d="M12 9v4M12 17h.01"/>
            </svg>
            Only install plugins from sources you trust. Plugins run with access to your sessions, secrets, and file system.
          </div>

          <DialogFooter>
            <Button variant="outline" :disabled="preparing" @click="installDialogOpen = false">Cancel</Button>
            <Button :disabled="!canContinue" @click="prepareFromUrl">
              {{ preparing ? 'Loading…' : 'Continue' }}
            </Button>
          </DialogFooter>
        </template>

        <!-- Step 2: permission review -->
        <template v-else-if="installStep === 'review' && pendingManifest">
          <DialogHeader>
            <DialogTitle class="flex items-baseline gap-2">
              {{ pendingManifest.name }}
              <span class="font-mono text-sm font-normal text-muted-foreground">v{{ pendingManifest.version }}</span>
            </DialogTitle>
            <DialogDescription v-if="pendingManifest.description">
              {{ pendingManifest.description }}
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-4">
            <div v-if="pendingManifest.permissions.length === 0" class="text-sm text-muted-foreground italic">
              This plugin requests no special permissions.
            </div>
            <template v-else>
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permissions requested</p>
              <ul class="space-y-2">
                <li
                  v-for="perm in pendingManifest.permissions"
                  :key="perm"
                  class="flex items-start gap-2.5 text-sm"
                >
                  <span class="text-amber-500 mt-px shrink-0">⚠</span>
                  <span>{{ permissionLabels[perm] ?? perm }}</span>
                </li>
              </ul>
            </template>

            <div v-if="pendingManifest.network?.hosts?.length">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Network access</p>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="host in pendingManifest.network.hosts"
                  :key="host"
                  class="font-mono text-xs bg-muted/50 rounded px-2 py-0.5"
                >{{ host }}</span>
              </div>
            </div>
          </div>

          <p v-if="installError" class="text-xs text-destructive">{{ installError }}</p>

          <DialogFooter>
            <Button variant="outline" :disabled="installing" @click="denyInstall">Deny</Button>
            <Button :disabled="installing" @click="confirmInstall">
              {{ installing ? 'Installing…' : 'Install' }}
            </Button>
          </DialogFooter>
        </template>

      </DialogContent>
    </Dialog>

    <div class="flex-1 overflow-y-auto min-h-0">
      <div class="max-w-[700px] mx-auto px-6 py-4">
      <div v-if="embedded" class="mb-4 flex flex-wrap items-center gap-2">
        <span class="mr-auto text-sm text-muted-foreground">{{ installedCount }} installed · {{ activeCount }} active</span>
        <Button size="sm" variant="outline" @click="loadDev">Load unpacked</Button>
        <Button size="sm" @click="openInstallDialog">Install from AKP</Button>
        <span v-if="mutationError" class="text-xs text-destructive">{{ mutationError }}</span>
      </div>
      <div v-if="isLoading" class="text-sm text-muted-foreground animate-pulse">
        Loading plugins…
      </div>

      <div
        v-else-if="!plugins || plugins.length === 0"
        class="text-sm text-muted-foreground"
      >
        No plugins installed. Click <strong>Install from AKP</strong> to add a packaged plugin, or
        <strong>Load unpacked</strong> to point at a local directory during development.
      </div>

      <ul v-else class="divide-y divide-border/50">
        <li
          v-for="plugin in plugins"
          :key="plugin.id"
          class="py-4 flex items-start gap-4"
        >
          <!-- Avatar -->
          <div
            class="shrink-0 size-10 rounded-lg overflow-hidden flex items-center justify-center"
            :style="plugin.manifest.icon ? {} : { backgroundColor: pluginAvatarColor(plugin.id) }"
          >
            <img
              v-if="plugin.manifest.icon"
              :src="plugin.manifest.icon"
              :alt="plugin.name"
              class="size-10 object-cover"
            />
            <span v-else class="text-white text-sm font-bold leading-none select-none">
              {{ pluginInitials(plugin.name) }}
            </span>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0 space-y-1">
            <!-- Row 1: name + version + source badge + status badge + update badge -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold">{{ plugin.name }}</span>
              <span class="text-[11px] font-mono text-muted-foreground">v{{ plugin.version }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                :class="sourceBadgeClass[plugin.source] ?? 'bg-muted text-muted-foreground'"
              >{{ plugin.source }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                :class="statusBadgeClass[plugin.status] ?? 'bg-muted text-muted-foreground'"
                :title="plugin.status === 'unhealthy' ? (plugin.unhealthyReason ?? plugin.status) : plugin.status"
              >{{ plugin.status }}</span>
              <button
                v-if="plugin.actionRequired"
                class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 transition-colors"
                @click="reviewPermissionsPlugin = plugin"
              >Action required</button>
              <button
                v-if="pendingUpdates.has(plugin.id)"
                class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                @click="promptUpdate(plugin)"
              >
                Update available
              </button>
            </div>

            <!-- Row 2: description -->
            <p v-if="plugin.manifest.description" class="text-sm text-muted-foreground truncate">
              {{ plugin.manifest.description }}
            </p>

            <!-- Row 3: permissions -->
            <div v-if="plugin.manifest.permissions?.length" class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs text-muted-foreground">Permissions:</span>
              <span
                v-for="perm in plugin.manifest.permissions"
                :key="perm"
                class="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border bg-muted/30"
              >{{ perm }}</span>
            </div>
          </div>

          <!-- Controls -->
          <div class="shrink-0 flex items-center gap-2">
            <!-- Enable/disable switch -->
            <Switch
              v-model="localEnabled[plugin.id]"
              class="data-[state=checked]:bg-amber-500"
              :disabled="plugin.actionRequired"
            />

            <!-- More actions dropdown -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8 text-muted-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-4">
                    <circle cx="12" cy="5" r="1.5"/>
                    <circle cx="12" cy="12" r="1.5"/>
                    <circle cx="12" cy="19" r="1.5"/>
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem
                  v-if="plugin.manifest.homepage_url"
                  @click="plugin.manifest.homepage_url && openExternal(plugin.manifest.homepage_url)"
                >
                  View on GitHub
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="plugin.manifest.settings_schema"
                  @click="settingsPlugin = plugin"
                >
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="plugin.manifest.homepage_url || plugin.manifest.settings_schema" />
                <DropdownMenuItem
                  @click="plugin.actionRequired ? (reviewPermissionsPlugin = plugin) : (localEnabled[plugin.id] = !localEnabled[plugin.id])"
                >
                  {{ plugin.actionRequired ? 'Review permissions…' : (localEnabled[plugin.id] ? 'Disable' : 'Enable') }}
                </DropdownMenuItem>
                <template v-if="plugin.source !== 'bundled'">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @click="promptUninstall(plugin)"
                  >
                    Remove…
                  </DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </li>
      </ul>
      </div><!-- /max-w inner -->
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

    <!-- Permission changes installed by an update require explicit approval. -->
    <AlertDialog
      :open="reviewPermissionsPlugin !== null"
      @update:open="(open) => { if (!open) reviewPermissionsPlugin = null }"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Review changed plugin access</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="reviewPermissionsPlugin">
              <strong>{{ reviewPermissionsPlugin.name }}</strong> was updated but remains disabled until you approve its new access.
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="space-y-3 text-sm">
          <div v-if="addedAuthority.permissions.length">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">New permissions</p>
            <ul class="space-y-1">
              <li v-for="permission in addedAuthority.permissions" :key="permission" class="flex gap-2">
                <span class="text-amber-500">⚠</span>
                <span>{{ permissionLabels[permission] ?? permission }}</span>
              </li>
            </ul>
          </div>
          <div v-if="addedAuthority.networkHosts.length">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">New network origins</p>
            <code v-for="host in addedAuthority.networkHosts" :key="host" class="block text-xs">{{ host }}</code>
          </div>
          <div v-if="addedAuthority.environmentVariables.length">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">New environment variables</p>
            <code class="text-xs">{{ addedAuthority.environmentVariables.join(', ') }}</code>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel @click="reviewPermissionsPlugin = null">Keep disabled</AlertDialogCancel>
          <AlertDialogAction
            v-if="reviewPermissionsPlugin"
            @click="doApprovePermissions(reviewPermissionsPlugin.id)"
          >Approve and enable</AlertDialogAction>
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
