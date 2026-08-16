import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as StatusDot } from './StatusDot.vue'

export const statusDotVariants = cva('size-1.5 shrink-0 rounded-full', {
  variants: {
    variant: {
      running: 'bg-emerald-500 animate-pulse',
      idle: 'bg-muted-foreground',
      suspended: 'bg-amber-500',
      blocked: 'bg-blue-500',
      error: 'bg-destructive',
    },
  },
  defaultVariants: {
    variant: 'idle',
  },
})

export type StatusDotVariants = VariantProps<typeof statusDotVariants>
