import { execFile, type ChildProcess } from 'node:child_process'
import type { PluginAuthority } from './plugin-authority.js'

const MAX_OUTPUT = 10 * 1024 * 1024
const SAFE_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'] as const
const INJECTION_ENV = /^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|LD_|DYLD_|PYTHONPATH|RUBYOPT|PERL5OPT)/i

export interface NativeProcessRequest {
  file: string
  args: string[]
  options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
}

function validateText(value: string, max: number, label: string): void {
  if (!value || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`Invalid ${label}`)
}

export class PluginNativeProcessBroker {
  private readonly children = new Map<string, ChildProcess>()

  constructor(private readonly authority: PluginAuthority) {}

  async exec(requestId: string, request: NativeProcessRequest): Promise<{ stdout: string; stderr: string }> {
    if (!this.authority.permissions.includes('nativeProcess')) throw new Error('Missing nativeProcess permission')
    if (this.children.has(requestId)) throw new Error('Duplicate native process request ID')
    if (this.children.size >= 4) throw new Error('Native process concurrency limit reached')
    validateText(request.file, 2_048, 'executable path')
    if (request.args.length > 256) throw new Error('Too many native process arguments')
    let aggregate = 0
    for (const arg of request.args) { validateText(arg, 32 * 1024, 'argument'); aggregate += Buffer.byteLength(arg) }
    if (aggregate > 256 * 1024) throw new Error('Native process arguments are too large')
    if (request.options?.cwd) validateText(request.options.cwd, 4_096, 'working directory')
    const timeout = request.options?.timeoutMs ?? 30_000
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120_000) throw new Error('Invalid native process timeout')
    const env: NodeJS.ProcessEnv = {}
    for (const name of SAFE_ENV) if (process.env[name] !== undefined) env[name] = process.env[name]
    const entries = Object.entries(request.options?.env ?? {})
    if (entries.length > 64) throw new Error('Too many native process environment entries')
    let envBytes = 0
    for (const [name, value] of entries) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || INJECTION_ENV.test(name)) throw new Error(`Unsafe environment name: ${name}`)
      validateText(value, 32 * 1024, 'environment value')
      envBytes += Buffer.byteLength(name) + Buffer.byteLength(value)
      env[name] = value
    }
    if (envBytes > 256 * 1024) throw new Error('Native process environment is too large')

    return new Promise((resolve, reject) => {
      const child = execFile(request.file, request.args, {
        cwd: request.options?.cwd,
        env,
        shell: false,
        windowsHide: true,
        timeout,
        maxBuffer: MAX_OUTPUT,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        this.children.delete(requestId)
        if (error) reject(new Error(`Native process failed (${error.code ?? error.signal ?? 'unknown'}): ${String(stderr).slice(0, 4_096)}`))
        else resolve({ stdout: String(stdout), stderr: String(stderr) })
      })
      this.children.set(requestId, child)
    })
  }

  stopAll(): void {
    for (const child of this.children.values()) {
      try { child.kill('SIGTERM') } catch { /* already exited */ }
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already exited */ } }, 2_000)
      timer.unref()
    }
    this.children.clear()
  }
}
