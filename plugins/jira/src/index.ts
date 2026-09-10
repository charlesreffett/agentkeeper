import { z } from 'zod'
import type { Plugin, PluginContext } from '@agentkeeper/sdk'
import { checkConnection, configureJiraApi, countIssues, jiraCredentialsPresent, listProjects, testConnectionWith } from './jira-cli.js'
import { JiraWorkItemProvider } from './jira-provider.js'

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
    email: z.string().optional(),
    instanceUrl: z.string().optional(),
  })
  .default({})

type JiraSettings = z.infer<typeof JiraSettingsSchema>

let cancelPolling: (() => void) | null = null
let pluginCtx: PluginContext<JiraSettings> | null = null
let activeSource: JiraWorkItemProvider | null = null

async function startJira(ctx: PluginContext<JiraSettings>): Promise<void> {
  const projectKeys = ctx.config.projectKeys?.length
    ? ctx.config.projectKeys
    : (ctx.config.projectMappings ?? []).map(mapping => mapping.jiraProjectKey)
  const source = new JiraWorkItemProvider(
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
    configureJiraApi({ fetch: ctx.fetch, email: ctx.config.email, instanceUrl: ctx.config.instanceUrl, apiToken: await ctx.secrets.get('apiToken') })
    ctx.commands.register({
      id: 'jira.workItems.list',
      label: 'List Jira work items',
      handler: () => activeSource?.list() ?? [],
    })
    ctx.commands.register({
      id: 'jira.settings.get',
      label: 'Get Jira project selection',
      handler: async () => {
        const storedApiToken = await ctx.secrets.get('apiToken')
        let projects: Awaited<ReturnType<typeof listProjects>> = []
        let projectError = ''
        try {
          projects = await listProjects()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          projectError = /API token|Jira site URL|email/i.test(message)
            ? 'Jira authentication failed. Check the site URL, email, and API token below.'
            : 'Jira could not list projects. Check the connection settings.'
        }
        return {
          projects,
          projectError,
          agentProjects: (await ctx.projects.list()).map(project => ({ path: project.path, name: project.name })),
          selectedKeys: ctx.config.projectKeys?.length
            ? ctx.config.projectKeys
            : (ctx.config.projectMappings ?? []).map(mapping => mapping.jiraProjectKey),
          projectMappings: ctx.config.projectMappings ?? [],
          email: ctx.config.email ?? '',
          instanceUrl: ctx.config.instanceUrl ?? '',
          apiTokenSource: storedApiToken ? 'keychain' : 'none',
        }
      },
    })
    ctx.commands.register({
      id: 'jira.settings.selectProjects',
      label: 'Select Jira projects',
      handler: async (args) => {
        const input = args as { keys?: unknown; projectMappings?: unknown }
        const keys = input?.keys
        if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new Error('Invalid project selection')
        const projectKeys = [...new Set(keys)] as string[]
        const projectMappings = ProjectMappingSchema.array().parse(input.projectMappings ?? [])
        const knownPaths = new Set((await ctx.projects.list()).map(project => project.path))
        if (projectMappings.some(mapping => !projectKeys.includes(mapping.jiraProjectKey) || !knownPaths.has(mapping.projectPath))) throw new Error('Invalid AgentKeeper project mapping')
        await ctx.storage.set('projectKeys', projectKeys)
        await ctx.storage.set('projectMappings', projectMappings)
        ctx.config.projectKeys = projectKeys
        ctx.config.projectMappings = projectMappings
        cancelPolling?.()
        cancelPolling = null
        ctx.workItems.unregister('jira')
        await startJira(ctx)
        return { selectedKeys: projectKeys }
      },
    })
    ctx.commands.register({
      id: 'jira.settings.testConnection',
      label: 'Test Jira connection',
      handler: async (args) => {
        const input = (args ?? {}) as { email?: unknown; instanceUrl?: unknown; apiToken?: unknown }
        const email = typeof input.email === 'string' ? input.email.trim() : ctx.config.email?.trim() ?? ''
        const instanceUrl = typeof input.instanceUrl === 'string'
          ? input.instanceUrl.trim().replace(/\/+$/, '')
          : ctx.config.instanceUrl?.trim().replace(/\/+$/, '') ?? ''
        const apiToken = typeof input.apiToken === 'string' && input.apiToken.trim()
          ? input.apiToken.trim()
          : await ctx.secrets.get('apiToken') ?? ''
        if (!email || !/^https:\/\/[^/]+$/.test(instanceUrl) || !apiToken) {
          throw new Error('Enter a valid Jira site URL, account email, and API token.')
        }
        return testConnectionWith({ fetch: ctx.fetch, email, instanceUrl, apiToken })
      },
    })
    ctx.commands.register({
      id: 'jira.settings.saveConnection',
      label: 'Save Jira connection',
      handler: async (args) => {
        const input = (args ?? {}) as { email?: unknown; instanceUrl?: unknown; apiToken?: unknown }
        const email = typeof input.email === 'string' ? input.email.trim() : ''
        const instanceUrl = typeof input.instanceUrl === 'string' ? input.instanceUrl.trim().replace(/\/+$/, '') : ''
        const enteredToken = typeof input.apiToken === 'string' ? input.apiToken.trim() : ''
        const apiToken = enteredToken || (await ctx.secrets.get('apiToken') ?? '')
        if (!email || !/^https:\/\/[^/]+$/.test(instanceUrl) || !apiToken) {
          throw new Error('Enter a valid Jira site URL, account email, and API token.')
        }
        await ctx.storage.set('email', email)
        await ctx.storage.set('instanceUrl', instanceUrl)
        if (enteredToken) await ctx.secrets.set('apiToken', enteredToken)
        ctx.config.email = email
        ctx.config.instanceUrl = instanceUrl
        configureJiraApi({ fetch: ctx.fetch, email, instanceUrl, apiToken })
        cancelPolling?.()
        cancelPolling = null
        ctx.workItems.unregister('jira')
        await startJira(ctx)
        ctx.events.emit('plugin.healthy', { pluginId: 'jira' })
        return { saved: true }
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
        const input = args as { itemId: string; status: Parameters<JiraWorkItemProvider['updateStatus']>[1] }
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
    if (!jiraCredentialsPresent() || !await checkConnection()) {
      ctx.logger.warn('Jira credentials are missing or invalid')
      ctx.events.emit('plugin.unhealthy', { pluginId: 'jira', reason: 'auth' })
      return
    }

    await startJira(ctx)

    ctx.events.on('settings.changed', async ({ pluginId, config }) => {
      if (pluginId !== 'jira') return
      const next = config as JiraSettings
      configureJiraApi({ fetch: ctx.fetch, email: next.email, instanceUrl: next.instanceUrl, apiToken: await ctx.secrets.get('apiToken') })
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
