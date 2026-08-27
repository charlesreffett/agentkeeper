export type SettingsSectionGroup = 'Settings' | 'Integrations' | 'System'

export interface SettingsSection {
  path: string
  label: string
  icon: string
  group: SettingsSectionGroup
}

export const settingsSections: readonly SettingsSection[] = [
  { path: '/settings/general', label: 'General', icon: 'Settings2', group: 'Settings' },
  { path: '/settings/models', label: 'Models & Harnesses', icon: 'Bot', group: 'Settings' },
  { path: '/settings/appearance', label: 'Appearance', icon: 'Palette', group: 'Settings' },
  { path: '/settings/plugins', label: 'Plugins', icon: 'Puzzle', group: 'Settings' },
  { path: '/settings/remote', label: 'Remote', icon: 'Radio', group: 'Settings' },
  { path: '/settings/github', label: 'GitHub', icon: 'GitPullRequest', group: 'Integrations' },
  { path: '/settings/jira', label: 'Jira', icon: 'Layers', group: 'Integrations' },
  { path: '/settings/mcp', label: 'MCP Servers', icon: 'Plug', group: 'Integrations' },
  { path: '/settings/updates', label: 'Updates', icon: 'Download', group: 'System' },
  { path: '/settings/data', label: 'Data & Reset', icon: 'RotateCcw', group: 'System' },
]

export const settingsGroups: readonly SettingsSectionGroup[] = ['Settings', 'Integrations', 'System']
