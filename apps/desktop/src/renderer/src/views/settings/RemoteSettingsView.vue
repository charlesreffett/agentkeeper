<script setup lang="ts">
import SettingsPage from '@/components/settings/SettingsPage.vue'
import MobileSettingsPanel from '@/components/MobileSettingsPanel.vue'
</script>

<template>
  <SettingsPage title="Remote" description="Connect companion devices to this AgentKeeper host.">
    <MobileSettingsPanel />
  </SettingsPage>
</template>
