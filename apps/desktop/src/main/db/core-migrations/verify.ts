import type { Schema } from './Schema'

const requiredSchema: Readonly<Record<string, readonly string[]>> = {
  projects: ['path', 'name', 'repo', 'last_opened_at', 'sort_order'],
  sessions: ['local_id', 'project_path', 'harness_id', 'initial_prompt', 'status', 'last_activity_at', 'last_user_message_at'],
  agents: ['local_id', 'session_local_id', 'sdk_session_id', 'is_entry_point', 'status'],
  agency_handoffs: ['id', 'agency_instance_id', 'role_id', 'instance_index', 'summary', 'created_at'],
  app_state: ['key', 'value'],
  cost_entries: ['key', 'input_tokens', 'output_tokens', 'cost_usd', 'recorded_at'],
  drafts: ['session_local_id', 'text', 'attachments', 'updated_at'],
  session_stats: ['session_local_id', 'agent_local_id', 'total_tokens', 'total_cost_usd'],
  model_pricing: ['model_id', 'input_per_m', 'output_per_m', 'source', 'updated_at'],
  plans: ['id', 'project_id', 'session_id', 'agency_id', 'agency_scope', 'status'],
  plan_steps: ['id', 'plan_id', 'position', 'status', 'parallel', 'requires_approval'],
  plugin_storage: ['plugin_id', 'key', 'value'],
  plugin_registry: ['id', 'name', 'version', 'enabled', 'manifest', 'source', 'dev_path'],
  jira_ticket_activity: ['id', 'ticket_ref', 'actor', 'message', 'created_at'],
}

export function verifyCurrentSchema(schema: Schema): void {
  for (const [table, columns] of Object.entries(requiredSchema)) {
    if (!schema.hasTable(table)) throw new Error(`Database schema is missing required table '${table}'`)
    for (const column of columns) {
      if (!schema.hasColumn(table, column)) {
        throw new Error(`Database schema is missing required column '${table}.${column}'`)
      }
    }
  }
}
