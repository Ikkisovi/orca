/**
 * A launch whose pane the caller laid out and starts itself (`spawnTrigger: 'window-pane'`): the
 * host plans, hands the plan to the pane's running launch and answers at once, never waiting on a
 * pane that may mount late or never. The pane's spawn commit or failure settles the launch record;
 * until then a replay answers what the first request did.
 */

import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import { AGENT_LAUNCH_TAB_CLOSED_CODE } from '../../../../shared/agent-launch-tab-closed'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  trackRunningAgentLaunchPane,
  type AgentLaunchPane
} from '../../../agent-launch/agent-launch-pane-attachment'
import type { TerminalCreateOptions } from '../../runtime-terminal-contracts'
import type { AgentLaunchParams } from '../../../../shared/rpc-contract/agent-launch-params'
import type { RpcContext } from '../core'
import { agentLaunchFailureCode } from './agent-launch-failure-code'
import { settleQuietly } from './agent-launch-execution-outcome'

export type WindowPaneLaunch = {
  handOff(pane: AgentLaunchPane, plan: TerminalCreateOptions): void
  /** The caller's answer, which the pane's commit records with the terminal it made. */
  answered(result: AgentLaunchResult): void
}

type LaunchRecord = {
  settle: (result: AgentLaunchResult) => Promise<void>
  fail: (code: string, cause?: unknown) => Promise<void>
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

type WaitingAnswer = {
  fingerprint: string
  promise: Promise<AgentLaunchResult>
}
const answersWaitingOnPane = new Map<string, WaitingAnswer>()

export function windowPaneAnswer(operationKey: string): WaitingAnswer | undefined {
  return answersWaitingOnPane.get(operationKey)
}

export function windowPaneLaunch(
  context: RpcContext,
  record: LaunchRecord,
  operation: { key: string; fingerprint: string }
): WindowPaneLaunch {
  let answered!: (result: AgentLaunchResult) => void
  const answer = new Promise<AgentLaunchResult>((resolve) => (answered = resolve))
  return {
    answered,
    handOff: (pane, plan) => {
      const running = trackRunningAgentLaunchPane(pane)
      answersWaitingOnPane.set(operation.key, {
        fingerprint: operation.fingerprint,
        promise: answer
      })
      let over = false
      const end = (settlement: () => Promise<void>): boolean => {
        if (over) {
          return false
        }
        over = true
        answersWaitingOnPane.delete(operation.key)
        void settleQuietly(settlement())
        return true
      }
      const committed = ({ id, incarnationId }: { id: string; incarnationId?: string }): void => {
        const handle = context.runtime.getTerminalHandleForPaneKey(pane.paneKey) ?? id
        const outcome = {
          kind: 'terminal' as const,
          handle,
          paneKey: pane.paneKey,
          ptyId: id
        }
        const recorded = {
          ...outcome,
          ...(incarnationId ? { incarnationId } : {})
        }
        if (end(() => answer.then((result) => record.settle({ ...result, outcome: recorded })))) {
          running.finish({ kind: 'proceed' })
        }
      }
      const failed = (error: unknown): void => {
        const code = agentLaunchFailureCode(error)
        if (end(() => record.fail(code, error))) {
          running.finish({ kind: 'not-started', code })
        }
      }
      running.planReady({ plan, committed, failed }, () => {
        if (end(() => record.fail(AGENT_LAUNCH_TAB_CLOSED_CODE))) {
          running.finish({ kind: 'withdrawn' })
        }
      })
    }
  }
}
