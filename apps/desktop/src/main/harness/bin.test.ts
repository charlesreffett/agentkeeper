import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { executableSearchDirs } from './bin'

describe('harness executable search directories', () => {
  it('adds conventional macOS user CLI locations to a GUI PATH', () => {
    const dirs = executableSearchDirs('/usr/bin:/bin', '/Users/tester', 'darwin')

    expect(dirs).toEqual(expect.arrayContaining([
      '/usr/bin',
      '/bin',
      path.join('/Users/tester', '.local', 'bin'),
      path.join('/Users/tester', '.opencode', 'bin'),
      path.join('/Users/tester', '.grok', 'bin'),
      path.join('/Users/tester', 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]))
  })

  it('deduplicates locations already present in PATH', () => {
    const dirs = executableSearchDirs('/usr/local/bin:/usr/bin:/usr/local/bin', '/home/tester', 'linux')

    expect(dirs.filter((dir) => dir === '/usr/local/bin')).toHaveLength(1)
  })
})
