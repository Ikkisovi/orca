import type {
  CodexMaintenanceParams,
  CodexMaintenanceState
} from '../../shared/codex-cli-maintenance'
import { codexMaintenanceRunner } from './codex-maintenance-runner'
import type { CodexCommandSettings } from '../codex/configured-codex-invocation'

/** Settings reads and installs on its selected execution host. */
export async function codexMaintenanceOnHost(
  params: CodexMaintenanceParams,
  settings: CodexCommandSettings = {}
): Promise<CodexMaintenanceState> {
  const context = { commandSettings: settings }
  return params.operation === 'start'
    ? codexMaintenanceRunner.start(context)
    : codexMaintenanceRunner.status(params.operation === 'read' ? params.jobId : undefined, context)
}
