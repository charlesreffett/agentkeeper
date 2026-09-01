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

type GitHubProject = { projectPath: string; projectName: string; repo: string }

let cancelPolling: (() => void) | null = null
let pluginCtx: PluginContext | null = null
let activeSource: GitHubWorkItemSource | null = null
let knownRepos = new Set<string>()

async function listGitHubProjects(ctx: PluginContext): Promise<GitHubProject[]> {
  const projects = await ctx.projects.list()
  const entries = projects.flatMap((project) => project.remotes
    .filter((remote) => remote.provider === 'github' && remote.repository)
    .map((remote) => ({ projectPath: project.path, projectName: project.name, repo: remote.repository! })))
  const unique = entries.filter((entry, index) => entries.findIndex((candidate) => candidate.repo === entry.repo) === index)
  knownRepos = new Set(unique.map((entry) => entry.repo))
  return unique
}

async function restartWorkItems(ctx: PluginContext): Promise<void> {
  cancelPolling?.()
  cancelPolling = null
  ctx.workItems.unregister('github')
  const repos = (await listGitHubProjects(ctx)).map((project) => project.repo)
  if (!repos.length) {
    activeSource = null
    ctx.logger.info('github plugin active (no GitHub projects registered)')
    return
  }
  const source = new GitHubWorkItemSource(repos)
  activeSource = source
  ctx.workItems.register(source)
  cancelPolling = ctx.background.every(5 * 60 * 1000, () => source.refresh())
  ctx.logger.info(`github plugin active (${repos.length} project repositories)`)
}

function requireRepo(repo: unknown): string {
  if (typeof repo !== 'string' || !knownRepos.has(repo)) throw new Error('Select an AgentKeeper project with a GitHub repository')
  return repo
}

const githubPlugin: Plugin = {
  async activate(ctx) {
    pluginCtx = ctx
    ctx.commands.register({
      id: 'github.projects.list',
      label: 'List AgentKeeper projects with GitHub repositories',
      handler: () => listGitHubProjects(ctx),
    })
    ctx.commands.register({
      id: 'github.pulls.list',
      label: 'List GitHub pull requests',
      handler: (args) => {
        const input = (args ?? {}) as Parameters<typeof listPRs>[1] & { repo?: string }
        return listPRs(requireRepo(input.repo), input)
      },
    })
    ctx.commands.register({ id: 'github.pulls.get', label: 'Get GitHub pull request', handler: (args) => { const input = args as { repo?: string; number: number }; return getPR(requireRepo(input.repo), input.number) } })
    ctx.commands.register({ id: 'github.pulls.diff', label: 'Get GitHub pull request diff', handler: (args) => { const input = args as { repo?: string; number: number }; return getPRDiff(requireRepo(input.repo), input.number) } })
    ctx.commands.register({ id: 'github.pulls.checks', label: 'Get GitHub pull request checks', handler: (args) => { const input = args as { repo?: string; number: number }; return getPRChecks(requireRepo(input.repo), input.number) } })
    ctx.commands.register({ id: 'github.pulls.comments', label: 'Get GitHub pull request comments', handler: (args) => { const input = args as { repo?: string; number: number }; return getPRComments(requireRepo(input.repo), input.number) } })
    ctx.commands.register({ id: 'github.pulls.comment', label: 'Comment on GitHub pull request', handler: (args) => { const input = args as { repo?: string; number: number; body: string }; return addComment(requireRepo(input.repo), input.number, input.body) } })
    ctx.commands.register({ id: 'github.pulls.review', label: 'Review GitHub pull request', handler: (args) => { const input = args as Parameters<typeof submitReview> extends [string, number, infer E, string] ? { repo?: string; number: number; event: E; body: string } : never; return submitReview(requireRepo(input.repo), input.number, input.event, input.body) } })
    ctx.commands.register({ id: 'github.pulls.merge', label: 'Merge GitHub pull request', handler: (args) => { const input = args as Parameters<typeof mergePR> extends [string, number, infer M] ? { repo?: string; number: number; method: M } : never; return mergePR(requireRepo(input.repo), input.number, input.method) } })
    ctx.commands.register({ id: 'github.pulls.create', label: 'Create GitHub pull request', handler: (args) => { const input = args as Parameters<typeof createPR>[1] & { repo?: string }; return createPR(requireRepo(input.repo), input) } })
    ctx.commands.register({ id: 'github.workItems.get', label: 'Get GitHub issue', handler: (args) => activeSource?.get(String((args as { itemId?: unknown })?.itemId ?? '')) })

    if (!await checkCliPresent()) {
      ctx.logger.warn('gh CLI not found, retrying every 15s')
      ctx.events.emit('plugin.unhealthy', { pluginId: 'github', reason: 'cli_missing' })
      cancelPolling = ctx.background.every(15_000, async () => {
        if (await checkCliPresent()) {
          cancelPolling?.(); cancelPolling = null
          await restartWorkItems(ctx)
          ctx.events.emit('plugin.healthy', { pluginId: 'github' })
        }
      })
      return
    }
    await restartWorkItems(ctx)
  },

  async deactivate() {
    cancelPolling?.()
    cancelPolling = null
    pluginCtx?.workItems.unregister('github')
    activeSource = null
    knownRepos.clear()
    pluginCtx = null
  },
}

export default githubPlugin
