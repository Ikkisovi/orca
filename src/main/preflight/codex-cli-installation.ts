import {
  codexCliInstallation,
  parseCodexCliVersion,
  type CodexCliInstallation
} from '../../shared/codex-cli-installation'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import { readAgentCliVersion } from '../agent-cli-version-probe'
import { resolveLocalExecutionCommand } from '../ipc/command-path-resolver'

export async function readCodexCliInstallation(
  input: Pick<ProcessSpec, 'program' | 'cwd' | 'env'>
): Promise<CodexCliInstallation> {
  const cwd = input.cwd ?? process.cwd()
  const selected = await resolveLocalExecutionCommand(input.program, { ...input, cwd })
  if (selected.status !== 'resolved') {
    return codexCliInstallation(selected.status !== 'missing', null)
  }
  const result = await readAgentCliVersion(
    { ...input, program: selected.program, cwd },
    parseCodexCliVersion
  )
  return codexCliInstallation(true, result.version)
}
