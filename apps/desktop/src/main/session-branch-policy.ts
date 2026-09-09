/** A live session only needs to block operations that would change the shared
 * checkout. Starting another session on the branch already checked out leaves
 * HEAD and every working-tree file untouched. */
export function liveSessionBlocksBranchSwitch(
  hasLiveSession: boolean,
  currentBranch: string | null,
  requestedBranch: string,
): boolean {
  return hasLiveSession && currentBranch !== requestedBranch
}
