import { getHarness } from './harness/index'
import { getDefaultModel } from './models'
import { getDiff, getStatus } from './git'
import { findHarnessForPath } from './session-registry'
import type { CommitSuggestion, CommitGroup } from '../shared/ipc-contract'

// ─── Prompt construction ─────────────────────────────────────────────────────

function buildStatusText(status: Awaited<ReturnType<typeof getStatus>>): string {
  const lines: string[] = []
  if (status.staged.length) {
    lines.push('Staged:')
    status.staged.forEach((f) => lines.push(`  ${f.status} ${f.path}`))
  }
  if (status.unstaged.length) {
    lines.push('Unstaged:')
    status.unstaged.forEach((f) => lines.push(`  ${f.status} ${f.path}`))
  }
  if (status.untracked.length) {
    lines.push('Untracked:')
    status.untracked.forEach((f) => lines.push(`  ? ${f}`))
  }
  return lines.join('\n')
}

function buildPrompt(
  statusText: string,
  diff: string,
  diffTruncated: boolean,
  projectPath: string,
): string {
  return `You are analyzing a set of git changes to group them into logical, atomic commits.

Project: ${projectPath}

Git status:
${statusText}

Git diff${diffTruncated ? ' (truncated to first 40KB)' : ''}:
${diff || '(no diff — all changes are untracked new files)'}

Group ALL of these changes into 1–4 logical commits. Each commit should represent a coherent, atomic unit of work — changes that belong together semantically.

Commit message format: <scope>: <short imperative subject>
Common scopes: feat, fix, refactor, chore, docs, test, style, build, ci

Respond with ONLY valid JSON — no markdown fences, no explanation outside the JSON:
{
  "overview": "Brief one-sentence summary of all changes",
  "groups": [
    {
      "message": "scope: short imperative description under 72 chars",
      "files": ["relative/path/to/file.ts"],
      "explanation": "Why these files belong in the same commit"
    }
  ]
}

Rules:
- Every changed file (modified, added, deleted, renamed, untracked) must appear in exactly one group
- Group files that change together functionally or share a logical concern
- Separate unrelated changes into different commits
- Use imperative mood: "add", "fix", "update", "remove", "refactor", etc.
- Untracked files that are part of a feature belong with that feature's group`
}

// ─── Response parsing ────────────────────────────────────────────────────────

function parseResponse(text: string, allFiles: string[]): CommitSuggestion {
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    const groups: CommitGroup[] = (parsed.groups ?? []).map((g: Record<string, unknown>) => ({
      message: String(g.message ?? 'chore: update files'),
      files: Array.isArray(g.files) ? (g.files as string[]).map(String) : [],
      explanation: String(g.explanation ?? ''),
    }))

    // Ensure no file is silently dropped — add any missing file to last group
    const assigned = new Set(groups.flatMap((g) => g.files))
    const missing = allFiles.filter((f) => !assigned.has(f))
    if (missing.length > 0 && groups.length > 0) {
      groups[groups.length - 1]!.files.push(...missing)
    } else if (missing.length > 0) {
      groups.push({ message: 'chore: update files', files: missing, explanation: '' })
    }

    return { overview: String(parsed.overview ?? 'Changes ready to commit'), groups }
  } catch {
    // Fallback: single group with all files
    return {
      overview: 'Could not parse AI suggestion — all changes in one commit',
      groups: allFiles.length
        ? [{ message: 'chore: update files', files: allFiles, explanation: '' }]
        : [],
    }
  }
}

// ─── Claude call — two auth paths ────────────────────────────────────────────
//
// Console users (API key in keychain): direct REST call via @anthropic-ai/sdk.
// Pro/Max users (claude login, no keychain key): subprocess path via the agent
// SDK — same binary the sessions use, picks up CLI credentials automatically.

async function callHarness(prompt: string, cwd: string, harnessId?: string): Promise<string> {
  return getHarness(harnessId).runPrompt(prompt, { model: await getDefaultModel(harnessId), cwd })
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function suggestCommits(projectPath: string): Promise<CommitSuggestion> {
  const [status, diff] = await Promise.all([getStatus(projectPath), getDiff(projectPath)])

  const allFiles = [
    ...status.staged.map((f) => f.path),
    ...status.unstaged
      .filter((f) => !status.staged.some((s) => s.path === f.path))
      .map((f) => f.path),
    ...status.untracked,
  ]

  if (allFiles.length === 0) {
    return { overview: 'No changes to commit.', groups: [] }
  }

  const diffTruncated = diff.includes('…(truncated)')
  const statusText = buildStatusText(status)
  const prompt = buildPrompt(statusText, diff, diffTruncated, projectPath)

  // Pin to the harness that produced the work in this path, not the global
  // active default.
  const harnessId = findHarnessForPath(projectPath)
  const responseText = await callHarness(prompt, projectPath, harnessId)
  return parseResponse(responseText, allFiles)
}
