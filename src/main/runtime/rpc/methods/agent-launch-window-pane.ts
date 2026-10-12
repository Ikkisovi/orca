/** A launch whose pane the caller laid out and starts itself (`spawnTrigger: 'window-pane'`): the
 *  host plans and answers at once, never waiting on a pane that may mount late or never. */

import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import { AGENT_LAUNCH_TAB_CLOSED_CODE } from '../../../../shared/agent-launch-tab-closed'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  trackRunningAgentLaunchPane,
  type AgentLaunchPane
} from '../../../agent-launch/agent-launch-pane-attachment'
import type { TerminalCreateOptions } from '../../runtime-terminal-contracts'
import type { AgentLaunchPaneVerdict } from '../../../../shared/agent-launch-pane-verdict'
import type { AgentLaunchParams } from '../../../../shared/rpc-contract/agent-launch-params'
import type { RpcContext } from '../core'
import { agentLaunchFailureCode } from './agent-launch-failure-code'

/** How the pane's spawn ended: the terminal it made, or why nothing started. */
export type WindowPaneSpawn =
  | { terminal: Extract<AgentLaunchResult['outcome'], { kind: 'terminal' }> }
  | { failure: string; cause?: unknown }

export type WindowPaneLaunch = {
  handOff(pane: AgentLaunchPane, plan: TerminalCreateOptions): void
  spawned: Promise<WindowPaneSpawn>
}

/** Only the desktop's own window lays out a pane on this machine. */
export function assertWindowPaneTrigger(params: AgentLaunchParams, context: RpcContext): void {
  const { spawnTrigger, operationId, target, paneKey } = params
  const valid =
    context.caller?.kind === 'desktop' && operationId && target.kind === 'existing' && paneKey
  if (spawnTrigger === 'window-pane' && !(valid && parsePaneKey(paneKey))) {
    throw new Error('agent_launch_window_pane_invalid')
  }
}

export function windowPaneLaunch(context: RpcContext): WindowPaneLaunch {
  let ended!: (spawn: WindowPaneSpawn) => void
  const spawned = new Promise<WindowPaneSpawn>((resolve) => (ended = resolve))
  return {
    spawned,
    handOff: (pane, plan) => {
      const running = trackRunningAgentLaunchPane(pane)
      let over = false
      const end = (spawn: WindowPaneSpawn, verdict: AgentLaunchPaneVerdict): void => {
        if (!over) {
          over = true
          ended(spawn)
          running.finish(verdict)
        }
      }
      const committed = ({ id, incarnationId }: { id: string; incarnationId?: string }): void =>
        end(
          {
            terminal: {
              kind: 'terminal',
              handle: context.runtime.getTerminalHandleForPaneKey(pane.paneKey) ?? id,
              paneKey: pane.paneKey,
              ptyId: id,
              ...(incarnationId ? { incarnationId } : {})
            }
          },
          { kind: 'proceed' }
        )
      const failed = (error: unknown): void => {
        const code = agentLaunchFailureCode(error)
        end({ failure: code, cause: error }, { kind: 'not-started', code })
      }
      running.planReady({ plan, committed, failed }, () =>
        end({ failure: AGENT_LAUNCH_TAB_CLOSED_CODE }, { kind: 'withdrawn' })
      )
    }
  }
}
