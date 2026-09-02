import { describe, expect, it } from 'vitest'
import { buildPluginEnvironment, buildPluginExecArgv } from './plugin-environment'

describe('buildPluginEnvironment', () => {
  it('does not expose host credentials or unrelated application variables', () => {
    const env = buildPluginEnvironment({
      HOME: '/Users/example',
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'secret-anthropic-key',
      AWS_SECRET_ACCESS_KEY: 'secret-aws-key',
      AGENTKEEPER_DEBUG_PORT: '9223',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    }, {
      proxyUrl: 'http://127.0.0.1:43123',
      entryPath: '/plugins/example/dist/index.js',
      id: 'example',
    })

    expect(env).toEqual({
      HOME: '/Users/example',
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      AK_PROXY_URL: 'http://127.0.0.1:43123',
      AK_PLUGIN_ENTRY: '/plugins/example/dist/index.js',
      AK_PLUGIN_ID: 'example',
    })
  })

  it('does not let the parent override host-controlled plugin variables', () => {
    const env = buildPluginEnvironment({
      AK_PROXY_URL: 'http://attacker.invalid',
      AK_PLUGIN_ENTRY: '/tmp/attacker.js',
      AK_PLUGIN_ID: 'attacker',
    }, {
      proxyUrl: 'http://127.0.0.1:43123',
      entryPath: '/plugins/example/dist/index.js',
      id: 'example',
    })

    expect(env.AK_PROXY_URL).toBe('http://127.0.0.1:43123')
    expect(env.AK_PLUGIN_ENTRY).toBe('/plugins/example/dist/index.js')
    expect(env.AK_PLUGIN_ID).toBe('example')
  })

  it('does not copy integration credentials into the plugin process environment', () => {
    const env = buildPluginEnvironment({
      JIRA_API_TOKEN: 'jira-token',
      UNDECLARED_TOKEN: 'other-token',
    }, {
      proxyUrl: 'deny',
      entryPath: '/plugins/jira/dist/index.js',
      id: 'jira',
    })

    expect(env.JIRA_API_TOKEN).toBeUndefined()
    expect(env.UNDECLARED_TOKEN).toBeUndefined()
  })

  it('keeps host-controlled plugin variables authoritative', () => {
    const env = buildPluginEnvironment({ AK_PLUGIN_ID: 'attacker' }, {
      proxyUrl: 'deny',
      entryPath: '/plugins/example/dist/index.js',
      id: 'example',
    })

    expect(env.AK_PLUGIN_ID).toBe('example')
  })
})

describe('buildPluginExecArgv', () => {
  const paths = {
    bootstrapPath: '/app/runtime',
    entryPath: '/plugins/example/dist',
  }

  it('denies subprocesses when nativeProcess is not declared', () => {
    const args = buildPluginExecArgv(['network'], paths)

    expect(args).toContain('--permission')
    expect(args).toContain('--allow-fs-read=/app/runtime')
    expect(args).toContain('--allow-fs-read=/plugins/example/dist')
    expect(args.some(arg => arg.startsWith('--allow-fs-write'))).toBe(false)
    expect(args).toContain('--allow-net=127.0.0.1')
    expect(args).not.toContain('--allow-child-process')
    expect(args).not.toContain('--allow-worker')
    expect(args).not.toContain('--allow-addons')
  })

  it('allows subprocesses only for nativeProcess plugins', () => {
    expect(buildPluginExecArgv(['nativeProcess'], paths)).toContain('--allow-child-process')
  })

  it('does not grant network access unless declared', () => {
    expect(buildPluginExecArgv([], paths).some(arg => arg.startsWith('--allow-net'))).toBe(false)
  })
})
