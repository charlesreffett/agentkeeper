import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { PlanTodo, PlanTodoStatus, TranscriptEvent } from '@shared/ipc-contract'

export type { PlanTodo, PlanTodoStatus }

export interface PlanProgress {
  hasPlan: boolean
  todos: PlanTodo[]
  totalCount: number
  completedCount: number
  /** The in_progress todo, if any */
  activeTodo: PlanTodo | null
  /** 1-based position of activeTodo in the todos array */
  activeTodoIndex: number
  /** True when every todo is completed */
  allDone: boolean
  /** Last todo in the list when allDone — used for the "final step" display */
  lastCompletedTodo: PlanTodo | null
}

const NO_PLAN: PlanProgress = {
  hasPlan: false,
  todos: [],
  totalCount: 0,
  completedCount: 0,
  activeTodo: null,
  activeTodoIndex: 0,
  allDone: false,
  lastCompletedTodo: null,
}

function isValidTodo(v: unknown): v is PlanTodo {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o['content'] === 'string' && typeof o['status'] === 'string'
}

function todosToProgress(todos: PlanTodo[]): PlanProgress {
  const totalCount = todos.length
  const completedCount = todos.filter((t) => t.status === 'completed').length

  const activeIdx = todos.findIndex((t) => t.status === 'in_progress' || t.status === 'partial')
  const activeTodo = activeIdx !== -1 ? todos[activeIdx]! : null
  const activeTodoIndex = activeIdx !== -1 ? activeIdx + 1 : 0

  const allDone = totalCount > 0 && completedCount === totalCount
  const lastCompletedTodo = allDone ? (todos[todos.length - 1] ?? null) : null

  return {
    hasPlan: true,
    todos,
    totalCount,
    completedCount,
    activeTodo,
    activeTodoIndex,
    allDone,
    lastCompletedTodo,
  }
}

export function getPlanProgress(session: {
  events: TranscriptEvent[]
  planState: PlanTodo[] | null
}): PlanProgress {
  const { events, planState } = session

  // Scan live events first — most recent TodoWrite wins.
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]
    if (!evt || evt.role !== 'assistant') continue

    for (const b of evt.content) {
      if (b.type !== 'tool_use' || b.name !== 'TodoWrite') continue

      const input = b.input as { todos?: unknown[] }
      if (!Array.isArray(input?.todos)) break

      const todos: PlanTodo[] = input.todos.filter(isValidTodo).map((t) => {
        const raw = t as unknown as Record<string, unknown>
        return {
          id: typeof raw['id'] === 'string' ? raw['id'] : String(Math.random()),
          content: t.content,
          status: t.status,
          ...(typeof raw['priority'] === 'string' ? { priority: raw['priority'] } : {}),
        }
      })

      return todosToProgress(todos)
    }
  }

  // Fall back to persisted planState when events are empty (e.g. on first load
  // before the user navigates into the session detail).
  if (planState && planState.length > 0) {
    return todosToProgress(planState)
  }

  return NO_PLAN
}

export function usePlanProgress(
  getSession: () => { events: TranscriptEvent[]; planState: PlanTodo[] | null },
): ComputedRef<PlanProgress> {
  return computed(() => getPlanProgress(getSession()))
}
