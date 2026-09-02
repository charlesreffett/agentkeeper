import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function runRestricted(source: string, extraArgs: string[] = []): string {
  try {
    return execFileSync(process.execPath, ['--permission', ...extraArgs, '--eval', source], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error)
  }
}

describe('Node plugin runtime boundary', () => {
  it('denies subprocess creation without nativeProcess', () => {
    const output = runRestricted("require('node:child_process').execFileSync(process.execPath, ['--version'])")
    expect(output).toContain('ERR_ACCESS_DENIED')
    expect(output).toContain('ChildProcess')
  })

  it('denies raw network clients without network permission', () => {
    const output = runRestricted("require('node:net').connect(9, 'example.com')")
    expect(output).toContain('ERR_ACCESS_DENIED')
    expect(output).toContain('getaddrinfo')
  })

  it('permits subprocess creation only when explicitly granted', () => {
    const output = runRestricted(
      "console.log(require('node:child_process').execFileSync(process.execPath, ['--version'], { encoding: 'utf8' }).trim())",
      ['--allow-child-process'],
    )
    expect(output).toMatch(/^v\d+/)
  })
})
