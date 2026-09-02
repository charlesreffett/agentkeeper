export function assertOwnedWorkItemSource(pluginId: string, sourceId: string): void {
  if (sourceId !== pluginId) {
    throw new Error(`Plugin ${pluginId} cannot manage work-item source ${sourceId}`)
  }
}

