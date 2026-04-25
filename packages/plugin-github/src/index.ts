import { z } from 'zod'
import type { Plugin, PluginContext } from '@orchestral/sdk'
import { checkCliPresent } from './github-cli.js'
import { GitHubWorkItemSource } from './github-source.js'

const GitHubSettingsSchema = z
  .object({
    repo: z.string().optional(),
  })
  .default({})

type GitHubSettings = z.infer<typeof GitHubSettingsSchema>

let cancelPolling: (() => void) | null = null
let pluginCtx: PluginContext<GitHubSettings> | null = null

async function startGitHub(ctx: PluginContext<GitHubSettings>): Promise<void> {
  if (!ctx.config.repo) {
    ctx.logger.info('github plugin active (no repo configured, work items disabled)')
    return
  }
  const source = new GitHubWorkItemSource(ctx.config.repo)
  ctx.workItems.register(source)
  cancelPolling = ctx.background.every(5 * 60 * 1000, () => source.refresh())
  ctx.logger.info(`github plugin active (repo: ${ctx.config.repo})`)
}

export const githubPlugin: Plugin<GitHubSettings> = {
  id: 'github',
  name: 'GitHub',
  version: '0.1.0',
  settings: GitHubSettingsSchema,

  async activate(ctx: PluginContext<GitHubSettings>) {
    pluginCtx = ctx
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
    pluginCtx = null
  },
}
