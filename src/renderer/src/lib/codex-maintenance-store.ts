import {
  callCodexMaintenance,
  codexMaintenanceTargetKey,
  type CodexMaintenanceTarget
} from './codex-maintenance-client'
import type { CodexMaintenanceState } from '../../../shared/codex-cli-maintenance'
import { useAppStore } from '@/store'

type CodexMaintenanceEntry = {
  state: CodexMaintenanceState | null
  logJob: CodexMaintenanceState['job']
  starting: boolean
  error: string | null
}
const EMPTY: CodexMaintenanceEntry = {
  state: null,
  logJob: null,
  starting: false,
  error: null
}
let entries: ReadonlyMap<string, CodexMaintenanceEntry> = new Map()
const listeners = new Set<() => void>()
const reads = new Map<string, Promise<void>>()
const polls = new Map<string, ReturnType<typeof setTimeout>>()

export function getCodexMaintenanceHostBusy(target: CodexMaintenanceTarget): boolean {
  const entry = getCodexMaintenanceEntry(codexMaintenanceTargetKey(target))
  const job = entry.state?.currentJob === undefined ? entry.state?.job : entry.state.currentJob
  return entry.starting || (!entry.error && (job?.phase === 'queued' || job?.phase === 'running'))
}

function publish(key: string, patch: Partial<CodexMaintenanceEntry>): void {
  const next = new Map(entries).set(key, { ...getCodexMaintenanceEntry(key), ...patch })
  entries = next
  for (const listener of listeners) {
    listener()
  }
}

function acceptState(key: string, state: CodexMaintenanceState): void {
  publish(key, { state, ...(state.job ? { logJob: state.job } : {}), error: null })
}

function publishFailure(key: string, error: unknown): void {
  publish(key, { error: error instanceof Error ? error.message : String(error) })
}

export function subscribeCodexMaintenance(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function getCodexMaintenanceEntry(key: string): CodexMaintenanceEntry {
  return entries.get(key) ?? EMPTY
}
function runningJob(state: CodexMaintenanceState): string | null {
  const job = state.currentJob === undefined ? state.job : state.currentJob
  return job?.phase === 'queued' || job?.phase === 'running' ? job.id : null
}

function refreshDetectedAgents(target: CodexMaintenanceTarget): void {
  const store = useAppStore.getState()
  const refresh =
    target.kind === 'environment'
      ? store.refreshRuntimeDetectedAgents(target.environmentId)
      : store.refreshDetectedAgents()
  void refresh.catch(() => {})
}

function scheduleRead(target: CodexMaintenanceTarget, jobId: string, failures = 0): void {
  const key = codexMaintenanceTargetKey(target)
  clearTimeout(polls.get(key))
  polls.set(
    key,
    setTimeout(() => {
      polls.delete(key)
      if (getCodexMaintenanceEntry(key).starting) {
        return
      }
      const read = callCodexMaintenance(target, { operation: 'read', jobId })
        .then((state) => {
          if (reads.get(key) !== read) {
            return
          }
          acceptState(key, state)
          const running = runningJob(state)
          if (running) {
            scheduleRead(target, running)
          } else {
            refreshDetectedAgents(target)
            reads.delete(key)
            void refreshCodexMaintenance(target)
          }
        })
        .catch((error: unknown) => {
          if (reads.get(key) !== read) {
            return
          }
          publishFailure(key, error)
          if (failures < 2) {
            scheduleRead(target, jobId, failures + 1)
          }
        })
        .finally(() => {
          if (reads.get(key) === read) {
            reads.delete(key)
          }
        })
      reads.set(key, read)
    }, 1_000)
  )
}

export function refreshCodexMaintenance(target: CodexMaintenanceTarget): Promise<void> {
  const key = codexMaintenanceTargetKey(target)
  if (getCodexMaintenanceEntry(key).starting) {
    return Promise.resolve()
  }
  const pending = reads.get(key)
  if (pending) {
    return pending
  }
  clearTimeout(polls.get(key))
  polls.delete(key)
  const read = callCodexMaintenance(target, { operation: 'status' })
    .then((state) => {
      if (reads.get(key) !== read) {
        return
      }
      acceptState(key, state)
      const running = runningJob(state)
      if (running) {
        scheduleRead(target, running)
      }
    })
    .catch((error: unknown) => {
      if (reads.get(key) === read) {
        publishFailure(key, error)
      }
    })
    .finally(() => {
      if (reads.get(key) === read) {
        reads.delete(key)
      }
    })
  reads.set(key, read)
  return read
}

export function startCodexMaintenance(target: CodexMaintenanceTarget): void {
  const key = codexMaintenanceTargetKey(target)
  if (getCodexMaintenanceHostBusy(target)) {
    return
  }
  clearTimeout(polls.get(key))
  polls.delete(key)
  reads.delete(key)
  publish(key, { starting: true, error: null })
  void callCodexMaintenance(target, { operation: 'start' })
    .then((state) => {
      acceptState(key, state)
      const running = runningJob(state)
      if (running) {
        scheduleRead(target, running)
      } else {
        refreshDetectedAgents(target)
      }
    })
    .catch((error: unknown) => publishFailure(key, error))
    .finally(() => {
      publish(key, { starting: false })
      if (!getCodexMaintenanceHostBusy(target) && !getCodexMaintenanceEntry(key).error) {
        void refreshCodexMaintenance(target)
      }
    })
}

export function resetCodexMaintenanceStoreForTests(): void {
  for (const timer of polls.values()) {
    clearTimeout(timer)
  }
  polls.clear()
  reads.clear()
  entries = new Map()
}
