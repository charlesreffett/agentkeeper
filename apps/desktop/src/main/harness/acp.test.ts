import { describe, expect, it } from 'vitest'
import { modelsFromAcp } from './acp'

describe('ACP model discovery', () => {
  const fallback = { value: 'default', label: 'Default', provider: 'Cursor', isDefault: true }

  it('normalizes the typed session model state used by Grok', () => {
    expect(modelsFromAcp({
      currentModelId: 'grok-build',
      availableModels: [
        { modelId: 'grok-build', name: 'Grok Build', description: 'Coding agent' },
        { modelId: 'grok-4', name: 'Grok 4' },
      ],
    }, { ...fallback, provider: 'xAI' })).toEqual([
      { value: 'grok-build', label: 'Grok Build', description: 'Coding agent', provider: 'xAI', isDefault: true },
      { value: 'grok-4', label: 'Grok 4', description: undefined, provider: 'xAI', isDefault: false },
    ])
  })

  it('normalizes Cursor list_available_models and preserves its active model', () => {
    expect(modelsFromAcp({
      currentValue: 'gpt-5.4',
      models: [{ value: 'gpt-5.4', name: 'GPT-5.4' }],
    }, fallback)).toEqual([
      { value: 'gpt-5.4', label: 'GPT-5.4', description: undefined, provider: 'Cursor', isDefault: true },
    ])
  })

  it('uses a harness-owned fallback when discovery is unavailable', () => {
    expect(modelsFromAcp({}, fallback)).toEqual([fallback])
  })
})
