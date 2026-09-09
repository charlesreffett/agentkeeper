export function activeBranchToInitialize(
  projectPath: string | null,
  selectedBranch: string,
  activeBranch: string | null | undefined,
): string | null {
  if (!projectPath || !activeBranch || selectedBranch === activeBranch) return null
  return activeBranch
}
