import baseline from './001_current_schema'
import type { Migration } from './Migration'

export const coreMigrations: readonly Migration[] = [
  baseline,
]
