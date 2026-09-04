import { defineMigration } from './Migration'

const checksumSource = `
sessions: replace work_item_key with provider-addressed work item columns
plans: add provider-addressed snapshot columns and clear ambiguous legacy work_item_id
drop jira_ticket_activity because provider persistence is not core-owned
`

export default defineMigration({
  id: 2,
  name: 'plugin-work-item-boundary',
  revision: 1,
  checksumSource,
  up(schema) {
    schema.alterTable('sessions', (table) => {
      table.text('work_item_source_id')
      table.text('work_item_id')
      table.text('work_item_external_ref')
      table.dropColumn('work_item_key')
    })

    schema.alterTable('plans', (table) => {
      table.text('work_item_source_id')
      table.text('work_item_external_ref')
      table.text('work_item_title')
    })

    // The old ID did not record its provider, so assigning it would be unsafe.
    schema.prepare('UPDATE plans SET work_item_id = NULL').run()
    schema.dropTableIfExists('jira_ticket_activity')
  },
})
