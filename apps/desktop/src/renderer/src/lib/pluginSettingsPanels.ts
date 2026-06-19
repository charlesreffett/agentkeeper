import type { Component } from 'vue'
import GitHubSettingsPanel from '@/views/settings/GitHubSettingsPanel.vue'
import JiraSettingsPanel from '@/views/settings/JiraSettingsPanel.vue'
import McpSettingsPanel from '@/views/settings/McpSettingsPanel.vue'
import MobileSettingsPanel from '@/components/MobileSettingsPanel.vue'

export interface PluginSettingsPanel {
  id: string
  label: string
  component: Component
}

export const pluginSettingsPanels: PluginSettingsPanel[] = [
  { id: 'github', label: 'GitHub', component: GitHubSettingsPanel },
  { id: 'jira', label: 'Jira', component: JiraSettingsPanel },
  { id: 'mcp', label: 'MCP Servers', component: McpSettingsPanel },
  { id: 'mobile', label: 'Mobile', component: MobileSettingsPanel },
]
