import { useCallback, useEffect, useRef, useState } from 'react'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import {
  HOST_USAGE_PLUGIN_KEY,
  hostUsageSummarySchema,
  type HostUsageSummary
} from '../../../../shared/host-usage-summary'

export function useHostUsage(host: string, days: number) {
  const plugins = usePluginPanelsStore((state) => state.plugins)
  const fetchPlugins = usePluginPanelsStore((state) => state.fetchPlugins)
  const plugin = plugins.find((entry) => entry.pluginKey === HOST_USAGE_PLUGIN_KEY)
  const enabled = plugin?.status === 'idle' || plugin?.status === 'running'
  const compatible = plugin?.commands.some((command) => command.id === 'usage-summary') ?? false
  const [snapshot, setSnapshot] = useState<HostUsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const invoke = useCallback(
    (commandId: string) =>
      window.api.plugins.invokeCommand({
        pluginKey: HOST_USAGE_PLUGIN_KEY,
        commandId,
        args: { host, days }
      }),
    [host, days]
  )

  useEffect(() => {
    void fetchPlugins()
    return window.api?.plugins?.onChanged(() => {
      void fetchPlugins()
    })
  }, [fetchPlugins])

  useEffect(() => {
    const current = ++generation.current
    if (!enabled || !compatible) {
      return
    }
    let disposed = false,
      inFlight = false
    const reload = async () => {
      if (inFlight) {
        return
      }
      inFlight = true
      try {
        const value = hostUsageSummarySchema.parse(await invoke('usage-summary'))
        if (!disposed && current === generation.current) {
          setSnapshot(value)
          setError(null)
        }
      } catch (cause) {
        if (!disposed && current === generation.current) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        inFlight = false
      }
    }
    setSnapshot(null)
    setBusy(false)
    setError(null)
    void reload()
    const timer = setInterval(() => {
      void reload()
    }, 3000)
    return () => {
      disposed = true
      generation.current = current + 1
      clearInterval(timer)
    }
  }, [enabled, compatible, invoke])

  const act = async (commandId: string) => {
    const current = generation.current
    setBusy(true)
    try {
      await invoke(commandId)
      const value = hostUsageSummarySchema.parse(await invoke('usage-summary'))
      if (current === generation.current) {
        setSnapshot(value)
        setError(null)
      }
    } catch (cause) {
      if (current === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (current === generation.current) {
        setBusy(false)
      }
    }
  }
  return {
    snapshot: enabled && compatible ? snapshot : null,
    error,
    busy,
    enabled,
    compatible,
    scan: () => act('usage-scan'),
    reload: () => act('usage-summary'),
    open: () => act('usage-open')
  }
}
