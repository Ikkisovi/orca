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
  useEffect(() => {
    void refreshCodexMaintenance(target)
  }, [target])
  return { ...entry, installation: entry.state?.installation }
}
