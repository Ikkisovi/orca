import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { Worktree } from './workspace-list-sections'

export function areWorktreeListsEqual(
  left: readonly Worktree[],
  right: readonly Worktree[]
): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areWorktreesEqual(left[index]!, right[index]!)) {
      return false
    }
  }
  return true
}

// Covers every Worktree field: the catalog keeps its array on equality and list rows skip renders on it.
export function areWorktreesEqual(left: Worktree, right: Worktree): boolean {
  return (
    (left.sectionListKey ?? null) === (right.sectionListKey ?? null) &&
    (left.workspaceKind ?? null) === (right.workspaceKind ?? null) &&
    left.worktreeId === right.worktreeId &&
    left.repoId === right.repoId &&
    left.repo === right.repo &&
    left.branch === right.branch &&
    (left.hostId ?? null) === (right.hostId ?? null) &&
    (left.terminalPlatform ?? null) === (right.terminalPlatform ?? null) &&
    (left.hostContextLabel ?? null) === (right.hostContextLabel ?? null) &&
    (left.hostContextHostId ?? null) === (right.hostContextHostId ?? null) &&
    (left.hostContextHealthLabel ?? null) === (right.hostContextHealthLabel ?? null) &&
    left.displayName === right.displayName &&
    (left.workspaceStatus ?? null) === (right.workspaceStatus ?? null) &&
    (left.sortOrder ?? null) === (right.sortOrder ?? null) &&
    (left.manualOrder ?? null) === (right.manualOrder ?? null) &&
    (left.lastActivityAt ?? null) === (right.lastActivityAt ?? null) &&
    (left.createdAt ?? null) === (right.createdAt ?? null) &&
    left.path === right.path &&
    (left.isArchived ?? false) === (right.isArchived ?? false) &&
    (left.isMainWorktree ?? false) === (right.isMainWorktree ?? false) &&
    (left.hasHostSidebarActivity ?? false) === (right.hasHostSidebarActivity ?? false) &&
    (left.worktreeInstanceId ?? null) === (right.worktreeInstanceId ?? null) &&
    (left.lineageWorktreeInstanceId ?? null) === (right.lineageWorktreeInstanceId ?? null) &&
    (left.parentWorktreeInstanceId ?? null) === (right.parentWorktreeInstanceId ?? null) &&
    (left.parentWorktreeId ?? null) === (right.parentWorktreeId ?? null) &&
    areStringArraysEqual(left.childWorktreeIds ?? [], right.childWorktreeIds ?? []) &&
    (left.lineageDepth ?? null) === (right.lineageDepth ?? null) &&
    (left.lineageChildCount ?? null) === (right.lineageChildCount ?? null) &&
    (left.lineageCollapsed ?? false) === (right.lineageCollapsed ?? false) &&
    (left.isLastLineageChild ?? false) === (right.isLastLineageChild ?? false) &&
    left.liveTerminalCount === right.liveTerminalCount &&
    left.hasAttachedPty === right.hasAttachedPty &&
    left.preview === right.preview &&
    left.unread === right.unread &&
    (left.lastOutputAt ?? null) === (right.lastOutputAt ?? null) &&
    left.isPinned === right.isPinned &&
    (left.isActive ?? false) === (right.isActive ?? false) &&
    (left.linkedIssue ?? null) === (right.linkedIssue ?? null) &&
    (left.linkedLinearIssue ?? null) === (right.linkedLinearIssue ?? null) &&
    (left.linkedGitLabMR ?? null) === (right.linkedGitLabMR ?? null) &&
    (left.linkedGitLabIssue ?? null) === (right.linkedGitLabIssue ?? null) &&
    (left.comment ?? '') === (right.comment ?? '') &&
    (left.status ?? null) === (right.status ?? null) &&
    (left.workingMode ?? null) === (right.workingMode ?? null) &&
    arePullRequestsEqual(left.linkedPR, right.linkedPR) &&
    areAgentRowsEqual(left.agents ?? [], right.agents ?? [])
  )
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function arePullRequestsEqual(left: Worktree['linkedPR'], right: Worktree['linkedPR']): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.number === right.number && left.state === right.state
}

function areAgentRowsEqual(
  left: readonly RuntimeWorktreeAgentRow[],
  right: readonly RuntimeWorktreeAgentRow[]
): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!
    const b = right[index]!
    if (
      a.paneKey !== b.paneKey ||
      a.parentPaneKey !== b.parentPaneKey ||
      a.state !== b.state ||
      a.workingMode !== b.workingMode ||
      a.agentType !== b.agentType ||
      a.prompt !== b.prompt ||
      a.taskTitle !== b.taskTitle ||
      a.displayName !== b.displayName ||
      a.lastAssistantMessage !== b.lastAssistantMessage ||
      a.toolName !== b.toolName ||
      a.toolInput !== b.toolInput ||
      a.interrupted !== b.interrupted ||
      !areMainAgentsEqual(a.mainAgent, b.mainAgent) ||
      a.stateStartedAt !== b.stateStartedAt ||
      a.updatedAt !== b.updatedAt ||
      (a.restoredUnconfirmed ?? false) !== (b.restoredUnconfirmed ?? false) ||
      a.structuredHostOwned !== b.structuredHostOwned
    ) {
      return false
    }
  }
  return true
}

function areMainAgentsEqual(
  left: RuntimeWorktreeAgentRow['mainAgent'],
  right: RuntimeWorktreeAgentRow['mainAgent']
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return (
    left.state === right.state &&
    left.outcome === right.outcome &&
    left.stateStartedAt === right.stateStartedAt &&
    left.stopping === right.stopping
  )
}
