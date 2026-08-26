import { app } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ResetRequest, ResetResult } from '../shared/ipc-contract'
import { SECRET_KEYS, secrets, harnessSecrets, type SecretKey } from './secrets'

async function removeSafely(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true })
  } catch {
    // Never fail reset because something was already gone.
  }
}

async function resetAppSettings(): Promise<void> {
  await removeSafely(path.join(app.getPath('userData'), 'settings.json'))
  const allKeys = Object.values(SECRET_KEYS) as SecretKey[]
  for (const key of allKeys) {
    try {
      await secrets.delete(key)
    } catch {
      // keytar throws if the entry never existed — ignore.
    }
  }
  await harnessSecrets.deleteAll()
}

async function resetProjectDefinitions(projectPath: string): Promise<void> {
  await removeSafely(path.join(projectPath, '.agentkeeper'))
}

async function resetGlobalDefinitions(): Promise<void> {
  await removeSafely(path.join(os.homedir(), '.agentkeeper'))
}

export async function executeReset(request: ResetRequest): Promise<ResetResult> {
  const errors: string[] = []
  const result: ResetResult = {
    appSettingsCleared: false,
    globalDefinitionsCleared: false,
    projectDefinitionsCleared: false,
    errors,
  }

  if (request.appSettings) {
    try {
      await resetAppSettings()
      result.appSettingsCleared = true
    } catch (err) {
      errors.push(
        `app settings: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (request.projectDefinitions) {
    try {
      await resetProjectDefinitions(request.projectDefinitions.projectPath)
      result.projectDefinitionsCleared = true
    } catch (err) {
      errors.push(
        `project definitions: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (request.globalDefinitions) {
    try {
      await resetGlobalDefinitions()
      result.globalDefinitionsCleared = true
    } catch (err) {
      errors.push(
        `global definitions: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return result
}
