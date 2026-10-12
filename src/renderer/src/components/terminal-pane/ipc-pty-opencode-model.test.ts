import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { spawnIpcPty } from './ipc-pty-spawn-request'
import type { IpcPtyTransportOptions } from './pty-transport-types'

vi.mock('../../runtime/runtime-rpc-client', async () => ({
  callRuntimeRpc: vi.fn(),
  RuntimeRpcCallError: (await import('../../runtime/runtime-rpc-result')).RuntimeRpcCallError
}))
const spawn = vi.fn(async () => ({ id: 'pty_pane' }))
const options = (): IpcPtyTransportOptions => ({
  worktreeId: 'folder:private',
  tabId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  leafId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  launchAgent: 'opencode',
  command: 'opencode --model private-proof/model-b',
  agentPrompt: 'Read only',
  agentPromptDelivery: 'auto-submit',
  agentLaunchPreferences: { model: 'private-proof/model-b' }
})
const connect = { url: 'ipc://private', callbacks: {}, cols: 80, rows: 24 }

describe('local OpenCode model launch authority', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', { api: { pty: { spawn } } })
    spawn.mockResolvedValue({ id: 'pty_pane' })
    vi.mocked(callRuntimeRpc).mockResolvedValue({ outcome: { kind: 'pane' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('has the execution host plan the model launch, then spawns its own pane to run it', async () => {
    const claimReplacedPtyId = vi.fn(() => 'pty_previous')
    expect(await spawnIpcPty(options(), { ...connect, claimReplacedPtyId })).toMatchObject({
      id: 'pty_pane'
    })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'agent.launchReplay',
      expect.objectContaining({
        agent: 'opencode',
        sessionOptions: { model: 'private-proof/model-b' },
        prompt: { text: 'Read only', delivery: 'submit' },
        promptCarry: 'window',
        paneKey: `${options().tabId}:${options().leafId}`,
        spawnTrigger: 'window-pane'
      })
    )
    // At the pane's own size, never a reattach to a terminal the host made.
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: options().tabId, cols: 80, rows: 24 })
    )
    expect(spawn).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.anything() })
    )
  })

  it('preserves one operation ID across a lost reply and reconnect', async () => {
    const transport = options()
    vi.mocked(callRuntimeRpc).mockRejectedValueOnce(new Error('reply lost'))
    await spawnIpcPty(transport, connect)
    await spawnIpcPty(transport, connect)
    const operationRequest = z.object({ operationId: z.string() })
    const ids = vi
      .mocked(callRuntimeRpc)
      .mock.calls.map((call) => operationRequest.parse(call[2]).operationId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toMatch(/^\d{13}-[0-9a-f]{32}$/)
  })

  it('does not issue raw spawn or replacement effects after the host refuses', async () => {
    vi.mocked(callRuntimeRpc).mockRejectedValue(new Error('capability_unsupported'))
    const claimReplacedPtyId = vi.fn(() => 'pty_previous')
    await expect(spawnIpcPty(options(), { ...connect, claimReplacedPtyId })).rejects.toThrow(
      'capability_unsupported'
    )
    expect(spawn).not.toHaveBeenCalled()
    expect(claimReplacedPtyId).not.toHaveBeenCalled()
  })

  it.each([
    { connectionId: 'ssh_private' },
    { resumeProviderSession: { key: 'session_id' as const, id: 'old' } }
  ])('refuses unsupported placement before host or raw spawn', async (extra) => {
    await expect(spawnIpcPty({ ...options(), ...extra }, connect)).rejects.toThrow(
      'capability_unsupported'
    )
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('preserves ordinary raw startup and captured-session attachment', async () => {
    const ordinary = { ...options(), agentLaunchPreferences: undefined }
    await spawnIpcPty(ordinary, connect)
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ command: ordinary.command }))
    await spawnIpcPty(options(), connect, 'pty_existing')
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'pty_existing' }))
  })
})
