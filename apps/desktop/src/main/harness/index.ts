import { HarnessRegistry, type HarnessAdapter } from '@agentkeeper/core'
import { ClaudeCodeHarnessAdapter } from './claude-code'
import { OpenCodeHarnessAdapter } from './opencode'
import { CodexHarnessAdapter } from './codex'
import { cursorHarness, grokHarness } from './acp'

export const claudeCodeHarness = new ClaudeCodeHarnessAdapter()
export const openCodeHarness = new OpenCodeHarnessAdapter()
export const codexHarness = new CodexHarnessAdapter()

export const harnessRegistry = new HarnessRegistry()
harnessRegistry.register(claudeCodeHarness, true)
harnessRegistry.register(openCodeHarness)
harnessRegistry.register(codexHarness)
harnessRegistry.register(cursorHarness)
harnessRegistry.register(grokHarness)

/** Re-apply the user's saved harness choice as the registry default at startup.
 *  Guarded: an id whose adapter is no longer registered is ignored, so the
 *  first-registered harness stays the fallback. */
export function initHarnessDefault(id: string | undefined): void {
  if (id && harnessRegistry.get(id)) harnessRegistry.setDefault(id)
}

export function getHarness(id?: string): HarnessAdapter {
  if (id) {
    const h = harnessRegistry.get(id)
    if (!h) throw new Error(`Harness '${id}' not registered`)
    return h
  }
  return harnessRegistry.getDefault()
}
