export interface PluginReleaseIdentity {
  id: string
  version: string
}

function parseVersion(version: string): { core: number[]; prerelease: string[] } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error(`Invalid plugin version: ${version}`)
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') ?? [] }
}

export function comparePluginVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let index = 0; index < 3; index++) {
    if (left.core[index] !== right.core[index]) return left.core[index]! > right.core[index]! ? 1 : -1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index++) {
    const l = left.prerelease[index]
    const r = right.prerelease[index]
    if (l === undefined || r === undefined) return l === r ? 0 : l === undefined ? -1 : 1
    if (l === r) continue
    const ln = /^\d+$/.test(l) ? Number(l) : null
    const rn = /^\d+$/.test(r) ? Number(r) : null
    if (ln !== null && rn !== null) return ln > rn ? 1 : -1
    if (ln !== null || rn !== null) return ln !== null ? -1 : 1
    return l > r ? 1 : -1
  }
  return 0
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

