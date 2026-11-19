import { describe, expect, it } from 'vitest'
import { parseReviewResponse } from './push-review-policy'

describe('push review response parsing', () => {
  it('accepts an approval with only minor findings', () => {
    const result = parseReviewResponse(JSON.stringify({
      verdict: 'approved',
      summary: 'Looks good.',
      findings: [{ severity: 'minor', file: 'a.ts', line: 3, message: 'Rename x.' }],
    }))
    expect(result.verdict).toBe('approved')
    expect(result.findings).toEqual([{ severity: 'minor', file: 'a.ts', line: 3, message: 'Rename x.' }])
  })

  it('extracts JSON wrapped in prose or code fences', () => {
    const result = parseReviewResponse('Here is my review:\n```json\n{"verdict":"changes_requested","summary":"Bug.","findings":[]}\n```')
    expect(result.verdict).toBe('changes_requested')
    expect(result.summary).toBe('Bug.')
  })

  it('downgrades an approval that contradicts its own blocking findings', () => {
    const result = parseReviewResponse(JSON.stringify({
      verdict: 'approved',
      summary: '',
      findings: [{ severity: 'blocker', message: 'Drops user data.' }],
    }))
    expect(result.verdict).toBe('changes_requested')
  })

  it('treats unknown verdicts and severities conservatively', () => {
    const result = parseReviewResponse(JSON.stringify({
      verdict: 'lgtm',
      findings: [{ severity: 'nit', message: 'Spacing.' }, { message: 42 }],
    }))
    expect(result.verdict).toBe('changes_requested')
    expect(result.findings).toEqual([{ severity: 'minor', message: 'Spacing.' }])
  })

  it('rejects output with no JSON object', () => {
    expect(() => parseReviewResponse('Looks fine to me')).toThrow('Reviewer did not return JSON.')
  })
})
