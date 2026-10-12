import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnownWorktreeById: vi.fn(),
  setActiveWorktree: vi.fn(),
  launchAgentInNewTab: vi.fn(),
  getExecutionHostIdForWorktree: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      settings: null,
      getKnownWorktreeById: mocks.getKnownWorktreeById,
      setActiveWorktree: mocks.setActiveWorktree
    })
  }
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), message: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: mocks.getExecutionHostIdForWorktree
}))

import { launchDashboardAgent } from './launch-dashboard-agent'

describe('launchDashboardAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getExecutionHostIdForWorktree.mockReturnValue('ssh:docs')
    mocks.getKnownWorktreeById.mockReturnValue({ id: 'folder:docs' })
    mocks.launchAgentInNewTab.mockReturnValue({
      surface: { kind: 'local-terminal', tabId: 'tab-1' }
    })
  })

  it('activates a folder or git workspace on its execution host before launching', () => {
    expect(launchDashboardAgent({ worktreeId: 'folder:docs', agent: 'codex' })).toBe(true)
    expect(mocks.getKnownWorktreeById).toHaveBeenCalledWith('folder:docs', 'ssh:docs')
    expect(mocks.setActiveWorktree).toHaveBeenCalledWith('folder:docs', 'ssh:docs')
    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith({
      requestId: expect.any(String),
      agent: 'codex',
      worktreeId: 'folder:docs',
      launchSource: 'unknown'
    })
  })

  // Pinned as it is (STA-10311, pre-existing): the popout bridge drops this answer, so a dashboard
  // "+" that cannot launch says nothing anywhere.
  it.each([
    ['an unknown workspace', () => mocks.getKnownWorktreeById.mockReturnValue(undefined)],
    ['a launch that opened nothing', () => mocks.launchAgentInNewTab.mockReturnValue(null)]
  ])('answers false for %s and shows no message', (_case, arrange) => {
    arrange()
    expect(launchDashboardAgent({ worktreeId: 'folder:docs', agent: 'codex' })).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.message).not.toHaveBeenCalled()
  })
})
