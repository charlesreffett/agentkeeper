export interface ClaudeModel {
  value: string
  label: string      // Standard display name, e.g. "Opus 4.8 (most capable)"
  shortLabel: string // Compact form for tight button-group UIs, e.g. "opus"
}

// Single source of truth for available Claude models.
// To add a new model: append an entry here and in apps/desktop/src/main/pricing.ts.
export const CLAUDE_MODELS: ClaudeModel[] = [
  { value: 'claude-opus-4-8',           label: 'Opus 4.8 (most capable)', shortLabel: 'opus' },
  { value: 'claude-opus-4-7',           label: 'Opus 4.7',                shortLabel: 'opus 4.7' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6 (balanced)',   shortLabel: 'sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fast)',        shortLabel: 'haiku' },
]

// For role editors where an empty value means "inherit from session".
export const CLAUDE_MODELS_WITH_DEFAULT: ClaudeModel[] = [
  { value: '', label: 'Session default', shortLabel: 'default' },
  ...CLAUDE_MODELS,
]
