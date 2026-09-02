export function assertOwnedWorkItemSource(pluginId: string, sourceId: string): void {
  if (sourceId !== pluginId) {
    throw new Error(`Plugin ${pluginId} cannot manage work-item source ${sourceId}`)
  }
}

interface WorkItemRegistryBoundary<T extends { id: string }> {
  register(source: T): void
  unregister(sourceId: string): void
}

export class PluginWorkItemOwnership<T extends { id: string }> {
  private readonly registered = new Set<string>()

  constructor(
    private readonly pluginId: string,
    private readonly registry: WorkItemRegistryBoundary<T>,
  ) {}

  register(source: T): void {
    assertOwnedWorkItemSource(this.pluginId, source.id)
    this.registry.register(source)
    this.registered.add(source.id)
  }

  unregister(sourceId: string): void {
    assertOwnedWorkItemSource(this.pluginId, sourceId)
    this.registry.unregister(sourceId)
    this.registered.delete(sourceId)
  }

  dispose(): void {
    for (const sourceId of this.registered) this.registry.unregister(sourceId)
    this.registered.clear()
  }
}
