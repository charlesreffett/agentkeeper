export interface PluginReleaseIdentity {
  id: string
  version: string
}

export function comparePluginVersions(a: string, b: string): number {
  if (!semver.valid(a) || !semver.valid(b)) throw new Error(`Invalid plugin version: ${!semver.valid(a) ? a : b}`)
  return semver.compare(a, b)
}

export function assertReleaseIdentity(
  expected: PluginReleaseIdentity,
  actual: PluginReleaseIdentity,
  currentVersion?: string,
): void {
  if (actual.id !== expected.id) throw new Error(`Plugin package ID mismatch: expected ${expected.id}, got ${actual.id}`)
  if (actual.version !== expected.version) throw new Error(`Plugin package version mismatch: expected ${expected.version}, got ${actual.version}`)
  if (currentVersion !== undefined && comparePluginVersions(actual.version, currentVersion) <= 0) {
    throw new Error(`Plugin update must be newer than ${currentVersion}: got ${actual.version}`)
  }
}
import semver from 'semver'

