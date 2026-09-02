const PASSTHROUGH_ENV_KEYS = [
  // Required for locating provider CLIs and their user-level configuration.
  'HOME',
  'PATH',
  // Windows process/runtime essentials.
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'windir',
  // Locale and temporary-directory essentials on Unix.
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'TMPDIR',
] as const

/**
 * Build the environment for an untrusted plugin process.
 *
 * Never forward the desktop process environment wholesale: it commonly contains
 * API keys injected for harnesses, CI, debugging, and unrelated integrations.
 */
export function buildPluginEnvironment(
  source: NodeJS.ProcessEnv,
  plugin: {
    proxyUrl: string
    entryPath: string
    id: string
  },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  env.AK_PROXY_URL = plugin.proxyUrl
  env.AK_PLUGIN_ENTRY = plugin.entryPath
  env.AK_PLUGIN_ID = plugin.id
  return env
}

/**
 * Run every plugin under Node's permission model. Code may be loaded only from
 * the host bootstrap and the plugin's compiled entry directory. Persistent data
 * must go through the scoped host APIs.
 */
export function buildPluginExecArgv(
  permissions: readonly string[],
  paths: { bootstrapPath: string; entryPath: string },
): string[] {
  const args = [
    '--permission',
    `--allow-fs-read=${paths.bootstrapPath}`,
    `--allow-fs-read=${paths.entryPath}`,
  ]
  if (permissions.includes('network')) args.push('--allow-net=127.0.0.1')
  if (permissions.includes('nativeProcess')) args.push('--allow-child-process')
  return args
}
