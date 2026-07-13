import { HarnessRegistry, type HarnessAdapter } from '@agentkeeper/core'
import { ClaudeCodeHarnessAdapter } from './claude-code'
import { OpenCodeHarnessAdapter } from './opencode'

export const claudeCodeHarness = new ClaudeCodeHarnessAdapter()
export const openCodeHarness = new OpenCodeHarnessAdapter()

export const harnessRegistry = new HarnessRegistry()
harnessRegistry.register(claudeCodeHarness, true)
harnessRegistry.register(openCodeHarness)

export function getHarness(id?: string): HarnessAdapter {
  if (id) {
    const h = harnessRegistry.get(id)
    if (!h) throw new Error(`Harness '${id}' not registered`)
    return h
  }
  return harnessRegistry.getDefault()
}
