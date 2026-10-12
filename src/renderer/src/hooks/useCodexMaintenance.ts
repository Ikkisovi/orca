import { useEffect, useSyncExternalStore } from 'react'
import {
  codexMaintenanceTargetKey,
  type CodexMaintenanceTarget
} from '@/lib/codex-maintenance-client'
import {
  getCodexMaintenanceEntry,
  refreshCodexMaintenance,
  subscribeCodexMaintenance
} from '@/lib/codex-maintenance-store'

export function useCodexMaintenance(target: CodexMaintenanceTarget) {
  const key = codexMaintenanceTargetKey(target)
  const snapshot = () => getCodexMaintenanceEntry(key)
  const entry = useSyncExternalStore(subscribeCodexMaintenance, snapshot, snapshot)
  const kind = target.kind
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  useEffect(() => {
    const host: CodexMaintenanceTarget =
      kind === 'environment' && environmentId ? { kind, environmentId } : { kind: 'local' }
    void refreshCodexMaintenance(host)
  }, [kind, environmentId])
  return { ...entry, installation: entry.error ? undefined : entry.state?.installation }
}
