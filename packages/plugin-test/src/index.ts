import type { Plugin, PluginContext } from '@agentkeeper/sdk'

const plugin: Plugin = {
  async onInstall(ctx: PluginContext) {
    await ctx.storage.set('installedAt', Date.now())
    await ctx.storage.set('version', '1.0.0')
    ctx.logger.info('[test-plugin] installed v1.0.0')
  },

  async activate(ctx: PluginContext) {
    ctx.ui.contribute('sidebar.primary', {
      id: 'test-plugin',
      label: 'Test Plugin',
      icon: 'Plug',
      order: 99,
      component: null,
    })

    ctx.workItems.register({
      id: 'test',
      label: 'Test Items',
      async list() {
        return [{
          id: 'TEST-001',
          source: 'test',
          externalRef: 'TEST-001',
          title: 'Test Work Item (v1)',
          body: 'A test work item from agentkeeper-test v1.0.0',
          status: 'open',
          links: [],
        }]
      },
      async get(id: string) {
        if (id === 'TEST-001') return {
          id: 'TEST-001',
          source: 'test',
          externalRef: 'TEST-001',
          title: 'Test Work Item (v1)',
          body: 'A test work item from agentkeeper-test v1.0.0',
          status: 'open',
          links: [],
        }
        return undefined
      },
    })

    let tick = 0
    ctx.background.every(30_000, async () => {
      tick++
      await ctx.storage.set('heartbeat_tick', tick)
      ctx.logger.info(`[test-plugin] heartbeat #${tick}`)
    })

    const installedAt = await ctx.storage.get('installedAt')
    ctx.logger.info(`[test-plugin] activated v1.0.0 (installed at ${installedAt})`)
  },

  async deactivate() {},

  async onUpdate(ctx: PluginContext, previousVersion: string) {
    ctx.logger.info(`[test-plugin] updated from ${previousVersion} → v1.0.0`)
    await ctx.storage.set('updatedAt', Date.now())
  },

  async onUninstall(ctx: PluginContext) {
    ctx.logger.info('[test-plugin] uninstalled. Goodbye!')
    await ctx.storage.delete('installedAt')
    await ctx.storage.delete('version')
    await ctx.storage.delete('heartbeat_tick')
    await ctx.storage.delete('updatedAt')
  },
}

export default plugin
