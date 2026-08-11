/** True when a spawned binary couldn't be found at all (ENOENT) — the harness
 *  can't run regardless of auth/config, and the user-facing message should say
 *  so instead of reporting a cryptic spawn error. */
export function isMissingBinary(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
