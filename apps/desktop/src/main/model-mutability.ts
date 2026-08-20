import type { HarnessCapabilities } from '@agentkeeper/core'
import type { LiveSessionStatus, SetModelResult } from '../shared/ipc-contract'

type Rejection = Exclude<SetModelResult, { ok: true }>

export function modelSelectionRejection(
  mutability: HarnessCapabilities['modelSelection'],
  status: LiveSessionStatus,
): Rejection | null {
  if (mutability === 'draft-only') {
    return { ok: false, reason: 'model-selection-unsupported', message: 'This harness fixes the model when the session starts.' }
  }
  if (status === 'running' || status === 'starting') {
    if (mutability === 'turn') return null
    return { ok: false, reason: 'session-running', message: 'Wait for the current turn to finish before changing models.' }
  }
  if (status === 'error' || status === 'completed' || status === 'inactive') {
    return { ok: false, reason: 'session-terminal', message: `Cannot change the model on a ${status} session.` }
  }
  return null
}
