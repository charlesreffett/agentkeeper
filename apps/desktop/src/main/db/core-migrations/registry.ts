import baseline from './001_current_schema'
import pluginWorkItemBoundary from './002_plugin_work_item_boundary'
import pluginPermissionGrants from './003_plugin_permission_grants'
import type { Migration } from './Migration'

export const coreMigrations: readonly Migration[] = [
  baseline,
  pluginWorkItemBoundary,
  pluginPermissionGrants,
]
