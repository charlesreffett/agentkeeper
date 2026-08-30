import { z } from 'zod'
import type { Plugin, PluginContext } from '@agentkeeper/sdk'
import { checkCliPresent, countIssues, listProjects } from './jira-cli.js'
import { JiraWorkItemSource } from './jira-source.js'

export { listProjects }
export type { JiraProject } from './jira-cli'

const ProjectMappingSchema = z.object({
  jiraProjectKey: z.string(),
  projectPath: z.string(),
})

const JiraSettingsSchema = z
  .object({
    projectKey: z.string().optional(),
    projectMappings: z.array(ProjectMappingSchema).optional().default([]),
    projectKeys: z.array(z.string()).optional().default([]),
    cliPath: z.string().optional(),
  })
  .default({})

type JiraSettings = z.infer<typeof JiraSettingsSchema>

let cancelPolling: (() => void) | null = null
let pluginCtx: PluginContext<JiraSettings> | null = null
let activeSource: JiraWorkItemSource | null = null

async function startJira(ctx: PluginContext<JiraSettings>): Promise<void> {
  const projectKeys = ctx.config.projectKeys?.length
    ? ctx.config.projectKeys
    : (ctx.config.projectMappings ?? []).map(mapping => mapping.jiraProjectKey)
  const source = new JiraWorkItemSource(
    projectKeys,
    ctx.config.projectKey,
  )
  activeSource = source
  ctx.workItems.register(source)
  cancelPolling = ctx.background.every(5 * 60 * 1000, () => source.refresh())
  ctx.logger.info('jira plugin active')
}

const jiraPlugin: Plugin<JiraSettings> = {
  async activate(ctx: PluginContext<JiraSettings>) {
    pluginCtx = ctx
    ctx.commands.register({
      id: 'jira.workItems.list',
      label: 'List Jira work items',
      handler: () => activeSource?.list() ?? [],
    })
    ctx.commands.register({
      id: 'jira.settings.get',
      label: 'Get Jira project selection',
      handler: async () => ({
        projects: await listProjects(),
        selectedKeys: ctx.config.projectKeys?.length
          ? ctx.config.projectKeys
          : (ctx.config.projectMappings ?? []).map(mapping => mapping.jiraProjectKey),
      }),
    })
    ctx.commands.register({
      id: 'jira.settings.selectProjects',
      label: 'Select Jira projects',
      handler: async (args) => {
        const keys = (args as { keys?: unknown })?.keys
        if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new Error('Invalid project selection')
        const projectKeys = [...new Set(keys)] as string[]
        await ctx.storage.set('projectKeys', projectKeys)
        ctx.config.projectKeys = projectKeys
        cancelPolling?.()
        cancelPolling = null
        ctx.workItems.unregister('jira')
        await startJira(ctx)
        return { selectedKeys: projectKeys }
      },
    })
    ctx.commands.register({
      id: 'jira.workItems.get',
      label: 'Get Jira work item',
      handler: (args) => activeSource?.get(String((args as { itemId?: unknown })?.itemId ?? '')),
    })
    ctx.commands.register({
      id: 'jira.workItems.updateStatus',
      label: 'Update Jira work item status',
      handler: (args) => {
        const input = args as { itemId: string; status: Parameters<JiraWorkItemSource['updateStatus']>[1] }
        return activeSource?.updateStatus(input.itemId, input.status)
      },
    })
    ctx.commands.register({
      id: 'jira.projects.list',
      label: 'List Jira projects',
      handler: () => listProjects(),
    })
    ctx.commands.register({
      id: 'jira.boards.count',
      label: 'Count Jira board issues',
      handler: async (args) => {
        const keys = (args as { keys?: unknown })?.keys
        if (!Array.isArray(keys)) return {}
        const entries = await Promise.all(keys.map(async (key) => [String(key), await countIssues(String(key))] as const))
        return Object.fromEntries(entries.filter((entry): entry is [string, number] => entry[1] != null))
      },
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
    activeSource = null
    pluginCtx = null
  },
}

export default jiraPlugin
