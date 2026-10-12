// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { HostUsagePane } from './HostUsagePane'
import { useHostUsage } from './use-host-usage'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { HOST_USAGE_PLUGIN_KEY } from '../../../../shared/host-usage-summary'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
const totals = {
  total: 120,
  input: 60,
  output: 20,
  cached: 40,
  cacheWrite: 0,
  reasoning: 0,
  turns: 1,
  knownCost: 0,
  unknownCostRows: 1,
  sessions: 1
}
const snapshot = {
  schemaVersion: 1,
  scanning: false,
  interval: 60,
  warnings: [],
  summary: totals,
  daily: [],
  providers: [{ key: 'codex', ...totals }],
  hosts: ['Mac', 'Venus'].map((name, index) => ({
    key: index ? 'ssh:venus' : 'local',
    kind: index ? 'ssh' : 'local',
    name,
    aliases: [name],
    state: 'ready',
    error: null,
    lastSuccessAt: 123456,
    summary: totals,
    providers: []
  }))
}
function plugin(status: PluginHostListEntry['status'] = 'idle'): PluginHostListEntry {
  return {
    pluginKey: HOST_USAGE_PLUGIN_KEY,
    consentFingerprint: 'reviewed',
    name: 'Usage',
    version: '0.2.0',
    publisher: 'ikkisovi',
    status,
    needsReconsent: status === 'pending',
    isDev: false,
    official: false,
    bundled: false,
    capabilities: [],
    panels: [],
    hasWorker: true,
    restarts: 0,
    commands: [
      {
        id: 'usage-summary',
        title: 'Summary',
        context: 'global',
        handler: { type: 'worker' },
        keybindings: []
      }
    ]
  }
}
const invokeCommand = vi.fn()
const list = vi.fn()
beforeEach(() => {
  invokeCommand.mockReset().mockResolvedValue(snapshot)
  list.mockReset().mockResolvedValue([plugin()])
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      api: {
        plugins: {
          list,
          invokeCommand,
          onChanged: () => () => {}
        }
      }
    })
  )
  usePluginPanelsStore.setState({ plugins: [plugin()], fetchStatus: 'ready' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('native host usage', () => {
  it('shows both machines inside the native pane and keeps reload separate from scan', async () => {
    render(createElement(HostUsagePane))
    await screen.findByRole('heading', { name: 'Venus' })
    expect(screen.getAllByTestId('usage-host-card')).toHaveLength(2)
    fireEvent.click(screen.getByText('Reload collected statistics'))
    await waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(3))
    expect(invokeCommand.mock.calls.every(([args]) => args.commandId === 'usage-summary')).toBe(
      true
    )
    fireEvent.click(screen.getByText('Scan selected hosts'))
    await waitFor(() =>
      expect(invokeCommand).toHaveBeenCalledWith({
        pluginKey: HOST_USAGE_PLUGIN_KEY,
        commandId: 'usage-scan',
        args: { host: 'all', days: 30 }
      })
    )
  })

  it('does not activate unapproved workers or old plugins', async () => {
    list.mockResolvedValue([plugin('pending')])
    usePluginPanelsStore.setState({ plugins: [plugin('pending')] })
    render(createElement(HostUsagePane))
    await screen.findByText(/Install and enable/)
    expect(invokeCommand).not.toHaveBeenCalled()
  })

  it('ignores a response for an old host selection', async () => {
    let complete: (value: unknown) => void = () => {}
    invokeCommand.mockImplementation(({ args }) =>
      args.host === 'local'
        ? new Promise((resolve) => {
            complete = resolve
          })
        : Promise.resolve(snapshot)
    )
    const hook = renderHook(({ host }) => useHostUsage(host, 30), {
      initialProps: { host: 'local' }
    })
    await waitFor(() => expect(invokeCommand).toHaveBeenCalled())
    hook.rerender({ host: 'ssh:venus' })
    await waitFor(() => expect(hook.result.current.snapshot?.summary.total).toBe(120))
    await act(async () => {
      complete({ ...snapshot, summary: { ...totals, total: 999 } })
    })
    expect(hook.result.current.snapshot?.summary.total).toBe(120)
  })

  it('retains last statistics when the monitor becomes unavailable', async () => {
    const hook = renderHook(() => useHostUsage('all', 30))
    await waitFor(() => expect(hook.result.current.snapshot).not.toBeNull())
    invokeCommand.mockRejectedValue(new Error('monitor unavailable'))
    await act(async () => {
      await hook.result.current.reload()
    })
    expect(hook.result.current.snapshot?.hosts[1].lastSuccessAt).toBe(123456)
    expect(hook.result.current.error).toBe('monitor unavailable')
  })
})
