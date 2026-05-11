import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  localId: text('local_id').primaryKey(),
  sdkSessionId: text('sdk_session_id'),
  projectPath: text('project_path').notNull(),
  worktreePath: text('worktree_path'),
  branch: text('branch'),
  model: text('model'),
  effort: text('effort'),
  permissionMode: text('permission_mode'),
  initialPrompt: text('initial_prompt').notNull().default(''),
  roleName: text('role_name'),
  roleId: text('role_id'),
  agencyInstanceId: text('agency_instance_id'),
  agencyName: text('agency_name'),
  agencyId: text('agency_id'),
  agencyScope: text('agency_scope'),
  roleInstanceIndex: integer('role_instance_index'),
  title: text('title'),
  workItemKey: text('work_item_key'),
  workItemTitle: text('work_item_title'),
  status: text('status').notNull().default('idle'),
  startedAt: integer('started_at').notNull(),
  lastActivityAt: integer('last_activity_at').notNull(),
})

export const agencyHandoffs = sqliteTable('agency_handoffs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agencyInstanceId: text('agency_instance_id').notNull(),
  roleId: text('role_id').notNull(),
  instanceIndex: integer('instance_index').notNull(),
  summary: text('summary').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const costEntries = sqliteTable('cost_entries', {
  key: text('key').primaryKey(),
  date: text('date').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  inputCostUsd: real('input_cost_usd').notNull().default(0),
  outputCostUsd: real('output_cost_usd').notNull().default(0),
  cacheReadCostUsd: real('cache_read_cost_usd').notNull().default(0),
  cacheCreationCostUsd: real('cache_creation_cost_usd').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  recordedAt: text('recorded_at').notNull(),
})

export const projects = sqliteTable('projects', {
  path: text('path').primaryKey(),
  name: text('name').notNull(),
  repo: text('repo'),
  lastOpenedAt: integer('last_opened_at').notNull(),
})

export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const sessionStats = sqliteTable('session_stats', {
  sessionLocalId: text('session_local_id').primaryKey(),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  turnCount: integer('turn_count').notNull().default(0),
  inProgressTokens: integer('in_progress_tokens').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

export const modelPricing = sqliteTable('model_pricing', {
  modelId: text('model_id').primaryKey(),
  inputPerM: real('input_per_m').notNull(),
  outputPerM: real('output_per_m').notNull(),
  cacheWrite5mPerM: real('cache_write_5m_per_m').notNull(),
  cacheWrite1hPerM: real('cache_write_1h_per_m').notNull(),
  cacheReadPerM: real('cache_read_per_m').notNull(),
  source: text('source').notNull().default('bundled'),
  updatedAt: integer('updated_at').notNull(),
})

export const drafts = sqliteTable('drafts', {
  sessionLocalId: text('session_local_id').primaryKey(),
  text: text('text').notNull().default(''),
  attachments: text('attachments').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
})
