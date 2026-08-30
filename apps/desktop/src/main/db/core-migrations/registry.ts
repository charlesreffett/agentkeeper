import baseline from './001_current_schema'
import pluginWorkItemBoundary from './002_plugin_work_item_boundary'
import type { Migration } from './Migration'

export const coreMigrations: readonly Migration[] = [
  baseline,
  pluginWorkItemBoundary,
]
