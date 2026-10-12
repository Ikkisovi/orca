import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCodexMaintenance } from '@/hooks/useCodexMaintenance'
import type { CodexMaintenanceTarget } from '@/lib/codex-maintenance-client'
import { getCodexMaintenanceHostBusy, startCodexMaintenance } from '@/lib/codex-maintenance-store'
import { codexMaintenanceLabel, codexMaintenanceSettingsStatus } from './codex-maintenance-copy'
import { CodexMaintenanceLogDialog } from './CodexMaintenanceLogDialog'

export function CodexMaintenanceRow({
  target
}: {
  target: CodexMaintenanceTarget
}): React.JSX.Element | null {
  const maintenance = useCodexMaintenance(target)
  const [logOpen, setLogOpen] = useState(false)
  const busy = getCodexMaintenanceHostBusy(target)
  const installation = maintenance.installation
  const status = installation ? codexMaintenanceSettingsStatus(installation) : null
  if (!status && !logOpen) {
    return null
  }
  return (
    <>
      {status ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{status}</span>
          {/* Only a missing Codex gets a button; the user updates an old one themselves. */}
          {installation?.status === 'missing' && maintenance.state?.canRun ? (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => {
                setLogOpen(true)
                startCodexMaintenance(target)
              }}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null}
              {codexMaintenanceLabel(busy)}
            </Button>
          ) : null}
        </div>
      ) : null}
      <CodexMaintenanceLogDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        job={maintenance.logJob}
        error={maintenance.error}
        busy={busy}
      />
    </>
  )
}
