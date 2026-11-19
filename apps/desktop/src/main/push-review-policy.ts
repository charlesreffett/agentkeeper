import type { PushReviewFinding, PushReviewVerdict } from '../shared/ipc-contract'

export function parseReviewResponse(text: string): {
  verdict: PushReviewVerdict
  summary: string
  findings: PushReviewFinding[]
} {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Reviewer did not return JSON.')
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const findings = Array.isArray(raw.findings)
    ? raw.findings.flatMap((f): PushReviewFinding[] => {
        if (!f || typeof f !== 'object') return []
        const o = f as Record<string, unknown>
        if (typeof o.message !== 'string') return []
        const severity = o.severity === 'blocker' || o.severity === 'major' ? o.severity : 'minor'
        return [{
          severity,
          message: o.message,
          ...(typeof o.file === 'string' ? { file: o.file } : {}),
          ...(typeof o.line === 'number' ? { line: o.line } : {}),
        }]
      })
    : []
  // A verdict that contradicts its own findings is resolved toward caution.
  const blocking = findings.some((f) => f.severity !== 'minor')
  const verdict: PushReviewVerdict = raw.verdict === 'approved' && !blocking ? 'approved' : 'changes_requested'
  const summary = typeof raw.summary === 'string' ? raw.summary : ''
  return { verdict, summary, findings }
}
