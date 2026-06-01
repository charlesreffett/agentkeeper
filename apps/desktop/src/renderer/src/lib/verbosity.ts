import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'

// ─── Types ───────────────────────────────────────────────────────────────────

export type VerbosityMode = 'concise' | 'default' | 'verbose'

export interface VerbosityToggles {
  toolCalls: boolean
  thinking: boolean
  system: boolean
  subAgents: boolean
}

export interface VerbosityState {
  mode: VerbosityMode
  toggles: VerbosityToggles
}

// ─── Mode presets ────────────────────────────────────────────────────────────

/** Default chip state for each mode. Chips reset to these when a mode is selected. */
export const MODE_DEFAULTS: Record<VerbosityMode, VerbosityToggles> = {
  concise: { toolCalls: false, thinking: false, system: false, subAgents: false },
  default: { toolCalls: false, thinking: true,  system: false, subAgents: false },
  verbose: { toolCalls: true,  thinking: true,  system: true,  subAgents: true  },
}

export const DEFAULT_VERBOSITY_STATE: VerbosityState = {
  mode: 'default',
  toggles: { ...MODE_DEFAULTS.default },
}

// ─── Block-level visibility ──────────────────────────────────────────────────

export function isBlockVisible(block: ContentBlock, state: VerbosityState): boolean {
  const { toggles } = state
  switch (block.type) {
    case 'text':
      return block.text.trim().length > 0
    case 'thinking':
      return toggles.thinking && block.thinking.trim().length > 0
    case 'tool_use':
      return toggles.toolCalls
    case 'tool_result':
      // Error results surface regardless — they're meaningful signal even without tool noise.
      if (block.is_error === true) return true
      return toggles.toolCalls
    case 'image':
      return true
    case 'unknown':
      return toggles.toolCalls
    default:
      return true
  }
}

// ─── Event-level visibility ──────────────────────────────────────────────────

export function passesEventFilter(e: TranscriptEvent, state: VerbosityState): boolean {
  if (e.isMeta) return false
  if (e.kind === 'other') return false
  if (e.kind === 'summary') return false
  if (e.kind === 'system') {
    // Interruption markers always show; other system events gated by toggle.
    if (e.systemSubtype === 'interrupted') return true
    return state.toggles.system
  }
  // 'progress' events carry sub-agent activity.
  if (e.kind === 'progress') return state.toggles.subAgents
  if (e.content.length === 0) return false
  return true
}

// ─── Hidden-count helpers ────────────────────────────────────────────────────

/**
 * Total items hidden across all events under the current state.
 * Drives the "N hidden" label in the toolbar.
 */
export function hiddenCount(events: TranscriptEvent[], state: VerbosityState): number {
  let count = 0
  for (const e of events) {
    if (!passesEventFilter(e, state)) {
      count++
      continue
    }
    count += e.content.filter((b) => !isBlockVisible(b, state)).length
  }
  return count
}

/**
 * Count tool_use/tool_result blocks hidden within a single event's content.
 * Used to build gap pills between visible events in the transcript.
 */
export function hiddenToolCount(blocks: ContentBlock[], state: VerbosityState): number {
  return blocks.filter(
    (b) => !isBlockVisible(b, state) && (b.type === 'tool_use' || b.type === 'tool_result'),
  ).length
}

// ─── Status bar helper ───────────────────────────────────────────────────────

/** Human-readable present-tense label for a tool name, used in the status bar. */
export function toolDisplayName(name: string): string {
  const MAP: Record<string, string> = {
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Editing',
    Bash: 'Running command',
    Grep: 'Searching',
    Glob: 'Finding files',
    WebFetch: 'Fetching',
    WebSearch: 'Searching web',
    TodoWrite: 'Updating todos',
    Agent: 'Running agent',
    NotebookEdit: 'Editing notebook',
    mcp__agentkeeper__send_message: 'Messaging agent',
    Skill: 'Invoking skill',
  }
  return MAP[name] ?? name
}
