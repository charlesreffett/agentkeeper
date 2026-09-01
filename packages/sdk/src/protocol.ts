export type PluginToHostMessage =
  | { id: string; type: 'ready' }
  | { id: string; type: 'activated' }
  | { id: string; type: 'deactivated' }
  | { id: string; type: 'installed' }
  | { id: string; type: 'updated' }
  | { id: string; type: 'uninstalled' }
  | { id: string; type: 'storage.get'; key: string }
  | { id: string; type: 'storage.set'; key: string; value: string }
  | { id: string; type: 'storage.delete'; key: string }
  | { id: string; type: 'storage.list' }
  | { id: string; type: 'projects.list' }
  | { id: string; type: 'secrets.get'; key: string }
  | { id: string; type: 'secrets.set'; key: string; value: string }
  | { id: string; type: 'secrets.delete'; key: string }
  | { id: string; type: 'events.emit'; event: string; payload: unknown }
  | { id: string; type: 'events.on'; event: string; listenerId: string }
  | { id: string; type: 'events.off'; listenerId: string }
  | { id: string; type: 'workItems.register'; sourceId: string }
  | { id: string; type: 'workItems.unregister'; sourceId: string }
  | { id: string; type: 'workItems.list.result'; items: unknown[] }
  | { id: string; type: 'workItems.get.result'; item: unknown }
  | { id: string; type: 'workItems.updateStatus.result' }
  | { id: string; type: 'workItems.addComment.result' }
  | { id: string; type: 'workItems.getTransitions.result'; transitions: unknown[] }
  | { id: string; type: 'workItems.transition.result' }
  | { id: string; type: 'workItems.create.result'; item: unknown }
  | { id: string; type: 'logger.debug'; message: string; args: unknown[] }
  | { id: string; type: 'logger.info'; message: string; args: unknown[] }
  | { id: string; type: 'logger.warn'; message: string; args: unknown[] }
  | { id: string; type: 'logger.error'; message: string; args: unknown[] }
  | { id: string; type: 'background.every'; intervalMs: number; taskId: string }
  | { id: string; type: 'background.once'; delayMs: number; taskId: string }
  | { id: string; type: 'ui.contribute'; slot: string; contribution: unknown }
  | { id: string; type: 'commands.register'; commandId: string; label: string }
  | { id: string; type: 'commands.invoke.result'; result?: unknown; error?: string }

export type HostToPluginMessage =
  | { type: 'activate'; config: Record<string, unknown> }
  | { type: 'deactivate' }
  | { type: 'install' }
  | { type: 'update'; previousVersion: string }
  | { type: 'uninstall' }
  | { type: 'response'; id: string; result?: unknown; error?: string }
  | { type: 'events.dispatch'; listenerId: string; event: string; payload: unknown }
  | { type: 'background.tick'; taskId: string }
  | { type: 'workItems.list'; id: string; filter?: unknown }
  | { type: 'workItems.get'; id: string; itemId: string }
  | { type: 'workItems.updateStatus'; id: string; itemId: string; status: string }
  | { type: 'workItems.addComment'; id: string; itemId: string; comment: string }
  | { type: 'workItems.getTransitions'; id: string; itemId: string }
  | { type: 'workItems.transition'; id: string; itemId: string; transitionId: string }
  | { type: 'workItems.create'; id: string; fields: unknown }
  | { type: 'commands.invoke'; id: string; commandId: string; args: unknown }
