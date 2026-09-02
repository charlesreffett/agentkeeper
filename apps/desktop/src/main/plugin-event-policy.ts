export type PluginEmittedEvent =
  | { event: 'plugin.healthy'; payload: { pluginId: string } }
  | { event: 'plugin.unhealthy'; payload: { pluginId: string; reason: string } }

export function normalizePluginEmittedEvent(
  pluginId: string,
  event: string,
  payload: unknown,
): PluginEmittedEvent {
  if (event === 'plugin.healthy') {
    return { event, payload: { pluginId } }
  }
  if (event === 'plugin.unhealthy') {
    const reason = typeof (payload as { reason?: unknown } | null)?.reason === 'string'
      ? (payload as { reason: string }).reason
      : 'Plugin reported an unhealthy state'
    return { event, payload: { pluginId, reason } }
  }
  throw new Error(`Plugin event cannot be emitted: ${event}`)
}

export function filterPluginSubscription(
  pluginId: string,
  event: string,
  payload: unknown,
): unknown | undefined {
  if (event !== 'settings.changed') {
    throw new Error(`Plugin event cannot be observed: ${event}`)
  }
  const scoped = payload as { pluginId?: unknown } | null
  return scoped?.pluginId === pluginId ? payload : undefined
}

