import type { AgentLaunchIntent } from '../../shared/agent-launch-intent'
import { pickStoredFields } from '../../shared/workspace-layout/stored-record-fields'
import type { AgentLaunchSurfaceExecution } from './agent-launch-execution'
import type { CreatedSurface } from './agent-launch-executor'
import { argvLaunchPrompt } from './agent-launch-prompt-delivery'

/** What every route that builds a terminal agent passes on, so the startup terminal of a new
 *  workspace and the terminal of an existing one start the same agent. */
export function terminalLaunchInputs(intent: AgentLaunchIntent) {
  return {
    ...(intent.sessionOptions ? { options: intent.sessionOptions } : {}),
    // `null` is a value the caller meant, so this tests for absence rather than falsiness.
    ...(intent.agentArgs !== undefined ? { agentArgs: intent.agentArgs } : {}),
    ...(intent.cwd ? { cwd: intent.cwd } : {}),
    ...(intent.launchSource ? { launchSource: intent.launchSource } : {}),
    ...(intent.paneKey ? { paneKey: intent.paneKey } : {})
  }
}

/**
 * The one place a terminal agent is created, so the structured-refusal downgrade builds the same
 * surface — carrying the same argv prompt — as a launch that chose a terminal outright.
 */
export async function createTerminalSurface(
  execution: AgentLaunchSurfaceExecution,
  workspace: { worktreeId: string; connectionId?: string | null }
): Promise<CreatedSurface> {
  const { intent, surfaces } = execution
  // The window's rule offers a draft too, and decides itself whether the line carries it.
  const startupPrompt = intent.promptCarry === 'window' ? intent.prompt : undefined
  const argvPrompt = startupPrompt ? startupPrompt.text : argvLaunchPrompt(intent)
  const terminal = await surfaces.createTerminalAgent({
    worktreeId: workspace.worktreeId,
    agent: intent.agent,
    ...(argvPrompt ? { startupPrompt: argvPrompt } : {}),
    ...(startupPrompt?.delivery === 'draft' ? { startupPromptDelivery: 'draft' as const } : {}),
    ...terminalLaunchInputs(intent),
    ...pickStoredFields(intent, [
      'title',
      'extraAgentArgs',
      'requestKind',
      'promptCarry',
      'wslShellRule'
    ]),
    viewMode: 'terminal'
  })
  return {
    outcome:
      'handedToPane' in terminal
        ? { kind: 'pane', paneKey: terminal.paneKey }
        : {
            kind: 'terminal',
            handle: terminal.handle,
            ...(terminal.paneKey ? { paneKey: terminal.paneKey } : {})
          },
    ...('warning' in terminal && terminal.warning ? { warning: terminal.warning } : {}),
    ...(argvPrompt && terminal.promptRodeLaunchCommand ? { promptRodeLaunchCommand: true } : {})
  }
}
