// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HostUsagePane } from './HostUsagePane'
import { useHostUsage } from './use-host-usage'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { HOST_USAGE_PLUGIN_KEY } from '../../../../shared/host-usage-summary'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
    Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))
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
const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: scrollIntoView,
    configurable: true
  })
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
  it('shows ranked models and projects, opens native details and pages/searches individual sessions', async () => {
    const user = userEvent.setup()
    const sessions = Array.from({ length: 102 }, (_, index) => ({
      id: `session-${index}`,
      host: 'local',
      provider: 'codex',
      model: 'gpt-6',
      project: '/research',
      firstAt: '2026-09-01T00:00:00Z',
      lastAt: '2026-10-12T00:00:00Z',
      total: 2_000_000_000,
      turns: 20
    }))
    invokeCommand.mockImplementation(({ args }) => {
      const matching = sessions.filter(
        (row) => !args.sessionSearch || row.id.includes(args.sessionSearch)
      )
      return Promise.resolve({
        ...snapshot,
        models: [
          { ...totals, key: 'codex / gpt-6', total: 80 },
          { ...totals, key: 'pi / other', total: 40 }
        ],
        projects: [{ ...totals, key: '/research' }],
        recent: matching.slice(args.sessionOffset, args.sessionOffset + 50),
        sessionPagination: { offset: args.sessionOffset, limit: 50, total: matching.length }
      })
    })
    render(createElement(HostUsagePane))
    await screen.findByRole('heading', { name: 'Model ranking' })
    expect(screen.getByText('codex / gpt-6')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Projects & sessions' }))
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByTestId('host-usage-details'))
    expect(invokeCommand.mock.calls.some(([args]) => args.commandId === 'usage-open')).toBe(false)
    const panel = screen.getByTestId('host-usage-sessions')
    await user.click(within(panel).getByRole('button', { name: 'Next' }))
    await within(panel).findByRole('button', { name: 'codex: session-50' })
    await user.click(within(panel).getByRole('button', { name: 'Next' }))
    await within(panel).findByRole('button', { name: 'codex: session-101' })
    await user.click(within(panel).getByRole('button', { name: 'codex: session-101' }))
    expect(within(screen.getByRole('dialog')).getByText('2B')).toBeDefined()
    await user.keyboard('{Escape}')
    const input = screen.getByRole('textbox', {
      name: 'Search session, model, provider or project'
    })
    fireEvent.change(input, { target: { value: 'session-65' } })
    await within(panel).findByRole('button', { name: 'codex: session-65' })
    expect(
      screen.getByRole('textbox', { name: 'Search session, model, provider or project' })
    ).toBe(input)
    expect(invokeCommand).toHaveBeenLastCalledWith({
      pluginKey: HOST_USAGE_PLUGIN_KEY,
      commandId: 'usage-summary',
      args: { host: 'all', days: 30, sessionOffset: 0, sessionSearch: 'session-65' }
    })
    expect(within(panel).getByText('1–1 / 1')).toBeDefined()
  })

  it('renders every selected day and updates the chart when the host or range changes', async () => {
    const user = userEvent.setup()
    invokeCommand.mockImplementation(({ args }) => {
      const total = args.host === 'local' ? 2_000_000_000_000 : 1_000_000_000
      return Promise.resolve({
        ...snapshot,
        summary: { ...totals, total },
        daily: Array.from({ length: args.days }, (_, index) => ({
          ...totals,
          key: new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10),
          total
        }))
      })
    })
    render(createElement(HostUsagePane))
    const chart = await screen.findByRole('img', { name: 'Daily usage' })
    expect(chart.querySelectorAll('rect')).toHaveLength(30)
    expect(chart.textContent).toContain('1B')
    await user.click(screen.getByRole('button', { name: 'All hosts' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Mac' }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Daily usage' }).textContent).toContain('2T')
    )
    await user.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Last 7 days' }))
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Daily usage' }).querySelectorAll('rect')
      ).toHaveLength(7)
    )
    expect(invokeCommand).toHaveBeenLastCalledWith({
      pluginKey: HOST_USAGE_PLUGIN_KEY,
      commandId: 'usage-summary',
      args: { host: 'local', days: 7, sessionOffset: 0, sessionSearch: '' }
    })
  })

  it('shows an explicit empty state when the selected range has no daily data', async () => {
    render(createElement(HostUsagePane))
    await screen.findByText('No collected usage in this date range.')
    expect(screen.queryByRole('img', { name: 'Daily usage' })).toBeNull()
  })

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
        args: { host: 'all', days: 30, sessionOffset: 0, sessionSearch: '' }
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
