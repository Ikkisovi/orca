import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codexCliInstallation } from '../../../shared/codex-cli-installation'
import type { CodexMaintenanceState } from '../../../shared/codex-cli-maintenance'
import {
  getCodexMaintenanceEntry,
  getCodexMaintenanceHostBusy,
  refreshCodexMaintenance,
  resetCodexMaintenanceStoreForTests,
  startCodexMaintenance
} from './codex-maintenance-store'

const { call, refreshAgents } = vi.hoisted(() => ({
  call: vi.fn(),
  refreshAgents: vi.fn().mockResolvedValue([])
}))
vi.mock('./codex-maintenance-client', () => ({
  callCodexMaintenance: call,
  codexMaintenanceTargetKey: () => 'local:codex'
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ refreshDetectedAgents: refreshAgents })
  }
}))
const TARGET = { kind: 'local' } as const
function state(): CodexMaintenanceState {
  return { installation: codexCliInstallation(false, null), canRun: true, job: null }
}
function running(): CodexMaintenanceState {
  return {
    ...state(),
    job: { id: 'job', phase: 'running', output: 'started', exitCode: null, error: null }
  }
}
beforeEach(() => {
  resetCodexMaintenanceStoreForTests()
  call.mockReset()
  refreshAgents.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  resetCodexMaintenanceStoreForTests()
  vi.useRealTimers()
})
describe('Settings Codex installation', () => {
  it('ignores an older status response after an explicit start', async () => {
    let completeStatus: (value: CodexMaintenanceState) => void = () => {}
    call.mockImplementationOnce(
      () =>
        new Promise<CodexMaintenanceState>((resolve) => {
          completeStatus = resolve
        })
    )
    const pending = refreshCodexMaintenance(TARGET)
    call.mockResolvedValueOnce(running())
    startCodexMaintenance(TARGET)
    await vi.advanceTimersByTimeAsync(0)
    completeStatus(state())
    await pending
    expect(getCodexMaintenanceEntry('local:codex').state?.job?.phase).toBe('running')
    expect(getCodexMaintenanceEntry('local:codex').starting).toBe(false)
  })

  it('refreshes after an immediately completed install despite an older pending status read', async () => {
    let completeStatus: (value: CodexMaintenanceState) => void = () => {}
    call.mockImplementationOnce(
      () =>
        new Promise<CodexMaintenanceState>((resolve) => {
          completeStatus = resolve
        })
    )
    const pending = refreshCodexMaintenance(TARGET)
    call
      .mockResolvedValueOnce({
        ...state(),
        job: { id: 'job', phase: 'completed', output: 'installed', exitCode: 0, error: null }
      })
      .mockResolvedValueOnce({
        ...state(),
        installation: codexCliInstallation(true, '0.136.0'),
        canRun: false
      })
    startCodexMaintenance(TARGET)
    await vi.advanceTimersByTimeAsync(0)
    expect(call.mock.calls.map(([, params]) => params.operation)).toEqual([
      'status',
      'start',
      'status'
    ])
    completeStatus(state())
    await pending
    expect(getCodexMaintenanceEntry('local:codex').state?.installation.status).toBe('ready')
    expect(getCodexMaintenanceEntry('local:codex').logJob?.output).toBe('installed')
  })

  it('keeps host job logs after contact loss, bounds read retries and permits another manual attempt', async () => {
    call.mockResolvedValueOnce(running())
    startCodexMaintenance(TARGET)
    await vi.advanceTimersByTimeAsync(0)
    call.mockRejectedValue(new Error('Host disconnected'))
    await vi.advanceTimersByTimeAsync(5_000)
    const entry = getCodexMaintenanceEntry('local:codex')
    expect(entry.error).toBe('Host disconnected')
    expect(entry.logJob?.output).toBe('started')
    expect(entry.state?.job?.phase).toBe('running')
    expect(call.mock.calls.filter(([, params]) => params.operation === 'read')).toHaveLength(3)
    expect(refreshAgents).not.toHaveBeenCalled()
    expect(getCodexMaintenanceHostBusy(TARGET)).toBe(false)
    call.mockResolvedValueOnce(running())
    startCodexMaintenance(TARGET)
    await vi.advanceTimersByTimeAsync(0)
    expect(call.mock.calls.filter(([, params]) => params.operation === 'start')).toHaveLength(2)
  })

  it('coalesces status requests without starting an install automatically', async () => {
    call.mockResolvedValue(state())
    await Promise.all([refreshCodexMaintenance(TARGET), refreshCodexMaintenance(TARGET)])
    expect(call).toHaveBeenCalledExactlyOnceWith(TARGET, { operation: 'status' })
  })

  it('shares manual install attempts and refreshes status and detection after completion', async () => {
    call.mockResolvedValueOnce(running())
    startCodexMaintenance(TARGET)
    startCodexMaintenance(TARGET)
    await vi.advanceTimersByTimeAsync(0)
    const completed: CodexMaintenanceState = {
      ...state(),
      currentJob: null,
      job: { id: 'job', phase: 'completed', output: 'installed', exitCode: 0, error: null }
    }
    call.mockResolvedValueOnce(completed).mockResolvedValueOnce({
      ...state(),
      installation: codexCliInstallation(true, '0.136.0'),
      canRun: false
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(call.mock.calls.map(([, params]) => params.operation)).toEqual([
      'start',
      'read',
      'status'
    ])
    expect(refreshAgents).toHaveBeenCalledOnce()
    expect(getCodexMaintenanceHostBusy(TARGET)).toBe(false)
    expect(getCodexMaintenanceEntry('local:codex').state?.installation.status).toBe('ready')
    expect(getCodexMaintenanceEntry('local:codex').logJob?.output).toBe('installed')
  })

  it('cancels historical polling when the latest status no longer has that job', async () => {
    call.mockResolvedValueOnce(running())
    await refreshCodexMaintenance(TARGET)
    call.mockResolvedValueOnce(state())
    await refreshCodexMaintenance(TARGET)
    await vi.advanceTimersByTimeAsync(1000)
    expect(call).toHaveBeenCalledTimes(2)
    expect(getCodexMaintenanceHostBusy(TARGET)).toBe(false)
    expect(getCodexMaintenanceEntry('local:codex').logJob?.output).toBe('started')
  })
})
