<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { PluginManifest } from '@agentkeeper/sdk'
import { Button } from '@/components/ui/button'

const props = defineProps<{ pluginId: string; manifest: PluginManifest }>()
const emit = defineEmits<{ close: [] }>()

const schema = computed(() => props.manifest.settings_schema)
const values = ref<Record<string, unknown>>({})
const saving = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const config = await window.agentkeeper.plugins.getConfig(props.pluginId)
    if (config && typeof config === 'object') {
      values.value = config as Record<string, unknown>
    }
  } catch {
    // no stored config yet
  }
})

async function save() {
  if (!schema.value) return
  saving.value = true
  error.value = null
  try {
    await window.agentkeeper.plugins.setConfig(props.pluginId, { ...values.value })
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

function fieldValue(key: string): unknown {
  return values.value[key] ?? schema.value?.properties[key]?.default ?? ''
}

function setField(key: string, val: unknown) {
  values.value = { ...values.value, [key]: val }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-4 py-3 border-b border-border">
      <h2 class="text-sm font-semibold">{{ manifest.name }} Settings</h2>
    </div>

    <div v-if="!schema" class="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6">
      This plugin has no configurable settings.
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4 space-y-4">
      <div
        v-for="[key, prop] in Object.entries(schema.properties)"
        :key="key"
        class="space-y-1"
      >
        <label class="text-xs font-medium text-foreground">
          {{ prop.title ?? key }}
          <span v-if="schema.required?.includes(key)" class="text-destructive ml-0.5">*</span>
        </label>
        <p v-if="prop.description" class="text-xs text-muted-foreground">{{ prop.description }}</p>

        <!-- boolean: toggle -->
        <template v-if="prop.type === 'boolean'">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              :checked="Boolean(fieldValue(key))"
              class="rounded border-input"
              @change="setField(key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="text-sm text-muted-foreground">Enabled</span>
          </label>
        </template>

        <!-- string with enum: select -->
        <template v-else-if="prop.type === 'string' && prop.enum">
          <select
            :value="String(fieldValue(key))"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
            @change="setField(key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="opt in prop.enum" :key="String(opt)" :value="String(opt)">
              {{ String(opt) }}
            </option>
          </select>
        </template>

        <!-- number -->
        <template v-else-if="prop.type === 'number'">
          <input
            type="number"
            :value="Number(fieldValue(key)) || 0"
            :min="prop.minimum"
            :max="prop.maximum"
            :placeholder="prop.placeholder"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
            @input="setField(key, Number(($event.target as HTMLInputElement).value))"
          />
        </template>

        <!-- string (plain text) -->
        <template v-else>
          <input
            type="text"
            :value="String(fieldValue(key))"
            :placeholder="prop.placeholder"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
            @input="setField(key, ($event.target as HTMLInputElement).value)"
          />
        </template>
      </div>

      <div v-if="error" class="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
        {{ error }}
      </div>
    </div>

    <div v-if="schema" class="shrink-0 flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
      <Button variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
      <Button size="sm" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </Button>
    </div>
    <div v-else class="shrink-0 flex justify-end px-4 py-3 border-t border-border">
      <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
    </div>
  </div>
</template>
