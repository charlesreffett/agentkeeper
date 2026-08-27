<script setup lang="ts">
import SettingsPage from '@/components/settings/SettingsPage.vue'
import PluginsView from '@/views/plugins/PluginsView.vue'
</script>
<template>
  <SettingsPage
    title="Plugins"
    description="Install and manage capabilities that extend AgentKeeper."
    content-class="h-full min-h-0"
  >
    <PluginsView embedded />
  </SettingsPage>
</template>
