import { z } from 'zod'
import type { Plugin, PluginContext } from '@agentkeeper/sdk'
import { checkCliPresent } from './jira-cli'
import { JiraWorkItemSource } from './jira-source'

const JiraSettingsSchema = z
  .object({
    projectKey: z.string().optional(),
    cliPath: z.string().optional(),
  })
  .default({})

type JiraSettings = z.infer<typeof JiraSettingsSchema>

let cancelPolling: (() => void) | null = null
let pluginCtx: PluginContext<JiraSettings> | null = null

async function startJira(ctx: PluginContext<JiraSettings>): Promise<void> {
  const source = new JiraWorkItemSource(ctx.config.projectKey)
  ctx.workItems.register(source)
  cancelPolling = ctx.background.every(5 * 60 * 1000, () => source.refresh())
  ctx.logger.info('jira plugin active')
}

export const jiraPlugin: Plugin<JiraSettings> = {
  id: 'jira',
  name: 'Jira',
  version: '0.1.0',
  settings: JiraSettingsSchema,

  async activate(ctx: PluginContext<JiraSettings>) {
    pluginCtx = ctx
    ctx.ui.contribute('sidebar.primary', {
      id: 'jira',
      label: 'Jira',
      icon: 'Layers',
      order: 10,
      component: null,
    })
    const cliFound = await checkCliPresent()

    if (!cliFound) {
      ctx.logger.warn('jira CLI not found, retrying every 15s')
      ctx.events.emit('plugin.unhealthy', { pluginId: 'jira', reason: 'cli_missing' })

      cancelPolling = ctx.background.every(15_000, async () => {
        if (await checkCliPresent()) {
          cancelPolling?.()
          cancelPolling = null
          await startJira(ctx)
          ctx.events.emit('plugin.healthy', { pluginId: 'jira' })
        }
      })
      return
    }

    await startJira(ctx)

    ctx.events.on('settings.changed', async ({ pluginId, config }) => {
      if (pluginId !== 'jira') return
      cancelPolling?.()
      cancelPolling = null
      ctx.workItems.unregister('jira')
      await startJira({ ...ctx, config: config as JiraSettings })
    })
  },

  async deactivate() {
    cancelPolling?.()
    cancelPolling = null
    pluginCtx?.workItems.unregister('jira')
    pluginCtx = null
  },
}
