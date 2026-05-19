import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  localId: text('local_id').primaryKey(),
  projectPath: text('project_path').notNull(),
  worktreePath: text('worktree_path'),
  branch: text('branch'),
  model: text('model'),
  effort: text('effort'),
  permissionMode: text('permission_mode'),
  initialPrompt: text('initial_prompt').notNull().default(''),
  agencyName: text('agency_name'),
  agencyId: text('agency_id'),
  agencyScope: text('agency_scope'),
  title: text('title'),
  workItemKey: text('work_item_key'),
  workItemTitle: text('work_item_title'),
  planState: text('plan_state'),
  status: text('status').notNull().default('idle'),
  startedAt: integer('started_at').notNull(),
  lastActivityAt: integer('last_activity_at').notNull(),
})

export const agents = sqliteTable('agents', {
  localId: text('local_id').primaryKey(),
  sessionLocalId: text('session_local_id').notNull().references(() => sessions.localId, { onDelete: 'cascade' }),
  sdkSessionId: text('sdk_session_id'),
  roleId: text('role_id'),
  roleName: text('role_name'),
  roleInstanceIndex: integer('role_instance_index'),
  initialPrompt: text('initial_prompt').notNull().default(''),
  isEntryPoint: integer('is_entry_point').notNull().default(0),
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
  agentLocalId: text('agent_local_id'),
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

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.path, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => sessions.localId, { onDelete: 'set null' }),
  workItemId: text('work_item_id'),
  planRef: text('plan_ref'),
  title: text('title').notNull(),
  prompt: text('prompt'),
  status: text('status').notNull().default('planned'),
  planningModel: text('planning_model'),
  estimatedMinutes: integer('estimated_minutes').notNull().default(0),
  agencyId: text('agency_id'),
  agencyScope: text('agency_scope'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
})

export const planSteps = sqliteTable('plan_steps', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  instructions: text('instructions'),
  filesInScope: text('files_in_scope').notNull().default('[]'),
  model: text('model').notNull(),
  agent: text('agent').notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull().default(0),
  actualMinutes: integer('actual_minutes'),
  status: text('status').notNull().default('pending'),
  parallel: integer('parallel').notNull().default(0),
  requiresApproval: integer('requires_approval').notNull().default(0),
  context: text('context'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  failedAt: integer('failed_at'),
})
