/** One run per launch operation in this process: a replay of the same click joins the run. */

import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import type { OrcaRuntimeService } from '../../orca-runtime'

type InFlightAgentLaunch = {
  fingerprint: string
  promise: Promise<AgentLaunchResult>
}

const inFlightByRuntime = new WeakMap<OrcaRuntimeService, Map<string, InFlightAgentLaunch>>()

/** Joins the run already in flight under `key`, else starts `run` under it. A run may keep itself
 *  joinable past its answer, until a settlement it names. */
export function joinOrRunAgentLaunch(
  runtime: OrcaRuntimeService,
  launch: { key: string; fingerprint: string },
  run: (keepJoinableUntil: (settled: Promise<void>) => void) => Promise<AgentLaunchResult>
): Promise<AgentLaunchResult> {
  const { key, fingerprint } = launch
  let inFlight = inFlightByRuntime.get(runtime)
  if (!inFlight) {
    inFlight = new Map()
    inFlightByRuntime.set(runtime, inFlight)
  }
  const active = inFlight.get(key)
  if (active) {
    if (active.fingerprint !== fingerprint) {
      return Promise.reject(new Error('agent_session_operation_conflict'))
    }
    return active.promise
  }
  let kept: Promise<void> | undefined
  const promise = run((settled) => (kept = settled))
  inFlight.set(key, { fingerprint, promise })
  const forget = (): void => {
    if (inFlight.get(key)?.promise === promise) {
      inFlight.delete(key)
    }
  }
  void promise
    .then(
      () => kept,
      () => undefined
    )
    .then(forget, forget)
  return promise
}
