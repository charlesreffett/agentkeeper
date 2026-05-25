<script setup lang="ts">
import type { PluginManifest } from '@agentkeeper/sdk'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'

defineProps<{
  open: boolean
  manifest: PluginManifest
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const permissionLabels: Record<string, string> = {
  workItems: 'Read and create work items (Jira / GitHub Issues)',
  secrets:   'Store credentials in the OS keychain',
  commands:  'Register slash commands in sessions',
  sidebar:   'Add entries to the app sidebar',
  background:'Run tasks in the background',
  network:   'Make outbound network requests',
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="right" class="w-96 flex flex-col">
      <SheetHeader>
        <SheetTitle>Install Plugin</SheetTitle>
        <SheetDescription>
          Review the permissions requested by <strong>{{ manifest.name }}</strong>
          v{{ manifest.version }} before installing.
        </SheetDescription>
      </SheetHeader>

      <div class="flex-1 overflow-y-auto py-4 space-y-3">
        <div v-if="manifest.description" class="text-sm text-muted-foreground">
          {{ manifest.description }}
        </div>

        <div v-if="manifest.permissions.length === 0" class="text-sm text-muted-foreground italic">
          No special permissions requested.
        </div>
        <div v-else>
          <p class="text-xs font-medium mb-2 uppercase tracking-wide text-muted-foreground">
            Permissions
          </p>
          <ul class="space-y-1.5">
            <li
              v-for="perm in manifest.permissions"
              :key="perm"
              class="flex items-start gap-2 text-sm"
            >
              <span class="mt-0.5 text-amber-500">⚠</span>
              <span>{{ permissionLabels[perm] ?? perm }}</span>
            </li>
          </ul>
        </div>

        <div v-if="manifest.network?.hosts?.length" class="space-y-1">
          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Network allowlist</p>
          <ul class="space-y-0.5">
            <li
              v-for="host in manifest.network.hosts"
              :key="host"
              class="font-mono text-xs text-foreground bg-muted/40 rounded px-2 py-0.5 inline-block mr-1"
            >
              {{ host }}
            </li>
          </ul>
        </div>
      </div>

      <SheetFooter class="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" @click="emit('update:open', false)">Cancel</Button>
        <Button size="sm" @click="emit('confirm')">Install</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
