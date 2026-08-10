// Unreleased/experimental renderer toggles. Flip here; no settings UI yet.
export const featureFlags = {
  // T3-Chat-style multi-harness rail in the model popover. Lets a draft
  // session pick which harness to run on, replacing the old Settings selector.
  // Kept off in production until the harness catalog UX is finished.
  harnessRail: import.meta.env.DEV,
} as const
