/**
 * A launch whose pane the desktop window laid out and starts itself (`spawnTrigger: 'window-pane'`).
 * The host answers without waiting on the pane; the pane's spawn runs the host's plan, and its
 * commit, failure or close settles the launch record. Driven through the method's handler with the
 * shared runtime stub and the real durable ledger.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import type { AgentSessionOperationRow } from '../../../../shared/agent-session-operation-ledger'
import {
  markAgentLaunchesClosedByUser,
  resetAgentLaunchPanesForTests,
  resolveAgentLaunchPaneVerdict,
  type AgentLaunchPaneSpawnVerdict
} from '../../../agent-launch/agent-launch-pane-attachment'
import type { AgentSessionRecordStore } from '../../agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../agent-session-record-store-test-harness'
import type { RpcContext } from '../core'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import {
  methodNamed,
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore
} from './agent-launch.test-fixture'
import { agentLaunchOperationCallerKey } from './agent-launch-replay'

vi.mock('./agent-launch-terminal-prompt', () => ({
  deliverTerminalAgentLaunchPrompt: vi.fn(async () => true)
}))

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const AGENT_LAUNCH_REPLAY = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launchReplay')

const TAB_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const LEAF_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const DESKTOP: Partial<RpcContext> = {
  caller: DESKTOP_RPC_CALLER,
  clientKind: 'runtime',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
}
const CALLER_KEY = agentLaunchOperationCallerKey({ caller: DESKTOP_RPC_CALLER })

let directory: string
let store: AgentSessionRecordStore
let operationCounter = 0
let operationId: string

beforeEach(async () => {
  operationCounter += 1
  operationId = `${Date.now()}-${operationCounter.toString(16).padStart(32, '0')}`
  directory = await mkdtemp(join(tmpdir(), 'agent-launch-window-pane-'))
  store = await openTestAgentSessionRecordStore(directory)
  setAgentLaunchRecordStore(store)
})

afterEach(async () => {
  setAgentLaunchRecordStore(null)
  resetAgentLaunchPanesForTests()
  await rm(directory, { recursive: true, force: true })
})

function host() {
  return Object.assign(runtimeStub({ settings: {} }), {
    planPaneAgentTerminal: vi.fn(async (_selector: string, opts: Record<string, unknown>) => ({
      ...opts,
      command: 'claude'
    }))
  })
}

type Host = ReturnType<typeof host>

function launch(
  runtime: Host,
  params: Record<string, unknown> = {},
  context: Partial<RpcContext> = DESKTOP
): Promise<AgentLaunchResult> {
  return AGENT_LAUNCH_REPLAY.handler(
    AGENT_LAUNCH_REPLAY.params.parse({
      agent: 'claude',
      target: { kind: 'existing', worktree: 'id:wt-7' },
      operationId,
      paneKey: PANE_KEY,
      spawnTrigger: 'window-pane',
      ...params
    }),
    rpcContext(runtime, context)
  )
}

async function paneSpawn(runtime: Host): Promise<AgentLaunchPaneSpawnVerdict | 'unowned'> {
  return (
    (await resolveAgentLaunchPaneVerdict({ worktreeId: 'wt-7', paneKey: PANE_KEY }, (key) =>
      runtime.hasLiveTerminalForPaneKey(key)
    )) ?? 'unowned'
  )
}

async function planned(runtime: Host) {
  const verdict = await paneSpawn(runtime)
  if (verdict === 'unowned' || verdict.kind !== 'launch') {
    throw new Error(`expected the pane to start the planned agent, got ${JSON.stringify(verdict)}`)
  }
  return verdict.launch
}

function row(): AgentSessionOperationRow | null {
  return store.getOperationRow(CALLER_KEY, operationId)
}

async function untilRecorded(status: AgentSessionOperationRow['outcome']['status']): Promise<void> {
  const deadline = Date.now() + 2_000
  while (row()?.outcome.status !== status) {
    if (Date.now() > deadline) {
      throw new Error(`the launch row never reached ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('a launch the window pane starts', () => {
  it('answers before the pane spawns, and hands the pane the plan without spawning', async () => {
    const runtime = host()

    const result = await launch(runtime)

    expect(result.outcome).toEqual({ kind: 'pane', paneKey: PANE_KEY })
    expect(runtime.createTerminal).not.toHaveBeenCalled()
    expect(runtime.planPaneAgentTerminal).toHaveBeenCalledWith(
      'id:wt-7',
      expect.objectContaining({ startupAgent: 'claude' })
    )
    expect((await planned(runtime)).plan).toMatchObject({ command: 'claude' })
    // A pane that never spawns leaves the answer given and the record open.
    expect(row()?.outcome.status).toBe('unknown')
  })

  it("records the pane's terminal once its spawn commits", async () => {
    const runtime = host()
    await launch(runtime)

    ;(await planned(runtime)).committed({ id: 'pty-1', incarnationId: 'inc-1' })

    await untilRecorded('succeeded')
    expect(row()?.outcome).toMatchObject({
      status: 'succeeded',
      launch: {
        outcome: {
          kind: 'terminal',
          handle: 'pty-1',
          paneKey: PANE_KEY,
          ptyId: 'pty-1',
          incarnationId: 'inc-1'
        }
      }
    })
    expect(await paneSpawn(runtime)).toBe('unowned')
  })

  it('records a spawn that failed as a launch that did not start', async () => {
    const runtime = host()
    await launch(runtime)

    ;(await planned(runtime)).failed(new Error('spawn failed'))

    await untilRecorded('failed')
  })

  it('records a pane the user closed before it spawned, and never gives it a shell', async () => {
    const runtime = host()
    await launch(runtime)
    await planned(runtime)

    markAgentLaunchesClosedByUser('wt-7', { kind: 'tab', tabId: TAB_ID })

    await untilRecorded('failed')
    expect(row()?.outcome).toMatchObject({ code: 'agent_launch_tab_closed' })
  })

  describe('a replay of the same click', () => {
    it('gets the first answer while the plan waits on its pane', async () => {
      const runtime = host()
      const first = await launch(runtime)

      await expect(launch(runtime)).resolves.toEqual(first)
      expect(runtime.planPaneAgentTerminal).toHaveBeenCalledTimes(1)
    })

    it("gets the recorded terminal once the pane's spawn settled", async () => {
      const runtime = host()
      await launch(runtime)
      ;(await planned(runtime)).committed({ id: 'pty-1' })
      await untilRecorded('succeeded')

      const replayed = await launch(runtime)

      expect(replayed.outcome).toMatchObject({ kind: 'terminal', ptyId: 'pty-1' })
      expect(runtime.planPaneAgentTerminal).toHaveBeenCalledTimes(1)
    })

    it('is told the outcome is unknown after a restart, and starts nothing', async () => {
      await launch(host())
      await untilRecorded('unknown')
      store = await openTestAgentSessionRecordStore(directory)
      setAgentLaunchRecordStore(store)
      resetAgentLaunchPanesForTests()
      // A new process: none of the old one's launches are still running.
      vi.resetModules()
      const fresh = await import('./agent-launch')
      const replay = methodNamed(fresh.AGENT_LAUNCH_METHODS, 'agent.launchReplay')
      const restarted = host()
      const params = replay.params.parse({
        agent: 'claude',
        target: { kind: 'existing', worktree: 'id:wt-7' },
        operationId,
        paneKey: PANE_KEY,
        spawnTrigger: 'window-pane'
      })

      await expect(replay.handler(params, rpcContext(restarted, DESKTOP))).rejects.toThrow(
        'agent_session_operation_unknown'
      )
      expect(restarted.planPaneAgentTerminal).not.toHaveBeenCalled()
      expect(await paneSpawn(restarted)).toBe('unowned')
    })
  })

  it('still starts when the ledger cannot admit it: the click never waits on bookkeeping', async () => {
    setAgentLaunchRecordStore(null)
    const runtime = host()

    const result = await launch(runtime)

    expect(result.outcome).toEqual({ kind: 'pane', paneKey: PANE_KEY })
    expect((await planned(runtime)).plan).toMatchObject({ command: 'claude' })
    // Only a window pane's launch: any other launch is still refused without its record.
    await expect(
      launch(runtime, { spawnTrigger: undefined, operationId: `${Date.now()}-${'f'.repeat(32)}` })
    ).rejects.toThrow('agent_session_record_store_unavailable')
  })

  it('is refused from any caller but this desktop window', async () => {
    const runtime = host()
    await expect(launch(runtime, {}, {})).rejects.toThrow('agent_launch_window_pane_invalid')
    expect(runtime.planPaneAgentTerminal).not.toHaveBeenCalled()
  })
})
