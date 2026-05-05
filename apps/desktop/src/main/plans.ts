import fs from 'node:fs/promises'
import path from 'node:path'
import type { Plan } from '../shared/ipc-contract'

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
