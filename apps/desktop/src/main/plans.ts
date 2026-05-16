import fs from 'node:fs/promises'
import path from 'node:path'
import type { Plan } from '../shared/ipc-contract'

export async function createPlan(
  projectPath: string,
  data: Omit<Plan, 'filename' | 'filePath' | 'createdAt' | 'updatedAt' | 'sessionIds'> & {
    sessionIds?: string[]
  },
): Promise<Plan> {
  const dir = path.join(projectPath, '.agentkeeper', 'plans')
  await fs.mkdir(dir, { recursive: true })
  const filename = `${data.externalRef.replace(/[^a-zA-Z0-9-]/g, '-')}-plan.json`
  const filePath = path.join(dir, filename)
  const now = new Date().toISOString()
  const record: Omit<Plan, 'filename' | 'filePath'> = {
    ...data,
    sessionIds: data.sessionIds ?? [],
    createdAt: now,
    updatedAt: now,
  }
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8')
  return { ...record, filename, filePath }
}

export async function updatePlan(
  projectPath: string,
  filename: string,
  patch: Partial<Omit<Plan, 'filename' | 'filePath' | 'createdAt'>>,
): Promise<Plan | null> {
  const filePath = path.join(projectPath, '.agentkeeper', 'plans', filename)
  const existing = await readPlanFile(filePath)
  if (!existing) return null
  const { filename: _fn, filePath: _fp, ...rest } = existing
  const mergedSteps = patch.steps !== undefined
    ? rest.steps.map(existing => {
        const update = patch.steps!.find(s => s.id === existing.id)
        return update ? { ...existing, ...update } : existing
      })
    : rest.steps
  const updated: Omit<Plan, 'filename' | 'filePath'> = {
    ...rest,
    ...patch,
    steps: mergedSteps ?? [],
    updatedAt: new Date().toISOString(),
  }
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8')
  return { ...updated, filename, filePath }
}

export async function deletePlan(projectPath: string, filename: string): Promise<boolean> {
  const filePath = path.join(projectPath, '.agentkeeper', 'plans', filename)
  try {
    await fs.unlink(filePath)
    return true
  } catch {
    return false
  }
}

export async function listPlans(projectPath: string): Promise<Plan[]> {
  const dir = path.join(projectPath, '.agentkeeper', 'plans')
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const plans: Plan[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const plan = await readPlanFile(path.join(dir, entry))
    if (plan) plans.push(plan)
  }
  return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getPlan(projectPath: string, filename: string): Promise<Plan | null> {
  const filePath = path.join(projectPath, '.agentkeeper', 'plans', filename)
  return readPlanFile(filePath)
}

// Removes a single session reference from every plan in the project that cites it.
// Intentionally leaves plan status and step statuses untouched — the UI decides
// what to offer next (resume, start-new, etc.) based on the remaining sessionIds.
export async function removeSessionFromPlans(projectPath: string, sessionLocalId: string): Promise<void> {
  const plans = await listPlans(projectPath)
  for (const plan of plans) {
    if (!plan.sessionIds.includes(sessionLocalId)) continue
    const updated = plan.sessionIds.filter(id => id !== sessionLocalId)
    await updatePlan(projectPath, plan.filename, { sessionIds: updated })
  }
}

// Clears all session references from every plan in the project (used on bulk delete).
export async function removeAllSessionsFromPlans(projectPath: string): Promise<void> {
  const plans = await listPlans(projectPath)
  for (const plan of plans) {
    if (plan.sessionIds.length === 0) continue
    await updatePlan(projectPath, plan.filename, { sessionIds: [] })
  }
}

async function readPlanFile(filePath: string): Promise<Plan | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as Omit<Plan, 'filename' | 'filePath'>
    return {
      ...data,
      filename: path.basename(filePath),
      filePath,
    }
  } catch {
    return null
  }
}
