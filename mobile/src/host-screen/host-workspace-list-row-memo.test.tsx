import { createElement, Fragment, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Section, Worktree } from '../worktree/workspace-list-types'

const { rowRenders } = vi.hoisted(() => ({ rowRenders: vi.fn() }))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  // Renders every row through the list's own renderItem, as a mounted SectionList would.
  SectionList: ({
    sections,
    keyExtractor,
    renderItem
  }: {
    sections: Section[]
    keyExtractor: (item: Worktree) => string
    renderItem: (info: { item: Worktree }) => ReactNode
  }) =>
    sections.flatMap((section) =>
      section.data.map((item) =>
        createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item }))
      )
    ),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  Bell: 'Bell',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  GitBranch: 'GitBranch',
  GitPullRequest: 'GitPullRequest',
  Monitor: 'Monitor',
  Pin: 'Pin',
  Server: 'Server'
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('../components/AgentSpinner', () => ({ AgentSpinner: () => null }))
vi.mock('../components/MobileRepoIcon', () => ({ MobileRepoIcon: () => null }))
vi.mock('../components/WorktreeAgentList', () => ({ WorktreeAgentList: () => null }))
// The row always renders the glyphs, so each call is one row render, named by its comment.
vi.mock('../components/WorktreeMetaGlyphs', () => ({
  prStateColor: () => '#000000',
  WorktreeMetaGlyphs: ({ comment }: { comment?: string }) => {
    rowRenders(comment)
    return null
  }
}))
vi.mock('../components/AuthFailedBanner', () => ({ AuthFailedBanner: 'AuthFailedBanner' }))
vi.mock('../components/HostDiagnosticsLink', () => ({ HostDiagnosticsLink: 'HostDiagnosticsLink' }))
vi.mock('../components/HostRouteNoticeBanner', () => ({
  HostRouteNoticeBanner: 'HostRouteNoticeBanner'
}))
vi.mock('../components/MobileSearchField', () => ({ MobileSearchField: 'MobileSearchField' }))
vi.mock('../components/NewWorkspaceFab', () => ({
  NewWorkspaceFab: 'NewWorkspaceFab',
  FAB_SIZE: 56
}))
vi.mock('../worktree/host-workspace-list-states', () => ({
  HostWorkspaceListStates: 'HostWorkspaceListStates'
}))

import { buildSections } from '../worktree/workspace-list-sections'
import { HostWorkspaceList } from './host-workspace-list'

function worktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    worktreeId: `repo-1::${id}`,
    repoId: 'repo-1',
    repo: 'orca',
    branch: `feature/${id}`,
    displayName: id,
    path: id,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    preview: '$ codex',
    unread: false,
    isPinned: false,
    linkedPR: null,
    comment: id,
    status: 'active',
    ...overrides
  }
}

type ListInputs = {
  worktrees: Worktree[]
  now?: number
  isReadOnly?: boolean
  groupMode?: 'none' | 'repo'
  openWorktreeSession?: (item: Worktree) => void
}

const stableCallbacks = {
  openWorktreeSession: () => {},
  openNewWorktreeModal: () => {},
  setActionTarget: () => {},
  toggleWorktreeLineage: () => {},
  onScrollToIndexFailed: () => {},
  onRefresh: () => {}
}
const stableRefs = {
  sectionListRef: { current: null },
  repoIconsByName: new Map(),
  uniqueRepoColors: new Map([['orca', '#336699']]),
  collapsedGroups: new Set<string>()
}

function listProps(inputs: ListInputs) {
  const groupMode = inputs.groupMode ?? 'none'
  // Each poll re-parses the payload, so rows are fresh objects even when nothing changed.
  const polled: Worktree[] = JSON.parse(JSON.stringify(inputs.worktrees))
  const sections = buildSections(
    polled,
    'name',
    { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false },
    '',
    groupMode,
    new Set()
  )
  const controller = {
    actions: {
      openWorktreeSession: inputs.openWorktreeSession ?? stableCallbacks.openWorktreeSession,
      openNewWorktreeModal: stableCallbacks.openNewWorktreeModal
    },
    activeWorktreeScroll: {
      sectionListRef: stableRefs.sectionListRef,
      onScrollToIndexFailed: stableCallbacks.onScrollToIndexFailed
    },
    catalog: { refreshing: false, onRefresh: stableCallbacks.onRefresh },
    connState: 'connected',
    contentMaxWidth: 600,
    displayWorktrees: polled,
    embedded: true,
    forceReconnectHost: null,
    hostId: 'host-1',
    insets: { bottom: 0 },
    isReadOnly: inputs.isReadOnly ?? false,
    isWideLayout: false,
    noticeParam: undefined,
    now: inputs.now ?? 1_000,
    reconnectAttempts: 0,
    relayRecovery: { pairingRejected: false },
    routeNotice: '',
    router: { push: () => {} },
    sectionsResult: {
      rawSections: sections,
      sections,
      uniqueRepoColors: stableRefs.uniqueRepoColors
    },
    setDismissedNotice: () => {},
    settings: {
      activeFilterCount: 0,
      toggleCollapsed: () => {},
      toggleWorktreeLineage: stableCallbacks.toggleWorktreeLineage
    },
    state: {
      actionError: '',
      setActionError: () => {},
      setActionTarget: stableCallbacks.setActionTarget,
      catalogError: null,
      collapsedGroups: stableRefs.collapsedGroups,
      groupMode,
      repoIconsByName: stableRefs.repoIconsByName,
      search: '',
      showSearch: false,
      worktreesLoaded: true
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: children other than WorktreeListRow are mocked, so the list reads only the controller fields named above.
  return { controller } as unknown as Parameters<typeof HostWorkspaceList>[0]
}

const rows = [worktree('a'), worktree('b'), worktree('c')]

function renderedRows(): (string | undefined)[] {
  return rowRenders.mock.calls.map(([comment]) => comment)
}

describe('host list rows across polls', () => {
  let tree: ReactTestRenderer | null = null

  function mount(inputs: ListInputs): void {
    act(() => {
      tree = create(createElement(HostWorkspaceList, listProps(inputs)))
    })
    rowRenders.mockClear()
  }

  function poll(inputs: ListInputs): void {
    act(() => tree!.update(createElement(HostWorkspaceList, listProps(inputs))))
  }

  beforeEach(() => rowRenders.mockClear())
  afterEach(() => {
    act(() => tree?.unmount())
    tree = null
  })

  it('re-renders only the row whose worktree changed', () => {
    mount({ worktrees: rows })
    poll({ worktrees: [rows[0]!, { ...rows[1]!, preview: 'Running tests' }, rows[2]!] })
    expect(renderedRows()).toEqual(['b'])
  })

  it('re-renders nothing when every row is equal by value', () => {
    mount({ worktrees: rows })
    poll({ worktrees: rows })
    expect(renderedRows()).toEqual([])
  })

  it('re-renders the rows whose selection or lineage changed', () => {
    mount({ worktrees: rows })
    poll({ worktrees: [{ ...rows[0]!, isActive: true }, rows[1]!, rows[2]!] })
    expect(renderedRows()).toEqual(['a'])

    rowRenders.mockClear()
    poll({
      worktrees: [{ ...rows[0]!, isActive: true }, rows[1]!, { ...rows[2]!, unread: true }]
    })
    expect(renderedRows()).toEqual(['c'])
  })

  it('re-renders every row when a shared prop changes', () => {
    mount({ worktrees: rows })
    // `now` drives each agent row's relative time; the list's 30 s tick must still reach rows.
    poll({ worktrees: rows, now: 31_000 })
    expect(renderedRows()).toEqual(['a', 'b', 'c'])

    rowRenders.mockClear()
    poll({ worktrees: rows, now: 31_000, isReadOnly: true })
    expect(renderedRows()).toEqual(['a', 'b', 'c'])

    rowRenders.mockClear()
    poll({ worktrees: rows, now: 31_000, isReadOnly: true, groupMode: 'repo' })
    expect(renderedRows()).toEqual(['a', 'b', 'c'])
  })

  it('re-renders every row when a callback identity changes, so none presses a stale one', () => {
    mount({ worktrees: rows })
    const opened: string[] = []
    poll({ worktrees: rows, openWorktreeSession: (item) => opened.push(item.worktreeId) })
    expect(renderedRows()).toEqual(['a', 'b', 'c'])

    const [first] = tree!.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.delayLongPress === 400
    )
    act(() => first!.props.onPress())
    expect(opened).toEqual(['repo-1::a'])
  })
})
