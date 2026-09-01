import { z } from 'zod'
import type { Plugin, PluginContext } from '@agentkeeper/sdk'
import { checkCliPresent, countIssues, listProjects, setJiraCliPath } from './jira-cli.js'
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
    setJiraCliPath(ctx.config.cliPath)
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
        agentProjects: (await ctx.projects.list()).map(project => ({ path: project.path, name: project.name })),
        selectedKeys: ctx.config.projectKeys?.length
          ? ctx.config.projectKeys
          : (ctx.config.projectMappings ?? []).map(mapping => mapping.jiraProjectKey),
        projectMappings: ctx.config.projectMappings ?? [],
        cliPath: ctx.config.cliPath ?? '',
      }),
    })
    ctx.commands.register({
      id: 'jira.settings.selectProjects',
      label: 'Select Jira projects',
      handler: async (args) => {
        const input = args as { keys?: unknown; cliPath?: unknown; projectMappings?: unknown }
        const keys = input?.keys
        if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new Error('Invalid project selection')
        const projectKeys = [...new Set(keys)] as string[]
        const cliPath = typeof input.cliPath === 'string' ? input.cliPath.trim() : ctx.config.cliPath ?? ''
        const projectMappings = ProjectMappingSchema.array().parse(input.projectMappings ?? [])
        const knownPaths = new Set((await ctx.projects.list()).map(project => project.path))
        if (projectMappings.some(mapping => !projectKeys.includes(mapping.jiraProjectKey) || !knownPaths.has(mapping.projectPath))) throw new Error('Invalid AgentKeeper project mapping')
        await ctx.storage.set('projectKeys', projectKeys)
        await ctx.storage.set('cliPath', cliPath)
        await ctx.storage.set('projectMappings', projectMappings)
        ctx.config.projectKeys = projectKeys
        ctx.config.cliPath = cliPath
        ctx.config.projectMappings = projectMappings
        setJiraCliPath(cliPath)
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
      id: 'jira.workItems.getTransitions',
      label: 'Get Jira work item transitions',
      handler: (args) => activeSource?.getTransitions(String((args as { itemId?: unknown })?.itemId ?? '')) ?? [],
    })
    ctx.commands.register({
      id: 'jira.workItems.transition',
      label: 'Transition Jira work item',
      handler: async (args) => {
        const input = args as { itemId?: unknown; name?: unknown }
        if (typeof input.itemId !== 'string' || typeof input.name !== 'string') throw new Error('Invalid Jira transition')
        await activeSource?.transition(input.itemId, input.name)
        await activeSource?.refresh()
      },
    })
    ctx.commands.register({
      id: 'jira.workItems.addComment',
      label: 'Comment on Jira work item',
      handler: (args) => {
        const input = args as { itemId?: unknown; body?: unknown }
        if (typeof input.itemId !== 'string' || typeof input.body !== 'string' || !input.body.trim()) throw new Error('Invalid Jira comment')
        return activeSource?.addComment(input.itemId, input.body.trim())
      },
    })
    ctx.commands.register({
      id: 'jira.workItems.create',
      label: 'Create Jira work item',
      handler: (args) => {
        const input = args as { projectKey?: unknown; summary?: unknown; description?: unknown; issueType?: unknown; priority?: unknown }
        if (typeof input.projectKey !== 'string' || typeof input.summary !== 'string' || !input.summary.trim()) throw new Error('Project and summary are required')
        const configured = ctx.config.projectKeys?.length ? ctx.config.projectKeys : (ctx.config.projectMappings ?? []).map(mapping => mapping.jiraProjectKey)
        if (configured.length && !configured.includes(input.projectKey)) throw new Error('Select a configured Jira project')
        return activeSource?.createForProject(input.projectKey, {
          summary: input.summary.trim(),
          description: typeof input.description === 'string' ? input.description.trim() || undefined : undefined,
          issueType: typeof input.issueType === 'string' ? input.issueType : undefined,
          priority: typeof input.priority === 'string' ? input.priority : undefined,
        })
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
      setJiraCliPath((config as JiraSettings).cliPath)
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
