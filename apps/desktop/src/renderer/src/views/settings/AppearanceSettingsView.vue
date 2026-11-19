<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import ColorField from '@/components/settings/ColorField.vue'
import ThemePreview from '@/components/settings/ThemePreview.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLayoutStore } from '@/stores/layout'
import {
  CODE_FONT_SIZE,
  DEFAULT_THEMES,
  UI_FONT_SIZE,
  decodeTheme,
  encodeTheme,
  type ThemeConfig,
  type ThemeVariant,
} from '@shared/theme'
import { applyPreset, matchPreset, presetsFor } from '@shared/themePresets'

const layoutStore = useLayoutStore()
const schemes = [
  { value: 'system' as const, label: 'System', icon: Monitor },
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
]

// Start on whichever slot is on screen so edits are visible immediately.
const editing = ref<ThemeVariant>(layoutStore.resolvedTheme)
watch(() => layoutStore.resolvedTheme, v => { editing.value = v })

const config = computed(() => layoutStore.themes[editing.value])
const presets = computed(() => presetsFor(editing.value))
const presetId = computed(() => matchPreset(config.value, editing.value) ?? 'custom')

function update(patch: Partial<ThemeConfig>) {
  layoutStore.setThemeConfig(editing.value, { ...config.value, ...patch })
}

function selectPreset(id: string) {
  layoutStore.setThemeConfig(editing.value, applyPreset(config.value, id, editing.value))
}

function updateFont(kind: 'ui' | 'code', value: string) {
  update({ fonts: { ...config.value.fonts, [kind]: value.trim() || null } })
}

function reset() {
  layoutStore.setThemeConfig(editing.value, structuredClone(DEFAULT_THEMES[editing.value]))
}

async function copyTheme() {
  try {
    await navigator.clipboard.writeText(encodeTheme(config.value, editing.value))
    toast.success(`${editing.value === 'light' ? 'Light' : 'Dark'} theme copied`)
  } catch {
    toast.error('Could not copy to the clipboard')
  }
}

const importing = ref(false)
const importText = ref('')
function applyImport() {
  const decoded = decodeTheme(importText.value)
  if (!decoded) {
    toast.error('Not an AgentKeeper theme', { description: 'Theme strings start with agentkeeper-theme-v1:' })
    return
  }
  layoutStore.setThemeConfig(editing.value, decoded.theme)
  if (decoded.variant !== editing.value) {
    toast.message(`Imported a ${decoded.variant} theme into the ${editing.value} slot`)
  }
  importing.value = false
  importText.value = ''
}

const range = (r: { min: number; max: number }) => Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i)
const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const textClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64'
</script>

<template>
  <SettingsPage title="Appearance" description="Choose how AgentKeeper looks on this device." content-class="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
    <section aria-labelledby="color-scheme-heading" class="space-y-3">
      <h2 id="color-scheme-heading" class="text-sm font-semibold">Color scheme</h2>
      <div class="inline-flex rounded-lg border bg-muted/50 p-1" role="radiogroup" aria-label="Color scheme">
        <button
          v-for="option in schemes"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="layoutStore.theme === option.value"
          class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          :class="layoutStore.theme === option.value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="void layoutStore.setTheme(option.value)"
        >
          <component :is="option.icon" class="size-4" aria-hidden="true" />
          {{ option.label }}
        </button>
      </div>
    </section>

    <section aria-labelledby="theme-heading" class="space-y-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="theme-heading" class="text-sm font-semibold">Theme</h2>
          <p class="mt-1 text-xs text-muted-foreground">Light and dark each keep their own theme. System switches between them.</p>
        </div>
        <Tabs v-model="editing">
          <TabsList>
            <TabsTrigger value="light">Light theme</TabsTrigger>
            <TabsTrigger value="dark">Dark theme</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div class="divide-y rounded-lg border">
          <label class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1 text-sm font-medium">Preset</span>
            <select :value="presetId" :class="selectClass" class="w-40" @change="selectPreset(($event.target as HTMLSelectElement).value)">
              <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
              <option value="custom" disabled>Custom</option>
            </select>
          </label>
          <div class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Accent</span><span class="mt-0.5 block text-xs text-muted-foreground">Focus rings, primary actions, and highlights.</span></span>
            <ColorField :model-value="config.accent" label="Accent" @update:model-value="update({ accent: $event })" />
          </div>
          <div class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Background</span><span class="mt-0.5 block text-xs text-muted-foreground">Surfaces, sidebar, and borders are derived from this.</span></span>
            <ColorField :model-value="config.background" label="Background" @update:model-value="update({ background: $event })" />
          </div>
          <div class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1 text-sm font-medium">Foreground</span>
            <ColorField :model-value="config.foreground" label="Foreground" @update:model-value="update({ foreground: $event })" />
          </div>
          <label class="flex items-center gap-4 px-4 py-3">
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Contrast</span><span class="mt-0.5 block text-xs text-muted-foreground">How strongly surfaces and secondary text separate from the background.</span></span>
            <input
              type="range" min="0" max="100" step="1"
              class="w-36 accent-[var(--brand)]"
              :value="config.contrast"
              @input="update({ contrast: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="w-8 text-right text-xs tabular-nums text-muted-foreground">{{ config.contrast }}</span>
          </label>
          <label class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <span class="min-w-0 flex-1 text-sm font-medium">UI font</span>
            <input :value="config.fonts.ui ?? ''" placeholder="Default (Inter)" spellcheck="false" :class="textClass" @change="updateFont('ui', ($event.target as HTMLInputElement).value)" />
          </label>
          <label class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <span class="min-w-0 flex-1 text-sm font-medium">Code font</span>
            <input :value="config.fonts.code ?? ''" placeholder="Default (system monospace)" spellcheck="false" :class="textClass" class="font-mono" @change="updateFont('code', ($event.target as HTMLInputElement).value)" />
          </label>
        </div>

        <div class="space-y-3">
          <ThemePreview :config="config" :variant="editing" :code-font-size="layoutStore.codeFontSize" />
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" @click="importing = !importing">Import</Button>
            <Button size="sm" variant="outline" @click="copyTheme">Copy theme</Button>
            <Button size="sm" variant="ghost" class="ml-auto" :disabled="presetId === 'agentkeeper' && !config.fonts.ui && !config.fonts.code" @click="reset">Reset</Button>
          </div>
          <form v-if="importing" class="flex gap-2" @submit.prevent="applyImport">
            <input
              v-model="importText"
              aria-label="Theme string"
              placeholder="agentkeeper-theme-v1:…"
              spellcheck="false"
              class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" type="submit" :disabled="!importText.trim()">Apply</Button>
          </form>
        </div>
      </div>
    </section>

    <section aria-labelledby="text-size-heading" class="space-y-3">
      <h2 id="text-size-heading" class="text-sm font-semibold">Text size</h2>
      <div class="divide-y rounded-lg border">
        <label class="flex items-center gap-4 px-4 py-3">
          <span class="min-w-0 flex-1"><span class="block text-sm font-medium">UI font size</span><span class="mt-0.5 block text-xs text-muted-foreground">Scales the whole interface. Default {{ UI_FONT_SIZE.default }}px.</span></span>
          <select :value="layoutStore.uiFontSize" :class="selectClass" class="w-24" @change="void layoutStore.setFontSizes({ uiFontSize: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="size in range(UI_FONT_SIZE)" :key="size" :value="size">{{ size }}px</option>
          </select>
        </label>
        <label class="flex items-center gap-4 px-4 py-3">
          <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Code font size</span><span class="mt-0.5 block text-xs text-muted-foreground">Code blocks and the terminal. Default {{ CODE_FONT_SIZE.default }}px.</span></span>
          <select :value="layoutStore.codeFontSize" :class="selectClass" class="w-24" @change="void layoutStore.setFontSizes({ codeFontSize: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="size in range(CODE_FONT_SIZE)" :key="size" :value="size">{{ size }}px</option>
          </select>
        </label>
      </div>
    </section>
  </SettingsPage>
</template>
