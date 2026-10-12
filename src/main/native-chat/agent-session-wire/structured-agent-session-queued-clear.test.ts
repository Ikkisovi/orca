// A /clear asked to wait (`delivery`) while the agent works: held as a card like a queued /compact,
// answered at once, and run by the host itself when its turn comes, in the same conversation. The
// cards sent after it run in the fresh context, in order. Refused at its turn, it comes back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentChildWorkView } from '../../../shared/agent-status-child-work-view'
import { agentSessionOperationKey } from '../../../shared/agent-session-operation-ledger'
import {
  createQueuedMessageTestRig,
  eventually,
  QUEUED_RIG_CALLER as CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestOperationId
} from './structured-agent-session-host-test-data'
import { QUEUED_CLEAR_CALLER_KEY } from './structured-conversation-clear'

let rig: QueuedMessageTestRig

beforeEach(async () => {
  rig = await createQueuedMessageTestRig()
})

afterEach(() => rig.dispose())

function clear(delivery?: 'queue-if-active', clientOperationId = hostTestOperationId()) {
  const fields = { command: 'clear' as const, ...(delivery ? { delivery } : {}) }
  return rig.host.conversationCommand(CALLER, {
    envelope: rig.envelope(fields, 'agentSession.conversationCommand', clientOperationId),
    ...fields,
    userSend: true
  })
}

async function queuedClear(): Promise<string> {
  const id = hostTestOperationId()
  expect(await clear('queue-if-active', id)).toMatchObject({
    ok: true,
    value: { command: 'clear', state: 'completed', queued: { messageId: id, state: 'waiting' } }
  })
  return id
}

async function queuedSend(text: string): Promise<string> {
  const sent = await rig.send(text, 'queue-if-active').result
  if (!sent.ok || !('queued' in sent.value)) {
    throw new Error('expected a queued receipt')
  }
  return sent.value.queued.messageId
}

function journal() {
  return rig.host.collaboratorsForTests().sessions.get(SESSION)!.journal
}

async function dividers(): Promise<number> {
  return (await rig.host.journalSnapshot(SESSION)).items.filter(
    (item) => item.body.kind === 'status' && item.body.presentation === 'context-cleared'
  ).length
}

const BACKGROUND_TASK: AgentChildWorkView = {
  id: 'child-dev',
  providerId: 'task-dev',
  kind: 'command',
  description: 'npm run dev',
  state: 'working',
  membership: 'live',
  firstObservedAt: 1,
  observedAt: 1,
  stoppable: true,
  invocation: { invocationId: 'spawn-dev', generation: 1 }
}

const SETTLED_TASK: AgentChildWorkView = {
  ...BACKGROUND_TASK,
  state: 'done',
  membership: 'settled',
  outcome: 'cancelled'
}

/** The session's child work as the strip reads it, set by the test. */
function childWork(): { set: (next: AgentChildWorkView[]) => void } {
  let tasks: AgentChildWorkView[] = []
  Object.assign(rig.host.deps, {
    statusSink: { publish: () => {}, forget: () => {}, readChildWork: () => tasks }
  })
  return { set: (next) => (tasks = next) }
}

/** The clear's commit fails once: a disk error inside its one transaction. */
function failNextClearCommit(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(rig.store.conversationReceipts, 'clear').mockReturnValueOnce({
    write: () => {
      throw new Error('disk full')
    },
    committed: () => {}
  })
}

const settleMs = () => new Promise((resolve) => setTimeout(resolve, 150))

/** The next start opens a new provider thread instead of resuming the old one. */
function expectFreshProviderContext(): void {
  const boundary = rig.store.getRecord(SESSION)?.providerContextBoundary
  expect(boundary).toBeDefined()
  expect(rig.store.getRecord(SESSION)?.providerHandleChain.at(-1)?.handle.nativeId).toContain(
    `-context-${boundary!.operationId}`
  )
}

describe('a /clear that waits in line', () => {
  it('mid-turn: a card at once, nothing stopped or cleared yet', async () => {
    await rig.workingSend()
    const clearId = await queuedClear()
    expect(await rig.drafts()).toEqual([{ messageId: clearId, state: 'waiting' }])
    expect(journal().queuedMessages.get(clearId)?.body).toMatchObject({
      blocks: [{ type: 'text', text: '/clear' }],
      command: { name: 'clear' }
    })
    await settleMs()
    expect(rig.closeSession).not.toHaveBeenCalled()
    expect(rig.store.getRecord(SESSION)?.providerContextBoundary).toBeUndefined()
    expect(await dividers()).toBe(0)
  })

  it('runs in the same chat once the turn ends: one divider, spent in that write, never sent', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    await rig.settleAccepted(working, 'a')
    await eventually(async () => expect(await dividers()).toBe(1))
    expect(rig.closeSession).toHaveBeenCalled()
    expect(rig.store.getRecord(SESSION)).toMatchObject({
      providerHandleChain: [],
      conversationCommand: {
        command: 'clear',
        operationId: clearId,
        callerKey: QUEUED_CLEAR_CALLER_KEY,
        phase: 'committed'
      }
    })
    expect(journal().queuedMessages.get(clearId)).toMatchObject({
      state: 'withdrawn',
      settledByOp: agentSessionOperationKey(QUEUED_CLEAR_CALLER_KEY, clearId)
    })
    expect(await rig.drafts()).toEqual([])
    expect(await rig.handoff(clearId)).toBeUndefined()
    expect(rig.dispatch).toHaveBeenCalledOnce()
    expect(rig.compact).not.toHaveBeenCalled()
    expect(rig.host.collaboratorsForTests().sessions.has(SESSION)).toBe(true)
    expect(rig.store.listRecords()).toHaveLength(1)
  })

  it('the cards sent after it run in the fresh context, in order, unpaused', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    const first = await queuedSend('first after the clear')
    const second = await queuedSend('second after the clear')
    await rig.settleAccepted(working, 'a')
    await eventually(async () => expect(await rig.handoff(first)).toBeDefined())
    expect(await dividers()).toBe(1)
    expect(await rig.queuePause()).toBeNull()
    expect(journal().queuedMessages.pauses()).toEqual([])
    expectFreshProviderContext()
    // The first is the agent's work now, so the second waits for it.
    await settleMs()
    expect(await rig.drafts()).toEqual([{ messageId: second, state: 'waiting' }])
    await rig.settleAccepted(await rig.handoffId(first), 'b')
    await eventually(async () => expect(await rig.handoff(second)).toBeDefined())
    const sent = (await rig.host.journalSnapshot(SESSION)).submissions
    expect(sent.flatMap((entry) => (entry.queuedMessageId ? [entry.queuedMessageId] : []))).toEqual(
      [first, second]
    )
    expect(sent.some((entry) => entry.queuedMessageId === clearId)).toBe(false)
    expect(await dividers()).toBe(1)
  })

  it('a Send that finds its card already spent by its own clear answers with it', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    await rig.settleAccepted(working, 'a')
    await eventually(async () => expect(await dividers()).toBe(1))
    expect(await rig.sendNow(clearId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    expect(await dividers()).toBe(1)
  })

  it('a Send whose clear ran but whose receipt did not land answers with the card on retry', async () => {
    await rig.workingSend()
    const clearId = await queuedClear()
    await rig.quitRestartHostProcess()
    await settleMs()
    const sendId = hostTestOperationId()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(rig.store, 'commitOperationReceipt').mockRejectedValueOnce(new Error('disk full'))
    expect(await rig.sendNow(clearId, sendId)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_unknown' }
    })
    expect(await dividers()).toBe(1)
    expect(await rig.sendNow(clearId, sendId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    expect(await dividers()).toBe(1)
  })

  it('a typed /clear that spends a held card leaves the Stop holding the cards behind it', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    const after = await queuedSend('after the clear')
    await rig.stop()
    await rig.settleAccepted(working, 'a')
    await settleMs()
    const answer = await clear('queue-if-active')
    expect(answer).toMatchObject({ ok: true, value: { command: 'clear', state: 'completed' } })
    expect(answer.ok && answer.value.queued).toBeFalsy()
    expect(journal().queuedMessages.get(clearId)?.state).toBe('withdrawn')
    await settleMs()
    expect(await rig.handoff(after)).toBeUndefined()
    expect(await rig.queuePause()).toEqual({ reason: 'stopped' })
    expect(await rig.resume()).toMatchObject({ ok: true, value: { resumed: true } })
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
    expect(await dividers()).toBe(1)
  })

  it('never steers: its Send mid-turn is refused and the card is unchanged', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    expect(await rig.sendNow(clearId)).toMatchObject({
      ok: false,
      refusal: { message: "A command can't be sent while the agent is working." }
    })
    expect(await rig.drafts()).toEqual([{ messageId: clearId, state: 'waiting' }])
    expect(await dividers()).toBe(0)
    await rig.settleAccepted(working, 'a')
    await eventually(async () => expect(await dividers()).toBe(1))
  })

  it('Stop pauses it with the queue; Resume runs it, then the next card', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    const after = await queuedSend('after the clear')
    await rig.stop()
    await rig.settleAccepted(working, 'a')
    await settleMs()
    expect(await rig.queuePause()).toEqual({ reason: 'stopped' })
    expect(await rig.drafts()).toEqual([
      { messageId: clearId, state: 'waiting' },
      { messageId: after, state: 'waiting' }
    ])
    expect(await dividers()).toBe(0)
    expect(await rig.resume()).toMatchObject({ ok: true, value: { resumed: true } })
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
    expect(await dividers()).toBe(1)
  })

  it('held by a reopen; its Send runs it, and it never runs twice', async () => {
    await rig.workingSend()
    const clearId = await queuedClear()
    await rig.quitRestartHostProcess()
    await settleMs()
    expect(await rig.drafts()).toEqual([{ messageId: clearId, state: 'waiting' }])
    expect(await dividers()).toBe(0)
    const sendId = hostTestOperationId()
    expect(await rig.sendNow(clearId, sendId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    expect(await dividers()).toBe(1)
    // The same Send again answers from its receipt.
    expect(await rig.sendNow(clearId, sendId)).toMatchObject({
      ok: true,
      replayed: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    await rig.quitRestartHostProcess()
    await rig.host.journalSnapshot(SESSION)
    await settleMs()
    expect(await dividers()).toBe(1)
    expect(await rig.drafts()).toEqual([])
  })

  it('a resent request answers from its card, then as withdrawn; one clear', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    expect(await clear('queue-if-active', clearId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'waiting' } }
    })
    await rig.settleAccepted(working, 'a')
    await eventually(async () => expect(await dividers()).toBe(1))
    expect(await clear('queue-if-active', clearId)).toMatchObject({
      ok: true,
      value: { command: 'clear', queued: { messageId: clearId, state: 'withdrawn' } }
    })
    await settleMs()
    expect(await dividers()).toBe(1)
  })

  it('an id that cleared at once, resent while the agent works, answers that clear, never a card', async () => {
    const id = hostTestOperationId()
    expect(await clear('queue-if-active', id)).toMatchObject({
      ok: true,
      value: { command: 'clear', state: 'completed', operationId: id }
    })
    await rig.workingSend()
    expect(await clear('queue-if-active', id)).toMatchObject({
      ok: true,
      replayed: true,
      value: { command: 'clear', state: 'completed', operationId: id }
    })
    expect(await rig.drafts()).toEqual([])
    expect(await dividers()).toBe(1)
  })

  it('its Send over a paused queue holds the cards before it, and leaves those after it', async () => {
    const working = await rig.workingSend()
    const before = await queuedSend('before the clear')
    const clearId = await queuedClear()
    const after = await queuedSend('after the clear')
    await rig.stop()
    await rig.settleAccepted(working, 'a')
    expect(await rig.sendNow(clearId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    expect(await dividers()).toBe(1)
    const pauses = journal().queuedMessages.pauses()
    expect(pauses).toContainEqual(
      expect.objectContaining({ reason: 'cleared', messageIds: [before] })
    )
    expect(
      pauses.some((pause) => pause.reason === 'cleared' && pause.messageIds?.includes(after))
    ).toBe(false)
    // The queue never reorders: the card after it waits behind the one the clear holds.
    await settleMs()
    expect(await rig.handoff(before)).toBeUndefined()
    expect(await rig.handoff(after)).toBeUndefined()
    expect(await rig.resume()).toMatchObject({ ok: true, value: { resumed: true } })
    await eventually(async () => expect(await rig.handoff(before)).toBeDefined())
  })

  it('at rest, with background tasks refused at once with no card; without, clears at once', async () => {
    const tasks = childWork()
    const working = await rig.workingSend()
    tasks.set([BACKGROUND_TASK])
    await rig.settleAccepted(working, 'a')
    expect(await clear('queue-if-active')).toMatchObject({
      ok: false,
      refusal: { details: { reason: 'backgroundTasksRunning' } }
    })
    expect(await rig.drafts()).toEqual([])
    expect(await dividers()).toBe(0)
    tasks.set([SETTLED_TASK])
    const answer = await clear('queue-if-active')
    expect(answer).toMatchObject({ ok: true, value: { command: 'clear', state: 'completed' } })
    expect(answer.ok && answer.value.queued).toBeFalsy()
    expect(await dividers()).toBe(1)
    expect(await rig.drafts()).toEqual([])
  })
})

describe('a /clear refused when its turn comes', () => {
  /** A clear card, then a card behind it, and a turn that ends leaving a background task running. */
  async function returnedForBackgroundTasks() {
    const tasks = childWork()
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    const after = await queuedSend('after the clear')
    tasks.set([BACKGROUND_TASK])
    await rig.settleAccepted(working, 'a')
    await eventually(async () =>
      expect(await rig.drafts()).toEqual([
        { messageId: clearId, state: 'returned' },
        { messageId: after, state: 'waiting' }
      ])
    )
    return { tasks, clearId, after }
  }

  it('background tasks: returned with why; nothing stopped; the cards behind it hold', async () => {
    const { clearId, after } = await returnedForBackgroundTasks()
    expect(journal().queuedMessages.get(clearId)).toMatchObject({
      returnedRejection: {
        kind: 'commandRefused',
        refusal: { details: { reason: 'backgroundTasksRunning' } }
      }
    })
    expect(journal().queuedMessages.get(clearId)?.returnedReason).toContain(
      'Background tasks are still running.'
    )
    expect(rig.closeSession).not.toHaveBeenCalled()
    expect(rig.store.getRecord(SESSION)?.providerContextBoundary).toBeUndefined()
    await settleMs()
    expect(await rig.handoff(after)).toBeUndefined()
    expect(await dividers()).toBe(0)
    // A message typed now is not trapped behind it: the person acting now wins.
    const next = rig.send('stop the dev server', 'queue-if-active')
    const sent = await next.result
    expect(sent.ok && 'queued' in sent.value).toBe(false)
    await eventually(async () =>
      expect((await rig.submission(next.id))?.handedOverAt).toBeDefined()
    )
  })

  it('Send once the tasks end clears, then the cards behind it run in the fresh context', async () => {
    const { tasks, clearId, after } = await returnedForBackgroundTasks()
    tasks.set([SETTLED_TASK])
    const sendId = hostTestOperationId()
    expect(await rig.sendNow(clearId, sendId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    expect(await dividers()).toBe(1)
    expect(rig.store.getRecord(SESSION)?.providerContextBoundary).toBeDefined()
    // The follower's start saves the record again; the fresh context survives it.
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
    expectFreshProviderContext()
    expect(journal().queuedMessages.pauses()).toEqual([])
    expect(await rig.sendNow(clearId, sendId)).toMatchObject({
      ok: true,
      replayed: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
  })

  it('/clear typed again spends the returned card, and the cards behind it run after it', async () => {
    const { tasks, clearId, after } = await returnedForBackgroundTasks()
    tasks.set([SETTLED_TASK])
    const answer = await clear('queue-if-active')
    expect(answer).toMatchObject({ ok: true, value: { command: 'clear', state: 'completed' } })
    expect(answer.ok && answer.value.queued).toBeFalsy()
    expect(journal().queuedMessages.get(clearId)?.state).toBe('withdrawn')
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
    expect(journal().queuedMessages.pauses()).toEqual([])
    expect(await dividers()).toBe(1)
  })

  it('held by a reopen, its Send lifts the pause, so the cards behind it run', async () => {
    const { clearId, after } = await returnedForBackgroundTasks()
    await rig.quitRestartHostProcess()
    await rig.host.journalSnapshot(SESSION)
    await settleMs()
    expect(await rig.handoff(after)).toBeUndefined()
    expect(await rig.sendNow(clearId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
    expect(await dividers()).toBe(1)
  })

  it('Send while the tasks still run answers with the returned card, said once there', async () => {
    const { clearId } = await returnedForBackgroundTasks()
    expect(await rig.sendNow(clearId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'returned' } }
    })
    expect(await dividers()).toBe(0)
  })

  it('Delete lets the cards behind it run in the uncleared chat', async () => {
    const { clearId, after } = await returnedForBackgroundTasks()
    expect(await rig.deleteQueued(clearId)).toMatchObject({ ok: true, value: { deleted: true } })
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
    expect(await dividers()).toBe(0)
    expect(rig.store.getRecord(SESSION)?.providerContextBoundary).toBeUndefined()
  })

  it('a failed commit rolls back whole and returns the card; Send retries', async () => {
    const working = await rig.workingSend()
    const clearId = await queuedClear()
    const after = await queuedSend('after the clear')
    failNextClearCommit()
    await rig.settleAccepted(working, 'a')
    await eventually(async () =>
      expect(await rig.drafts()).toEqual([
        { messageId: clearId, state: 'returned' },
        { messageId: after, state: 'waiting' }
      ])
    )
    expect(await dividers()).toBe(0)
    expect(rig.store.getRecord(SESSION)?.providerContextBoundary).toBeUndefined()
    expect(journal().queuedMessages.get(clearId)).toMatchObject({
      returnedRejection: { kind: 'commandRefused' }
    })
    await settleMs()
    expect(await rig.handoff(after)).toBeUndefined()
    expect(await rig.sendNow(clearId)).toMatchObject({
      ok: true,
      value: { queued: { messageId: clearId, state: 'withdrawn' } }
    })
    expect(await dividers()).toBe(1)
    await eventually(async () => expect(await rig.handoff(after)).toBeDefined())
  })
})
