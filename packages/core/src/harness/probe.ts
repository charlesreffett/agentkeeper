import type { HarnessCapabilities } from './types'

/** Map a CLI's `--help` text to capability flags. For each entry, the capability
 *  is `true` iff its marker substring appears in the help text — so a harness
 *  that shells out to a binary can detect exactly what the *installed* build
 *  supports, robust against version drift and forks. Returns only the probed
 *  fields; unlisted capabilities fall back to the adapter's static baseline. */
export function mapHelpTextToCapabilities(
  helpText: string,
  flagMap: Partial<Record<keyof HarnessCapabilities, string>>,
): Partial<HarnessCapabilities> {
  const result: Partial<HarnessCapabilities> = {}
  for (const [cap, marker] of Object.entries(flagMap)) {
    if (marker) result[cap as keyof HarnessCapabilities] = helpText.includes(marker)
  }
  return result
}

/** Run `<bin> <helpArgs>` and derive capabilities from its output. `run` is the
 *  adapter's own CLI runner (so binary resolution/env stay in one place). On any
 *  failure returns `{}` — the caller keeps its static baseline rather than
 *  reporting a harness as less capable because a probe crashed. */
export async function probeHelpText(
  run: (args: string[]) => Promise<string>,
  helpArgs: string[],
  flagMap: Partial<Record<keyof HarnessCapabilities, string>>,
): Promise<Partial<HarnessCapabilities>> {
  try {
    const helpText = await run(helpArgs)
    return mapHelpTextToCapabilities(helpText, flagMap)
  } catch {
    return {}
  }
}
