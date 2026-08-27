export function isSettingsRoute(path: string): boolean {
  return path === '/settings' || path.startsWith('/settings/')
}

export function shouldCaptureSettingsOrigin(toPath: string, fromPath: string, hasMatchedOrigin: boolean): boolean {
  return isSettingsRoute(toPath) && !isSettingsRoute(fromPath) && hasMatchedOrigin && fromPath !== '/'
}
