<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const settings = ref<{ enabled: boolean; port: number; secretKey: string }>({
  enabled: false,
  port: 57372,
  secretKey: '',
})
const localIp = ref('...')
const saving = ref(false)
const copyDone = ref(false)

onMounted(async () => {
  const s = await window.agentkeeper.settings.get()
  if (s.mobileServer) Object.assign(settings.value, s.mobileServer)
  localIp.value = await window.agentkeeper.mobile.getLocalIp()
})

async function save() {
  saving.value = true
  await window.agentkeeper.settings.set({ mobileServer: { ...settings.value } })
  saving.value = false
}

async function regenerate() {
  settings.value.secretKey = await window.agentkeeper.mobile.generateKey()
  await save()
}

async function copyKey() {
  await navigator.clipboard.writeText(settings.value.secretKey)
  copyDone.value = true
  setTimeout(() => { copyDone.value = false }, 1500)
}

const serverUrl = computed(() =>
  `http://${localIp.value}:${settings.value.port}`
)
</script>

<template>
  <div class="max-w-lg space-y-6">
    <div class="flex items-center gap-3">
      <Switch id="remote-enabled" :model-value="settings.enabled" @update:model-value="v => { settings.enabled = v; save() }" />
      <label for="remote-enabled" class="text-sm font-medium leading-none">Enable remote access</label>
    </div>

    <div class="space-y-1">
      <label for="remote-port" class="text-sm font-medium leading-none">Port</label>
      <Input id="remote-port" type="number" v-model.number="settings.port" @change="save" class="w-32" />
    </div>

    <div class="space-y-1">
      <label for="remote-secret" class="text-sm font-medium leading-none">Secret key</label>
      <div class="flex gap-2">
        <Input id="remote-secret" :value="settings.secretKey || '(not set)'" readonly class="font-mono text-xs flex-1" />
        <Button size="sm" variant="outline" @click="regenerate">Regenerate</Button>
        <Button size="sm" variant="outline" @click="copyKey">{{ copyDone ? 'Copied!' : 'Copy' }}</Button>
      </div>
    </div>

    <div v-if="settings.enabled && settings.secretKey" class="rounded-md bg-muted px-4 py-3 text-sm">
      <p class="font-medium mb-1">Pair with the AgentKeeper companion app</p>
      <p class="font-mono text-xs text-muted-foreground">{{ serverUrl }}</p>
      <p class="text-xs text-muted-foreground mt-1">Enter this URL and your secret key in the iOS companion app.</p>
    </div>
  </div>
</template>
