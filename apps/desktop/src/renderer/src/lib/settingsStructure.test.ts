import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')

describe('Settings navigation structure', () => {
  it('removes the Settings trigger from the header', () => {
    const header = source('components/AppHeader.vue')
    expect(header).not.toContain("router.push('/settings')")
    expect(header).not.toContain('Settings action menu')
  })

  it('anchors an icon-and-label Settings item in the main sidebar footer', () => {
    const sidebar = source('components/Sidebar.vue')
    expect(sidebar).toContain('<Sidebar collapsible="icon" class="!h-full">')
    expect(sidebar).toContain('<SidebarFooter')
    expect(sidebar).toContain('<Settings2 class="size-5"')
    expect(sidebar).toContain('<span>Settings</span>')
    expect(sidebar).toContain('aria-label="Settings"')
  })

  it('swaps app navigation for Settings navigation and preserves hidden panel state', () => {
    const layout = source('components/AppLayout.vue')
    expect(layout).toContain('<SettingsSidebar v-if="isSettings"')
    expect(layout).toContain('<Sidebar v-else')
    expect(layout).toContain('layoutStore.rightPanelOpen && !isSettings')
    expect(layout).toContain('terminalStore.isOpen && !isSettings')
  })

  it('provides keyboard-native labelled Back and section controls', () => {
    const sidebar = source('components/SettingsSidebar.vue')
    expect(sidebar).toContain('aria-label="Back from Settings"')
    expect(sidebar).toContain(':aria-current=')
    expect(sidebar).toContain('closeMobile()')
  })

  it('retains the responsive off-canvas sidebar implementation', () => {
    const sidebarPrimitive = source('components/ui/sidebar/Sidebar.vue')
    expect(sidebarPrimitive).toContain('v-else-if="isMobile"')
    expect(sidebarPrimitive).toContain('<SheetContent')
  })

  it('reuses the session effort picker in Models & Harnesses settings', () => {
    const session = source('views/LiveSessionView.vue')
    const settings = source('views/settings/ModelsSettingsView.vue')
    expect(session).toContain("import EffortPicker from '@/components/EffortPicker.vue'")
    expect(settings).toContain("import EffortPicker from '@/components/EffortPicker.vue'")
    expect(session).toContain('<EffortPicker')
    expect(settings).toContain('<EffortPicker')
  })

  it('exposes a per-harness binary path override', () => {
    const settings = source('views/settings/ModelsSettingsView.vue')
    expect(settings).toContain('binaryPathFor(harness.id)')
    expect(settings).toContain('setBinaryPath(harness.id')
    expect(settings).toContain('Binary executable')
    expect(settings).toContain('harnessBins')
  })

  it('keeps the light sidebar active surface distinct from its background', () => {
    const styles = source('style.css')
    const lightTheme = styles.slice(styles.indexOf(':root'), styles.indexOf('.dark'))
    expect(lightTheme).toContain('--sidebar-background: oklch(0.976 0.005 95)')
    expect(lightTheme).toContain('--sidebar-accent: oklch(0.925 0.009 81)')
  })
})
