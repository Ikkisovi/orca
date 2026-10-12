import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { Worktree } from './workspace-list-sections'
import { areWorktreeListsEqual, areWorktreesEqual } from './worktree-list-snapshot'

function agent(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'agent-1',
    parentPaneKey: null,
    state: 'working',
    agentType: 'codex',
    prompt: 'fix mobile lag',
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 100,
    updatedAt: 200,
    ...overrides
  }
}

function done(
  outcome: 'success' | 'failure',
  stateStartedAt = 1
): NonNullable<RuntimeWorktreeAgentRow['mainAgent']> {
  return { state: 'done', outcome, stateStartedAt }
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  const worktreePath = join('/tmp', 'orca', 'worktrees', 'manta')
  return {
    worktreeId: `repo-1::${worktreePath}`,
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature/mobile-lag',
    displayName: 'manta',
    workspaceStatus: 'in-progress',
    path: worktreePath,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    preview: '$ codex',
    unread: false,
    lastOutputAt: 1234,
    isPinned: false,
    isActive: false,
    linkedPR: null,
    linkedIssue: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    comment: '',
    status: 'active',
    agents: [],
    ...overrides
  }
}

describe('areWorktreeListsEqual', () => {
  it('treats cloned snapshots with the same visible fields as equal', () => {
    const first = [worktree({ agents: [agent()] })]
    const second = [worktree({ agents: [agent()] })]

    expect(areWorktreeListsEqual(first, second)).toBe(true)
  })

  it('detects order and field changes that affect the host list', () => {
    const first = [worktree({ worktreeId: 'a' }), worktree({ worktreeId: 'b' })]
    const reordered = [worktree({ worktreeId: 'b' }), worktree({ worktreeId: 'a' })]
    const renamed = [
      worktree({ worktreeId: 'a', displayName: 'renamed' }),
      worktree({ worktreeId: 'b' })
    ]

    expect(areWorktreeListsEqual(first, reordered)).toBe(false)
    expect(areWorktreeListsEqual(first, renamed)).toBe(false)
  })

  it('detects host visibility field changes', () => {
    expect(areWorktreeListsEqual([worktree()], [worktree({ isArchived: true })])).toBe(false)
    expect(areWorktreeListsEqual([worktree()], [worktree({ isMainWorktree: true })])).toBe(false)
    expect(areWorktreeListsEqual([worktree()], [worktree({ hasHostSidebarActivity: true })])).toBe(
      false
    )
  })

  it('detects workspace status changes', () => {
    expect(
      areWorktreeListsEqual(
        [worktree({ workspaceStatus: 'in-progress' })],
        [worktree({ workspaceStatus: 'in-review' })]
      )
    ).toBe(false)
  })

  it('detects manual order changes', () => {
    expect(
      areWorktreeListsEqual(
        [worktree({ manualOrder: 10, sortOrder: 1 })],
        [worktree({ manualOrder: 20, sortOrder: 1 })]
      )
    ).toBe(false)
  })

  it('detects desktop ordering field changes', () => {
    expect(
      areWorktreeListsEqual(
        [worktree({ lastActivityAt: 10, createdAt: 1 })],
        [worktree({ lastActivityAt: 20, createdAt: 1 })]
      )
    ).toBe(false)
    expect(
      areWorktreeListsEqual(
        [worktree({ lastActivityAt: 10, createdAt: 1 })],
        [worktree({ lastActivityAt: 10, createdAt: 2 })]
      )
    ).toBe(false)
  })

  it('detects resume host and terminal platform changes', () => {
    expect(areWorktreeListsEqual([worktree()], [worktree({ hostId: 'ssh:box' })])).toBe(false)
    expect(
      areWorktreeListsEqual(
        [worktree({ terminalPlatform: 'win32' })],
        [worktree({ terminalPlatform: 'linux' })]
      )
    ).toBe(false)
  })

  it('detects lineage changes', () => {
    const base = worktree({ worktreeId: 'child', parentWorktreeId: 'parent-a' })
    const changedParent = worktree({ worktreeId: 'child', parentWorktreeId: 'parent-b' })
    const changedChildren = worktree({
      worktreeId: 'child',
      parentWorktreeId: 'parent-a',
      childWorktreeIds: ['grandchild']
    })

    expect(areWorktreeListsEqual([base], [changedParent])).toBe(false)
    expect(areWorktreeListsEqual([base], [changedChildren])).toBe(false)
  })

  it('detects lineage instance changes', () => {
    const base = worktree({
      worktreeId: 'child',
      parentWorktreeId: 'parent',
      worktreeInstanceId: 'child-instance',
      lineageWorktreeInstanceId: 'child-instance',
      parentWorktreeInstanceId: 'parent-instance'
    })
    const changedParentInstance = worktree({
      worktreeId: 'child',
      parentWorktreeId: 'parent',
      worktreeInstanceId: 'child-instance',
      lineageWorktreeInstanceId: 'child-instance',
      parentWorktreeInstanceId: 'new-parent-instance'
    })

    expect(areWorktreeListsEqual([base], [changedParentInstance])).toBe(false)
  })

  it('detects agent status changes', () => {
    const first = [worktree({ agents: [agent({ state: 'working' })] })]
    const second = [worktree({ agents: [agent({ state: 'waiting' })] })]

    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('detects a verdict change that leaves the interrupted flag as it was', () => {
    const first = [worktree({ agents: [agent({ state: 'done', mainAgent: done('success') })] })]
    const second = [worktree({ agents: [agent({ state: 'done', mainAgent: done('failure') })] })]

    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('detects a main agent failing while its subagents keep the row working', () => {
    const first = [worktree({ agents: [agent({ state: 'working' })] })]
    const second = [worktree({ agents: [agent({ state: 'working', mainAgent: done('failure') })] })]

    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('detects the main agent clock moving, which dates a failure', () => {
    const at = (stateStartedAt: number) => [
      worktree({
        agents: [agent({ state: 'working', mainAgent: done('failure', stateStartedAt) })]
      })
    ]

    expect(areWorktreeListsEqual(at(1), at(2))).toBe(false)
    expect(areWorktreeListsEqual(at(1), at(1))).toBe(true)
  })

  // The host drops Stopping on letting go of a session without moving any clock the row carries.
  it("detects the host's Stopping coming and going with nothing else moved", () => {
    const stopping = (value: boolean) => [
      worktree({
        agents: [
          agent({
            mainAgent: { state: 'working', stateStartedAt: 1, ...(value ? { stopping: true } : {}) }
          })
        ]
      })
    ]

    expect(areWorktreeListsEqual(stopping(false), stopping(true))).toBe(false)
    expect(areWorktreeListsEqual(stopping(true), stopping(false))).toBe(false)
    expect(areWorktreeListsEqual(stopping(true), stopping(true))).toBe(true)
  })

  it('detects monitoring mode changes within working', () => {
    const first = [worktree({ agents: [agent({ state: 'working' })] })]
    const second = [worktree({ agents: [agent({ state: 'working', workingMode: 'monitoring' })] })]

    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('detects workspace monitoring mode changes within working', () => {
    const first = [worktree({ status: 'working' })]
    const second = [worktree({ status: 'working', workingMode: 'monitoring' })]

    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('treats missing and empty agent arrays as equivalent for rendering', () => {
    const first = [worktree({ agents: undefined })]
    const second = [worktree({ agents: [] })]

    expect(areWorktreeListsEqual(first, second)).toBe(true)
  })
})

// Every field, so a field added to Worktree or the agent row fails to compile here until it has a
// changed value below; list rows skip renders on this equality, so a missed field freezes a row.
const everyAgentField: Required<RuntimeWorktreeAgentRow> = {
  paneKey: 'agent-1',
  parentPaneKey: 'agent-0',
  state: 'working',
  workingMode: 'monitoring',
  agentType: 'codex',
  prompt: 'fix mobile lag',
  taskTitle: 'Mobile lag',
  displayName: 'Codex',
  lastAssistantMessage: 'Done',
  toolName: 'Bash',
  toolInput: 'ls',
  interrupted: false,
  mainAgent: { state: 'working', stateStartedAt: 1 },
  stateStartedAt: 100,
  updatedAt: 200,
  restoredUnconfirmed: false,
  structuredHostOwned: true
}
const changedAgentFields: { [K in keyof RuntimeWorktreeAgentRow]-?: RuntimeWorktreeAgentRow[K] } = {
  paneKey: 'agent-2',
  parentPaneKey: null,
  state: 'done',
  workingMode: undefined,
  agentType: 'claude',
  prompt: 'other prompt',
  taskTitle: null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: true,
  mainAgent: { state: 'done', stateStartedAt: 1 },
  stateStartedAt: 101,
  updatedAt: 201,
  restoredUnconfirmed: true,
  structuredHostOwned: undefined
}
const everyWorktreeField: Required<Worktree> = {
  sectionListKey: 'all:a',
  workspaceKind: 'git',
  worktreeId: 'a',
  repoId: 'repo-1',
  hostId: 'local',
  terminalPlatform: 'darwin',
  hostContextLabel: 'Mac',
  hostContextHostId: 'local',
  hostContextHealthLabel: 'Disconnected',
  repo: 'orca',
  branch: 'feature/a',
  displayName: 'a',
  workspaceStatus: 'in-progress',
  sortOrder: 1,
  manualOrder: 1,
  lastActivityAt: 1,
  createdAt: 1,
  path: 'a',
  isArchived: false,
  isMainWorktree: false,
  hasHostSidebarActivity: false,
  worktreeInstanceId: 'i-1',
  lineageWorktreeInstanceId: 'l-1',
  parentWorktreeInstanceId: 'p-1',
  parentWorktreeId: 'parent',
  childWorktreeIds: ['child'],
  lineageDepth: 1,
  lineageChildCount: 1,
  lineageCollapsed: false,
  isLastLineageChild: false,
  liveTerminalCount: 1,
  hasAttachedPty: true,
  preview: '$ codex',
  unread: false,
  lastOutputAt: 1,
  isPinned: false,
  isActive: false,
  linkedPR: { number: 1, state: 'open' },
  linkedIssue: 1,
  linkedLinearIssue: 'STA-1',
  linkedGitLabMR: 1,
  linkedGitLabIssue: 1,
  comment: 'note',
  status: 'active',
  workingMode: 'monitoring',
  agents: [everyAgentField]
}
const changedWorktreeFields: { [K in keyof Worktree]-?: Worktree[K] } = {
  sectionListKey: 'pinned:a',
  workspaceKind: 'folder-workspace',
  worktreeId: 'b',
  repoId: 'repo-2',
  hostId: 'ssh:box',
  terminalPlatform: 'linux',
  hostContextLabel: 'Box',
  hostContextHostId: 'ssh:box',
  hostContextHealthLabel: undefined,
  repo: 'other',
  branch: 'feature/b',
  displayName: 'b',
  workspaceStatus: 'done',
  sortOrder: 2,
  manualOrder: 2,
  lastActivityAt: 2,
  createdAt: 2,
  path: 'b',
  isArchived: true,
  isMainWorktree: true,
  hasHostSidebarActivity: true,
  worktreeInstanceId: 'i-2',
  lineageWorktreeInstanceId: 'l-2',
  parentWorktreeInstanceId: 'p-2',
  parentWorktreeId: null,
  childWorktreeIds: [],
  lineageDepth: 0,
  lineageChildCount: 0,
  lineageCollapsed: true,
  isLastLineageChild: true,
  liveTerminalCount: 2,
  hasAttachedPty: false,
  preview: '$ claude',
  unread: true,
  lastOutputAt: 2,
  isPinned: true,
  isActive: true,
  linkedPR: { number: 1, state: 'merged' },
  linkedIssue: 2,
  linkedLinearIssue: 'STA-2',
  linkedGitLabMR: 2,
  linkedGitLabIssue: 2,
  comment: 'other note',
  status: 'working',
  workingMode: undefined,
  agents: []
}

describe('areWorktreesEqual', () => {
  it('equates value-equal copies', () => {
    expect(areWorktreesEqual(everyWorktreeField, structuredClone(everyWorktreeField))).toBe(true)
  })

  it.each(Object.entries(changedWorktreeFields))('detects a change to %s', (key, value) => {
    expect(areWorktreesEqual(everyWorktreeField, { ...everyWorktreeField, [key]: value })).toBe(
      false
    )
  })

  it.each(Object.entries(changedAgentFields))('detects a change to agent %s', (key, value) => {
    const edited = { ...everyWorktreeField, agents: [{ ...everyAgentField, [key]: value }] }
    expect(areWorktreesEqual(everyWorktreeField, edited)).toBe(false)
  })
})
