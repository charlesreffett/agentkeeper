import { describe, expect, it } from 'vitest'
import { parseRoleGenerationResponse } from './roles'

const generatedRole = (systemPrompt = 'You review production-ready code.') => ({
  id: 'production-reviewer',
  name: 'Production Reviewer',
  description: 'Reviews code before production.',
  systemPrompt,
})

describe('role generation response parsing', () => {
  it('accepts strict JSON', () => {
    expect(parseRoleGenerationResponse(JSON.stringify(generatedRole()))).toEqual(
      generatedRole(),
    )
  })

  it('accepts a trailing comma before the closing object delimiter', () => {
    const response = `${JSON.stringify(generatedRole(), null, 2).slice(0, -2)},\n}`
    expect(parseRoleGenerationResponse(response)).toEqual(generatedRole())
  })

  it('extracts JSON from a markdown fence or surrounding prose', () => {
    const response = `Here is the role:\n\n\`\`\`json\n${JSON.stringify(generatedRole())}\n\`\`\``
    expect(parseRoleGenerationResponse(response)).toEqual(generatedRole())
  })

  it('escapes literal newlines inside generated JSON strings', () => {
    const response = JSON.stringify(generatedRole('You review code.\nYou verify CI.'))
      .replace('\\n', '\n')
    expect(parseRoleGenerationResponse(response).systemPrompt).toBe(
      'You review code.\nYou verify CI.',
    )
  })

  it('does not remove comma-like content from strings', () => {
    const role = generatedRole('You flag ,} and ,] when they appear in code.')
    expect(parseRoleGenerationResponse(JSON.stringify(role))).toEqual(role)
  })

  it('rejects output without a system prompt', () => {
    expect(() => parseRoleGenerationResponse('{"name":"Incomplete"}')).toThrow(
      'Unexpected response shape',
    )
  })
})
