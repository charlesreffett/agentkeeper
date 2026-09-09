import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(new URL('./agent.ts', import.meta.url), 'utf8')

function functionBody(name: string, nextDeclaration: string): string {
  const start = source.indexOf(`export async function ${name}`)
  const end = source.indexOf(nextDeclaration, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('started session harness affinity', () => {
  it.each([
    ['sendInput', 'export async function interruptSession'],
    ['resumeSession', 'async function scheduledMcpRestart'],
  ])('%s forwards the persisted harness when it restarts a session', (name, nextDeclaration) => {
    expect(functionBody(name, nextDeclaration)).toContain('harnessId: persistedSession.harnessId')
  })

  it('keeps the persisted harness when restarting after a model change', () => {
    const start = source.indexOf('async function restartIdle')
    const end = source.indexOf('export async function setModel', start + 1)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).toContain('harnessId: persistedSession.harnessId')
  })
})
