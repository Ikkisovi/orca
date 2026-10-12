/** One run per launch operation in this process: a replay of the same click joins the run. */

import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import type { OrcaRuntimeService } from '../../orca-runtime'

export type InFlightAgentLaunch = {
  fingerprint: string
  promise: Promise<AgentLaunchResult>
}

const inFlightByRuntime = new WeakMap<OrcaRuntimeService, Map<string, InFlightAgentLaunch>>()

/** Joins the run already in flight under `key` (or `waiting`), else starts `run` under it. */
export function joinOrRunAgentLaunch(
  runtime: OrcaRuntimeService,
  launch: { key: string; fingerprint: string; waiting?: InFlightAgentLaunch },
  run: () => Promise<AgentLaunchResult>
): Promise<AgentLaunchResult> {
  const { key, fingerprint } = launch
  let inFlight = inFlightByRuntime.get(runtime)
  if (!inFlight) {
    inFlight = new Map()
    inFlightByRuntime.set(runtime, inFlight)
  }
  const active = inFlight.get(key) ?? launch.waiting
  if (active) {
    if (active.fingerprint !== fingerprint) {
      return Promise.reject(new Error('agent_session_operation_conflict'))
    }
    return active.promise
  }
  const promise: Promise<AgentLaunchResult> = run().finally(() => {
    if (inFlight.get(key)?.promise === promise) {
      inFlight.delete(key)
    }
  })
  inFlight.set(key, { fingerprint, promise })
  return promise
}
