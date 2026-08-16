<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { StatusDotVariants } from '.'
import { cn } from '@/lib/utils'
import { statusDotVariants } from '.'

interface Props {
  variant?: StatusDotVariants['variant']
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <span :class="cn(statusDotVariants({ variant }), props.class)" aria-hidden="true" />
</template>
