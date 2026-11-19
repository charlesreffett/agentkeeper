import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as StatusDot } from './StatusDot.vue'

export const statusDotVariants = cva('size-1.5 shrink-0 rounded-full', {
  variants: {
    variant: {
      running: 'bg-success animate-pulse',
      idle: 'bg-muted-foreground',
      suspended: 'bg-warning',
      blocked: 'bg-info',
      error: 'bg-destructive',
    },
  },
  defaultVariants: {
    variant: 'idle',
  },
})

export type StatusDotVariants = VariantProps<typeof statusDotVariants>
