import type { AgentLaunchPanePlan } from '../../../agent-launch/agent-launch-pane-attachment'
import { pickStoredFields } from '../../../../shared/workspace-layout/stored-record-fields'
import type { PtyIpcSpawnState } from './spawn-state'

/** The pane's spawn runs the host's plan for it: the plan's command, agent and environment, at the
 *  pane's own size, cwd and placement. Its shell comes only from the plan (`spawn-preflight`). */
export function applyAgentLaunchPanePlan(ctx: PtyIpcSpawnState, launch: AgentLaunchPanePlan): void {
  const { plan } = launch
  ctx.paneLaunch = launch
  Object.assign(ctx.args, {
    command: plan.command,
    env: { ...ctx.args.env, ...plan.env },
    ...pickStoredFields(plan, [
      'launchConfig',
      'launchAgent',
      'startupCommandDelivery',
      'telemetry'
    ])
  })
}
