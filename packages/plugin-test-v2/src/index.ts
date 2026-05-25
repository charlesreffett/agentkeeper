import type { Plugin, PluginContext } from '@agentkeeper/sdk'

const plugin: Plugin = {
  async onInstall(ctx: PluginContext) {
    await ctx.storage.set('installedAt', Date.now())
    await ctx.storage.set('version', '2.0.0')
    ctx.logger.info('[test-plugin] installed v2.0.0')
  },

  async activate(ctx: PluginContext) {
    ctx.ui.contribute('sidebar.primary', {
      id: 'test-plugin',
      label: 'Test Plugin v2',
      icon: 'Plug',
      order: 99,
      component: null,
    })

    const items = [
      {
        id: 'TEST-001',
        source: 'test',
        externalRef: 'TEST-001',
        title: 'Test Work Item One (v2)',
        body: 'Updated work item from agentkeeper-test v2.0.0',
        status: 'open',
        links: [],
      },
      {
        id: 'TEST-002',
        source: 'test',
        externalRef: 'TEST-002',
        title: 'Test Work Item Two (v2)',
        body: 'New work item added in v2.0.0',
        status: 'backlog',
        links: [],
      },
    ]

    ctx.workItems.register({
      id: 'test',
      label: 'Test Items',
      async list() { return items },
      async get(id: string) { return items.find(i => i.id === id) },
    })

    let tick = 0
    ctx.background.every(30_000, async () => {
      tick++
      await ctx.storage.set('heartbeat_tick', tick)
      ctx.logger.info(`[test-plugin v2] heartbeat #${tick}`)
    })

    const installedAt = await ctx.storage.get('installedAt')
    ctx.logger.info(`[test-plugin] activated v2.0.0 (installed at ${installedAt})`)
  },

  async deactivate() {},

  async onUpdate(ctx: PluginContext, previousVersion: string) {
    ctx.logger.info(`[test-plugin] updated from ${previousVersion} → v2.0.0`)
    await ctx.storage.set('updatedAt', Date.now())
    await ctx.storage.set('version', '2.0.0')
  },

  async onUninstall(ctx: PluginContext) {
    ctx.logger.info('[test-plugin v2] uninstalled. Goodbye!')
    await ctx.storage.delete('installedAt')
    await ctx.storage.delete('version')
    await ctx.storage.delete('heartbeat_tick')
    await ctx.storage.delete('updatedAt')
  },
}

export default plugin
