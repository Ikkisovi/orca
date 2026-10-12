import { createStructuredAgentEnvironmentResolvers } from '../runtime/structured-agent-shell-environment'
import {
  configuredCodexInvocationSources,
  type CodexCommandSettings
} from '../codex/configured-codex-invocation'
import { hasExplicitTuiLaunchCommand } from '../../shared/tui-agent-launch-command-override'
import type { CodexCliInstallation } from '../../shared/codex-cli-installation'
import { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import { resolveCodexStructuredInvocation } from '../codex/codex-structured-launch-resolution'
import { readCodexCliInstallation } from './codex-cli-installation'

export type CodexMaintenanceContext = { commandSettings?: CodexCommandSettings }
type ResolvedCodexMaintenanceCommand = {
  installation: CodexCliInstallation
  /** The install to run; null unless Codex is missing. */
  spec: ProcessSpec | null
}

export async function resolveCodexMaintenanceCommand(
  context: CodexMaintenanceContext = {}
): Promise<ResolvedCodexMaintenanceCommand> {
  const cwd = process.cwd()
  const settings = context.commandSettings ?? {}
  const sources = configuredCodexInvocationSources(() => settings)
  const { command, environment } = await resolveCodexStructuredInvocation({
    resolveCommand: sources.resolveCommand,
    resolveEnvironment: createStructuredAgentEnvironmentResolvers(sources).resolveCodexEnvironment
  })
  const installation = await readCodexCliInstallation({
    program: command,
    cwd,
    env: environment
  })
  // A configured Command names its own install; a global npm install would not land there.
  const installable =
    installation.status === 'missing' && !hasExplicitTuiLaunchCommand(settings, 'codex')
  return {
    installation,
    spec: installable
      ? {
          program: resolveCliCommand('npm', { pathEnv: environment.PATH ?? environment.Path }),
          args: ['install', '-g', '@openai/codex'],
          cwd,
          env: environment
        }
      : null
  }
}
