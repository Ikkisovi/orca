import type {
  RuntimeWorktreePsResult,
  RuntimeWorktreePsSummary
} from '../../../shared/runtime-types'

// Why: mobile reads lastOutputAt only to rank "recent" rows and pick a resume fallback, so only
// rows whose activity lies within 30 s of each other can trade places.
export const COARSE_LAST_OUTPUT_AT_MS = 30_000

export type RuntimeWorktreePsCoarseSummary = Omit<RuntimeWorktreePsSummary, 'preview'>

export type RuntimeWorktreePsCoarseResult = Omit<RuntimeWorktreePsResult, 'worktrees'> & {
  worktrees: RuntimeWorktreePsCoarseSummary[]
}

/** Strips what moves on every PTY chunk: `preview` (never shown on mobile) and sub-bucket timing. */
export function coarsenWorktreePsActivity(
  result: RuntimeWorktreePsResult
): RuntimeWorktreePsCoarseResult {
  return {
    ...result,
    worktrees: result.worktrees.map(({ preview: _preview, ...row }) => ({
      ...row,
      lastOutputAt:
        row.lastOutputAt === null
          ? null
          : Math.floor(row.lastOutputAt / COARSE_LAST_OUTPUT_AT_MS) * COARSE_LAST_OUTPUT_AT_MS
    }))
  }
}
