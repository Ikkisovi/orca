import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { createTabsSliceMockApi } from '../store/slices/tabs-slice-test-harness'
import { createTestStore } from '../store/slices/store-test-helpers'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentStatusModule>()),
  detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
}))

const testStore = vi.hoisted(() => {
  const ref: { current: ReturnType<typeof createTestStore> | null } = { current: null }
  return ref
})
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => {
      if (!testStore.current) {
        throw new Error('no test store')
      }
      return testStore.current.getState()
    }
  }
}))
const callRuntimeRpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params: Record<string, unknown>) => Promise<unknown>>()
)
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callRuntimeRpc
}))

createTabsSliceMockApi()

const { launchAgentThroughHost, startPaneLaunch } = await import('./agent-launch-through-host')
const { agentLaunchPaneSpawnHold } = await import('./agent-launch-pane-spawn-hold')
const { agentLaunchPanePrompt } = await import('./agent-launch-pane-prompt')

const WT = 'repo1::/tmp/feature'
let store: ReturnType<typeof createTestStore>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function rpcError(code: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({
    id: 'desktop-ipc',
    ok: false,
    error: { code, message: code },
    _meta: { runtimeId: 'runtime-1' }
  })
}

function paneResult(paneKey: string) {
  return {
    outcome: { kind: 'pane', paneKey },
    worktreeId: WT,
    receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'x' }
  }
}

function launchTab(tabId: string) {
  return store.getState().tabsByWorktree[WT]?.find((tab) => tab.id === tabId)
}

function lastParams(): Record<string, unknown> {
  return callRuntimeRpc.mock.calls.at(-1)?.[2] ?? {}
}

function lastPaneKey(): string {
  return String(lastParams().paneKey)
}

function launch() {
  return launchAgentThroughHost({
    agent: 'claude',
    worktreeId: WT,
    groupId: store.getState().activeGroupIdByWorktree[WT],
    prompt: 'fix the failing checks',
    agentArgs: null,
    launchSource: 'source_control_recovery'
  })
}

beforeEach(() => {
  store = createTestStore()
  testStore.current = store
  callRuntimeRpc.mockReset()
  store.getState().setActiveWorktree(WT)
  store.getState().createUnifiedTab(WT, 'terminal')
})

describe('a desktop launch through the host', () => {
  it('shows its tab at the click, in its split, waiting for the host before it spawns', () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)

    const { tabId } = launch()

    const tab = launchTab(tabId)!
    expect(tab).toMatchObject({ ptyId: null, launchAgent: 'claude' })
    const leafId = tab.agentLaunchPane!.leafId
    expect(agentLaunchPaneSpawnHold(tab.id, leafId)).not.toBeNull()
    expect(agentLaunchPanePrompt(tab.id)).toBe('fix the failing checks')
    expect(store.getState().activeTabId).toBe(tabId)
    // No prompt: the window pastes it, as main does, once the agent runs.
    expect(callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'agent.launchReplay', {
      agent: 'claude',
      target: { kind: 'existing', worktree: `id:${WT}` },
      agentArgs: null,
      launchSource: 'source_control_recovery',
      spawnTrigger: 'window-pane',
      operationId: expect.stringMatching(/^\d+-[0-9a-f]{32}$/),
      paneKey: `${tabId}:${leafId}`
    })
  })

  it('names every click as its own operation', () => {
    callRuntimeRpc.mockReturnValue(new Promise(() => {}))
    launch()
    const first = lastParams()
    launch()
    const second = lastParams()
    expect(second.operationId).not.toBe(first.operationId)
    expect(second.paneKey).not.toBe(first.paneKey)
  })

  it('lets its pane start the planned agent once the host answers', async () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, outcome } = launch()
    const leafId = launchTab(tabId)!.agentLaunchPane!.leafId

    reply.resolve(paneResult(lastPaneKey()))

    await expect(outcome).resolves.toEqual({ kind: 'started' })
    expect(launchTab(tabId)).toBeDefined()
    expect(agentLaunchPaneSpawnHold(tabId, leafId)).toBeNull()
  })

  it.each([
    'agent_session_operation_conflict',
    'agent_session_operation_unknown',
    'worktree_not_found'
  ])('closes its tab on a %s refusal before the pane could spawn a shell', async (code) => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, outcome } = launch()
    const leafId = launchTab(tabId)!.agentLaunchPane!.leafId
    let heldAtClose: boolean | null = null
    const unsubscribe = store.subscribe(() => {
      if (heldAtClose === null && !launchTab(tabId)) {
        heldAtClose = agentLaunchPaneSpawnHold(tabId, leafId) !== null
      }
    })

    reply.reject(rpcError(code))

    await expect(outcome).resolves.toEqual({ kind: 'not-started', code, message: code })
    unsubscribe()
    expect(launchTab(tabId)).toBeUndefined()
    expect(heldAtClose).toBe(true)
  })

  it("sends a '+' tab's own prompt and WSL-shell rules with the prompt its command carries", () => {
    callRuntimeRpc.mockReturnValue(new Promise(() => {}))
    startPaneLaunch({
      agent: 'codex',
      worktreeId: WT,
      prompt: 'fix it',
      windowRules: true,
      carriedPrompt: { text: 'fix it', delivery: 'draft' }
    })
    expect(lastParams()).toMatchObject({
      promptCarry: 'window',
      wslShellRule: 'window',
      prompt: { text: 'fix it', delivery: 'draft' },
      spawnTrigger: 'window-pane'
    })
  })

  // Why: the close was the user's own, as on the phone's "+".
  it('says nothing more when the user closed the tab while it started', async () => {
    callRuntimeRpc.mockRejectedValueOnce(rpcError('agent_launch_tab_closed'))
    await expect(launch().outcome).resolves.toEqual({ kind: 'closed-by-user' })
  })
})
