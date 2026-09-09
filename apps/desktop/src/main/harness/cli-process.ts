import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

export function spawnHarnessProcess(bin: string, args: string[], options: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal }): ChildProcessWithoutNullStreams {
  return spawn(bin, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export async function* jsonLines(stream: NodeJS.ReadableStream): AsyncIterable<unknown> {
  const lines = readline.createInterface({ input: stream })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try { yield JSON.parse(trimmed) } catch { /* provider diagnostics may share stdout */ }
  }
}

export function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error(`Harness exited with ${child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`}`))
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Harness exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
    })
  })
}
