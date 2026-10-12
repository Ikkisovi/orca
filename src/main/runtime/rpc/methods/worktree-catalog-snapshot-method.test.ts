import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { WORKTREE_METHODS } from './worktree'
import { WORKTREE_VISIBILITY_SOURCE_DEFAULTS_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeWorktreePsSummary } from '../../../../shared/runtime-types'

function makeRuntime(...rows: RuntimeWorktreePsSummary[]) {
  const getWorktreePs = vi.fn().mockResolvedValue({
    worktrees: [],
    totalCount: 0,
    truncated: false
  })
  for (const row of rows) {
    getWorktreePs.mockResolvedValueOnce({ worktrees: [row], totalCount: 1, truncated: false })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worktree.ps reads only these two runtime members.
  return { getRuntimeId: () => 'test-runtime', getWorktreePs } as unknown as OrcaRuntimeService
}

describe('worktree.ps catalog snapshots', () => {
  it('preserves the exact legacy response when no snapshot field is sent', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const response = await dispatcher.dispatch({
      id: 'legacy',
      authToken: 'token',
      method: 'worktree.ps',
      params: { limit: 10_000 }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { worktrees: [], totalCount: 0, truncated: false }
    })
    expect((response as { result: unknown }).result).not.toHaveProperty('snapshotId')
  })

  it('returns a full snapshot followed by a tiny unchanged response', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const first = await dispatcher.dispatch({
      id: 'first',
      authToken: 'token',
      method: 'worktree.ps',
      params: { limit: 10_000, afterSnapshotId: null }
    })
    const snapshotId = (first as { result: { snapshotId: string } }).result.snapshotId

    const second = await dispatcher.dispatch({
      id: 'second',
      authToken: 'token',
      method: 'worktree.ps',
      params: { limit: 10_000, afterSnapshotId: snapshotId }
    })

    expect(snapshotId).toEqual(expect.any(String))
    expect(second).toMatchObject({
      ok: true,
      result: { unchanged: true, snapshotId }
    })
    expect(runtime.getWorktreePs).toHaveBeenCalledTimes(2)
  })

  it('gates source-default worktree projection by client capability', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    await dispatcher.dispatchStreaming(
      {
        id: 'legacy',
        authToken: 'token',
        method: 'worktree.ps',
        params: { limit: 10_000 }
      },
      () => {},
      { clientCapabilities: [] }
    )
    await dispatcher.dispatchStreaming(
      {
        id: 'current',
        authToken: 'token',
        method: 'worktree.ps',
        params: { limit: 10_000 }
      },
      () => {},
      { clientCapabilities: [WORKTREE_VISIBILITY_SOURCE_DEFAULTS_RUNTIME_CAPABILITY] }
    )
    await dispatcher.dispatchStreaming(
      {
        id: 'mobile',
        authToken: 'token',
        method: 'worktree.ps',
        params: { limit: 10_000, supportsWorktreeVisibilitySourceDefaults: true }
      },
      () => {},
      { clientCapabilities: [] }
    )

    expect(runtime.getWorktreePs).toHaveBeenNthCalledWith(1, 10_000, false)
    expect(runtime.getWorktreePs).toHaveBeenNthCalledWith(2, 10_000, true)
    expect(runtime.getWorktreePs).toHaveBeenNthCalledWith(3, 10_000, true)
  })
})

function psRow(overrides: Partial<RuntimeWorktreePsSummary> = {}): RuntimeWorktreePsSummary {
  return {
    worktreeId: 'repo-1::/w/a',
    repoId: 'repo-1',
    repo: 'repo',
    path: '/w/a',
    branch: 'feature',
    isArchived: false,
    isMainWorktree: false,
    hasHostSidebarActivity: true,
    parentWorktreeId: null,
    childWorktreeIds: [],
    displayName: 'a',
    workspaceStatus: 'in-progress',
    sortOrder: 0,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    comment: '',
    isPinned: false,
    isActive: false,
    unread: false,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    lastOutputAt: 1_700_000_031_000,
    preview: 'building…',
    status: 'working',
    agents: [],
    ...overrides
  }
}

async function poll(
  dispatcher: RpcDispatcher,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await dispatcher.dispatch({
    id: 'poll',
    authToken: 'token',
    method: 'worktree.ps',
    params
  })
  if (!response.ok || typeof response.result !== 'object' || response.result === null) {
    throw new Error(`worktree.ps failed: ${JSON.stringify(response)}`)
  }
  return { ...response.result }
}

describe('worktree.ps coarse activity', () => {
  // Same 30 s bucket, different chunk: only the per-chunk activity fields moved.
  const before = psRow({ lastOutputAt: 1_700_000_031_000, preview: 'step 1' })
  const after = psRow({ lastOutputAt: 1_700_000_039_000, preview: 'step 2' })

  it('keeps the snapshot id while only fine-grained activity changes', async () => {
    const dispatcher = new RpcDispatcher({
      runtime: makeRuntime(before, after),
      methods: WORKTREE_METHODS
    })
    const first = await poll(dispatcher, {
      limit: 10_000,
      afterSnapshotId: null,
      coarseActivity: true
    })
    const second = await poll(dispatcher, {
      limit: 10_000,
      afterSnapshotId: first.snapshotId,
      coarseActivity: true
    })

    const { preview: _preview, ...coarseRow } = before
    expect(first.worktrees).toEqual([{ ...coarseRow, lastOutputAt: 1_700_000_010_000 }])
    expect(second).toEqual({ unchanged: true, snapshotId: first.snapshotId })
  })

  it('still reports output that crosses a bucket boundary', async () => {
    const dispatcher = new RpcDispatcher({
      runtime: makeRuntime(before, psRow({ lastOutputAt: 1_700_000_071_000 })),
      methods: WORKTREE_METHODS
    })
    const first = await poll(dispatcher, {
      limit: 10_000,
      afterSnapshotId: null,
      coarseActivity: true
    })
    const second = await poll(dispatcher, {
      limit: 10_000,
      afterSnapshotId: first.snapshotId,
      coarseActivity: true
    })

    expect(second.snapshotId).not.toBe(first.snapshotId)
    expect(second.worktrees).toEqual([expect.objectContaining({ lastOutputAt: 1_700_000_070_000 })])
  })

  it('changes the snapshot id on every chunk without the param', async () => {
    const dispatcher = new RpcDispatcher({
      runtime: makeRuntime(before, after),
      methods: WORKTREE_METHODS
    })
    const first = await poll(dispatcher, { limit: 10_000, afterSnapshotId: null })
    const second = await poll(dispatcher, { limit: 10_000, afterSnapshotId: first.snapshotId })

    expect(second.snapshotId).not.toBe(first.snapshotId)
    expect(second.worktrees).toEqual([after])
  })

  it('returns rows untouched to callers without the param', async () => {
    const dispatcher = new RpcDispatcher({
      runtime: makeRuntime(before),
      methods: WORKTREE_METHODS
    })

    expect(await poll(dispatcher, { limit: 10_000 })).toEqual({
      worktrees: [before],
      totalCount: 1,
      truncated: false
    })
  })

  it('keeps a null lastOutputAt null', async () => {
    const dispatcher = new RpcDispatcher({
      runtime: makeRuntime(psRow({ lastOutputAt: null, preview: '' })),
      methods: WORKTREE_METHODS
    })
    const result = await poll(dispatcher, { limit: 10_000, coarseActivity: true })

    expect(result.worktrees).toEqual([expect.objectContaining({ lastOutputAt: null })])
  })
})
