import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'

export type ActivityCategory = 'files' | 'commands' | 'searches' | 'agents' | 'system' | 'tools'

export interface ActivityItem {
  id: string
  event: TranscriptEvent
  block: ContentBlock
  result?: Extract<ContentBlock, { type: 'tool_result' }>
  category: ActivityCategory
}

export interface ActivityGroup {
  id: string
  category: ActivityCategory
  items: ActivityItem[]
}

export interface ActivityPhase {
  id: string
  narrative: Array<{ event: TranscriptEvent; block: Extract<ContentBlock, { type: 'text' | 'thinking' }> }>
  groups: ActivityGroup[]
}

export interface WorkTurn {
  id: string
  userEvent: TranscriptEvent | null
  phases: ActivityPhase[]
  finalEvent: TranscriptEvent | null
  startedAt: number | null
  endedAt: number | null
}

export type TranscriptRenderItem =
  | { type: 'event'; event: TranscriptEvent }
  | { type: 'turn'; turn: WorkTurn }

function timestamp(event: TranscriptEvent): number | null {
  const value = Date.parse(event.timestamp)
  return Number.isFinite(value) ? value : null
}

function isHumanUser(event: TranscriptEvent): boolean {
  return event.role === 'user' && event.kind === 'user' && event.content.some((b) => b.type !== 'tool_result')
}

function categoryFor(name: string): ActivityCategory {
  const normalized = name.toLowerCase()
  if (/^(read|write|create|delete|edit|multiedit|notebookedit|apply_patch)$/.test(normalized)) return 'files'
  if (/^(bash|shell|exec|exec_command|command|terminal)/.test(normalized)) return 'commands'
  if (/^(grep|glob|find|search|websearch|webfetch)/.test(normalized)) return 'searches'
  if (/agent|subagent|send_message|sendmessage|delegate/.test(normalized)) return 'agents'
  return 'tools'
}

function newPhase(id: string): ActivityPhase {
  return { id, narrative: [], groups: [] }
}

function addItem(phase: ActivityPhase, item: ActivityItem) {
  const last = phase.groups[phase.groups.length - 1]
  // Only adjacent actions of the same kind collapse together. A later thought
  // creates a new phase, so commands from distinct thoughts never coalesce.
  if (last?.category === item.category) last.items.push(item)
  else phase.groups.push({ id: `${phase.id}-${phase.groups.length}`, category: item.category, items: [item] })
}

function buildTurn(userEvent: TranscriptEvent | null, events: TranscriptEvent[], active = false): WorkTurn | null {
  if (!events.length) return null
  const finalIndex = active ? -1 : (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!
      if (!event.content.length) continue
      const onlyResults = event.content.every((block) => block.type === 'tool_result')
      if (onlyResults) continue
      const isAnswer = event.role === 'assistant' && event.kind !== 'progress'
        && event.content.some((block) => block.type === 'text' && block.text.trim())
        && !event.content.some((block) => block.type === 'tool_use')
      return isAnswer ? i : -1
    }
    return -1
  })()
  const finalEvent = finalIndex >= 0 ? events[finalIndex]! : null
  const workEvents = events.filter((_, index) => index !== finalIndex)
  const phases: ActivityPhase[] = [newPhase(`${userEvent?.uuid ?? events[0]!.uuid}-phase-0`)]
  const results = new Map<string, Extract<ContentBlock, { type: 'tool_result' }>>()
  for (const event of workEvents) {
    for (const block of event.content) if (block.type === 'tool_result') results.set(block.tool_use_id, block)
  }

  for (const event of workEvents) {
    if (event.kind === 'system' || event.kind === 'progress') {
      addItem(phases[phases.length - 1]!, {
        id: event.uuid,
        event,
        block: { type: 'unknown', raw: event.content },
        category: event.kind === 'progress' ? 'agents' : 'system',
      })
      continue
    }
    for (let index = 0; index < event.content.length; index++) {
      const block = event.content[index]!
      if (block.type === 'tool_result' || block.type === 'image') continue
      if (block.type === 'text' || block.type === 'thinking') {
        if (!(block.type === 'text' ? block.text : block.thinking).trim()) continue
        let phase = phases[phases.length - 1]!
        if (phase.groups.length > 0) {
          phase = newPhase(`${userEvent?.uuid ?? events[0]!.uuid}-phase-${phases.length}`)
          phases.push(phase)
        }
        phase.narrative.push({ event, block })
        continue
      }
      const phase = phases[phases.length - 1]!
      if (block.type === 'tool_use') {
        addItem(phase, {
          id: block.id || `${event.uuid}-${index}`,
          event,
          block,
          result: results.get(block.id),
          category: categoryFor(block.name),
        })
      } else {
        addItem(phase, { id: `${event.uuid}-${index}`, event, block, category: 'tools' })
      }
    }
  }
  const nonEmptyPhases = phases.filter((phase) => phase.narrative.length || phase.groups.length)
  if (!nonEmptyPhases.length && !finalEvent) return null
  return {
    id: `turn-${userEvent?.uuid ?? events[0]!.uuid}`,
    userEvent,
    phases: nonEmptyPhases,
    finalEvent,
    startedAt: timestamp(userEvent ?? events[0]!),
    endedAt: timestamp(finalEvent ?? events[events.length - 1]!),
  }
}

export function groupTranscript(events: TranscriptEvent[], active = false): TranscriptRenderItem[] {
  const visible = events.filter((event) => !event.isMeta && event.kind !== 'summary' && event.kind !== 'other')
  const items: TranscriptRenderItem[] = []
  let userEvent: TranscriptEvent | null = null
  let pending: TranscriptEvent[] = []

  const flush = (activeTurn = false) => {
    if (userEvent) items.push({ type: 'event', event: userEvent })
    const turn = buildTurn(userEvent, pending, activeTurn)
    if (turn) items.push({ type: 'turn', turn })
    else for (const event of pending) items.push({ type: 'event', event })
    userEvent = null
    pending = []
  }

  for (const event of visible) {
    if (isHumanUser(event)) {
      if (userEvent || pending.length) flush()
      userEvent = event
    } else {
      pending.push(event)
    }
  }
  if (userEvent || pending.length) flush(active)
  return items
}

export function activityGroupLabel(group: ActivityGroup): string {
  const descriptions = group.items.map(describeActivity)
  if (descriptions.length === 1) return descriptions[0]!.label

  const actions = new Map<string, { verb: string; noun: string; count: number }>()
  for (const description of descriptions) {
    const key = `${description.pluralVerb}:${description.pluralNoun}`
    const current = actions.get(key)
    actions.set(key, { verb: description.pluralVerb, noun: description.pluralNoun, count: (current?.count ?? 0) + 1 })
  }
  if (actions.size === 1) {
    const { verb, noun, count } = [...actions.values()][0]!
    return `${verb} ${count} ${noun}`
  }
  return [...actions.values()]
    .map(({ verb, noun, count }, index) => `${index === 0 ? verb : verb.toLowerCase()} ${count} ${count === 1 ? noun.replace(/s$/, '') : noun}`)
    .join(', ')
}

function inputValue(block: Extract<ContentBlock, { type: 'tool_use' }>, keys: string[]): string | null {
  if (!block.input || typeof block.input !== 'object' || Array.isArray(block.input)) return null
  const input = block.input as Record<string, unknown>
  for (const key of keys) if (typeof input[key] === 'string' && input[key]) return input[key] as string
  return null
}

interface ActivityDescription { label: string; pluralVerb: string; pluralNoun: string }

function describeActivity(item: ActivityItem): ActivityDescription {
  if (item.block.type !== 'tool_use') return genericDescription(item.category)
  const name = item.block.name.toLowerCase().replace(/[_-]/g, '')
  const file = inputValue(item.block, ['file_path', 'filePath', 'path'])
  const command = inputValue(item.block, ['command', 'cmd'])
  const query = inputValue(item.block, ['pattern', 'query'])

  if (name === 'read') return { label: `Read${file ? ` ${file}` : ' 1 file'}`, pluralVerb: 'Read', pluralNoun: 'files' }
  if (name === 'create') return { label: `Created${file ? ` ${file}` : ' 1 file'}`, pluralVerb: 'Created', pluralNoun: 'files' }
  if (name === 'write') return { label: `Wrote${file ? ` ${file}` : ' 1 file'}`, pluralVerb: 'Wrote', pluralNoun: 'files' }
  if (/^(edit|multiedit|notebookedit|applypatch)$/.test(name)) return { label: `Edited${file ? ` ${file}` : ' 1 file'}`, pluralVerb: 'Edited', pluralNoun: 'files' }
  if (name === 'delete' || name === 'remove') return { label: `Deleted${file ? ` ${file}` : ' 1 file'}`, pluralVerb: 'Deleted', pluralNoun: 'files' }
  if (/^(bash|shell|exec|execcommand|command|terminal)/.test(name)) return { label: `Ran${command ? ` ${command}` : ' 1 command'}`, pluralVerb: 'Ran', pluralNoun: 'commands' }
  if (/^(grep|search|websearch|webfetch)$/.test(name)) return { label: `Searched${query ? ` for ${query}` : ''}`, pluralVerb: 'Performed', pluralNoun: 'searches' }
  if (/^(glob|find)$/.test(name)) return { label: `Found${query ? ` ${query}` : ' files'}`, pluralVerb: 'Found', pluralNoun: 'files' }
  return genericDescription(item.category)
}

function genericDescription(category: ActivityCategory): ActivityDescription {
  const noun: Record<ActivityCategory, [string, string]> = {
    files: ['file', 'files'], commands: ['command', 'commands'], searches: ['search', 'searches'],
    agents: ['sub-agent action', 'sub-agent actions'], system: ['system event', 'system events'], tools: ['tool', 'tools'],
  }
  const [one, many] = noun[category]
  const verb: Record<ActivityCategory, string> = {
    files: 'Changed', commands: 'Ran', searches: 'Performed', agents: 'Ran', system: 'Received', tools: 'Used',
  }
  return { label: `${verb[category]} 1 ${one}`, pluralVerb: verb[category], pluralNoun: many }
}
