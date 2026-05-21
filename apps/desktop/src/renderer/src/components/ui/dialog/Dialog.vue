<script setup lang="ts">
import { provide } from 'vue'

const open = defineModel<boolean>('open', { required: true })
provide('dialogOpen', open)
</script>

<template>
  <slot />
</template>
