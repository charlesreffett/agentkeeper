import { z } from 'zod'
import type { Plugin, PluginContext } from '@agentkeeper/sdk'
import {
  addComment,
  checkCliPresent,
  createPR,
  getPR,
  getPRChecks,
  getPRComments,
  getPRDiff,
  listPRs,
  mergePR,
  submitReview,
} from './github-cli.js'
import { GitHubWorkItemSource } from './github-source.js'

const GitHubSettingsSchema = z
  .object({
    repo: z.string().optional(),
  })
  .default({})

type GitHubSettings = z.infer<typeof GitHubSettingsSchema>

let cancelPolling: (() => void) | null = null
let pluginCtx: PluginContext<GitHubSettings> | null = null
let activeSource: GitHubWorkItemSource | null = null

async function startGitHub(ctx: PluginContext<GitHubSettings>): Promise<void> {
  if (!ctx.config.repo) {
    ctx.logger.info('github plugin active (no repo configured, work items disabled)')
    return
  }
  const source = new GitHubWorkItemSource(ctx.config.repo)
  activeSource = source
  ctx.workItems.register(source)
  cancelPolling = ctx.background.every(5 * 60 * 1000, () => source.refresh())
  ctx.logger.info(`github plugin active (repo: ${ctx.config.repo})`)
}

const githubPlugin: Plugin<GitHubSettings> = {
  async activate(ctx: PluginContext<GitHubSettings>) {
    pluginCtx = ctx
    const configuredRepo = () => ctx.config.repo ?? ''
    ctx.commands.register({
      id: 'github.pulls.list',
      label: 'List GitHub pull requests',
      handler: (args) => {
        const input = (args ?? {}) as Parameters<typeof listPRs>[1] & { repo?: string }
        return listPRs(input.repo || configuredRepo(), input)
      },
    })
    ctx.commands.register({
      id: 'github.pulls.get',
      label: 'Get GitHub pull request',
      handler: (args) => {
        const input = args as { repo?: string; number: number }
        return getPR(input.repo || configuredRepo(), input.number)
      },
    })
    ctx.commands.register({ id: 'github.pulls.diff', label: 'Get GitHub pull request diff', handler: (args) => {
      const input = args as { repo?: string; number: number }; return getPRDiff(input.repo || configuredRepo(), input.number)
    } })
    ctx.commands.register({ id: 'github.pulls.checks', label: 'Get GitHub pull request checks', handler: (args) => {
      const input = args as { repo?: string; number: number }; return getPRChecks(input.repo || configuredRepo(), input.number)
    } })
    ctx.commands.register({ id: 'github.pulls.comments', label: 'Get GitHub pull request comments', handler: (args) => {
      const input = args as { repo?: string; number: number }; return getPRComments(input.repo || configuredRepo(), input.number)
    } })
    ctx.commands.register({ id: 'github.pulls.comment', label: 'Comment on GitHub pull request', handler: (args) => {
      const input = args as { repo?: string; number: number; body: string }; return addComment(input.repo || configuredRepo(), input.number, input.body)
    } })
    ctx.commands.register({ id: 'github.pulls.review', label: 'Review GitHub pull request', handler: (args) => {
      const input = args as Parameters<typeof submitReview> extends [string, number, infer E, string] ? { repo?: string; number: number; event: E; body: string } : never
      return submitReview(input.repo || configuredRepo(), input.number, input.event, input.body)
    } })
    ctx.commands.register({ id: 'github.pulls.merge', label: 'Merge GitHub pull request', handler: (args) => {
      const input = args as Parameters<typeof mergePR> extends [string, number, infer M] ? { repo?: string; number: number; method: M } : never
      return mergePR(input.repo || configuredRepo(), input.number, input.method)
    } })
    ctx.commands.register({ id: 'github.pulls.create', label: 'Create GitHub pull request', handler: (args) => {
      const input = args as Parameters<typeof createPR>[1] & { repo?: string }
      return createPR(input.repo || configuredRepo(), input)
    } })
    ctx.commands.register({ id: 'github.workItems.get', label: 'Get GitHub issue', handler: (args) =>
      activeSource?.get(String((args as { itemId?: unknown })?.itemId ?? '')) })
    const cliFound = await checkCliPresent()

    if (!cliFound) {
      ctx.logger.warn('gh CLI not found, retrying every 15s')
      ctx.events.emit('plugin.unhealthy', { pluginId: 'github', reason: 'cli_missing' })

      cancelPolling = ctx.background.every(15_000, async () => {
        if (await checkCliPresent()) {
          cancelPolling?.()
          cancelPolling = null
          await startGitHub(ctx)
          ctx.events.emit('plugin.healthy', { pluginId: 'github' })
        }
      })
      return
    }

    await startGitHub(ctx)

    ctx.events.on('settings.changed', async ({ pluginId, config }) => {
      if (pluginId !== 'github') return
      cancelPolling?.()
      cancelPolling = null
      ctx.workItems.unregister('github')
      await startGitHub({ ...ctx, config: config as GitHubSettings })
    })
  },

  async deactivate() {
    cancelPolling?.()
    cancelPolling = null
    pluginCtx?.workItems.unregister('github')
    activeSource = null
    pluginCtx = null
  },
}

export default githubPlugin
