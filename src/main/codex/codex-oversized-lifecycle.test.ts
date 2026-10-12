import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createFakePipedChild } from '../../shared/__fixtures__/fake-spawned-child'
import { agentJournalToolCallLifecycle } from '../../shared/agent-journal-tool-call-lifecycle'
import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { structuredAgentSessionStatusBlock } from '../../shared/structured-agent-session-status-block'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import { createTrackedJournalOpener } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { createDeferredStructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { recordingStructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'
import {
  settleStructuredAgentSessionChildExit,
  type StructuredAgentSessionChildExitSession
} from '../native-chat/agent-session-wire/structured-agent-session-child-exit'
import * as recordReader from '../provider-process/provider-record-reader'
import { isProviderRecord } from '../provider-process/provider-json-record'
import {
  openCodexAppServerConnection,
  type CodexAppServerConnection
} from './codex-app-server-connection'
import {
  adapterFor,
  fakeCodex,
  identityFor,
  THREAD_ID
} from './codex-structured-session-adapter-fixture'
import type { CodexStructuredSessionEvent } from './codex-structured-session-adapter'

const SESSION = 'oversized-lifecycle'
const TURN = 'turn-1'
const journals = createTrackedJournalOpener()
const roots: string[] = []
const cleanup: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close()
  }
  vi.restoreAllMocks()
  await journals.closeAll()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function openedSession() {
  const root = await mkdtemp(join(tmpdir(), 'orca-codex-oversized-'))
  roots.push(root)
  const identity = identityFor(SESSION)
  const journal = await journals.open({ identity, stateDirectory: root })
  const logger = recordingStructuredAgentSessionLogger().logger
  const deferred = createDeferredStructuredAgentSessionEventSink({
    sessionId: SESSION,
    logger,
    onFailed: () => {
      throw new Error('journal admission failed')
    }
  })
  deferred.bind({ journal, fence: 7, publish: () => undefined })
  const child = createFakePipedChild(9_999_999)
  const send = (method: string, params: unknown) =>
    child.stdout.write(`${JSON.stringify({ method, params })}\n`)
  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
      const message: unknown = JSON.parse(line)
      if (!isProviderRecord(message) || typeof message.id !== 'number') {
        continue
      }
      const result =
        message.method === 'thread/resume' || message.method === 'thread/start'
          ? { thread: { id: THREAD_ID, turns: [] }, model: 'gpt-test' }
          : message.method === 'model/list'
            ? { data: [] }
            : {}
      child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`)
    }
  })
  let rejectRecord: Parameters<
    typeof recordReader.createProviderRecordReader
  >[0]['onRejected'] = () => {
    throw new Error('reader was not bound')
  }
  const originalReader = recordReader.createProviderRecordReader
  vi.spyOn(recordReader, 'createProviderRecordReader').mockImplementation((input) => {
    rejectRecord = input.onRejected
    // Inject the framer's rejection without allocating 64 MiB; following lines share its feed.
    return originalReader({
      ...input,
      onRecord: (record, line) => {
        if (
          isProviderRecord(record) &&
          record.method === 'test/oversized' &&
          typeof record.prefix === 'string'
        ) {
          rejectRecord({
            kind: 'line-too-long',
            prefix: record.prefix,
            maxLineBytes: recordReader.PROVIDER_RECORD_MAX_BYTES,
            observedBytes: recordReader.PROVIDER_RECORD_MAX_BYTES + 1
          })
        } else {
          input.onRecord(record, line)
        }
      }
    })
  })
  const events: CodexStructuredSessionEvent[] = []
  let connection: CodexAppServerConnection | undefined
  const adapter = adapterFor(fakeCodex(), {}, events, {
    openConnection: async (launch, handlers) => {
      connection = await openCodexAppServerConnection(launch, handlers, () => child)
      return connection
    },
    logger
  })
  cleanup.push(async () => {
    child.emit('exit', 0, null)
    await adapter.closeSession(SESSION)
    deferred.close()
  })
  const acquisition = await adapter.acquire({
    identity,
    fence: 7,
    spawnToken: 'spawn-test',
    events: deferred.sink
  })
  const generation = acquisition.acquisitionGeneration
  if (!generation) {
    throw new Error('missing acquisition generation')
  }
  const drain = async () => {
    await new Promise((resolve) => setImmediate(resolve))
    await expect(deferred.drained()).resolves.toEqual({ ok: true })
  }
  send('turn/started', { threadId: THREAD_ID, turn: { id: TURN, status: 'inProgress' } })
  await drain()
  expect(journal.activeTurnId()).toBe(TURN)
  const reject = (prefix: string) =>
    rejectRecord({
      kind: 'line-too-long',
      prefix,
      maxLineBytes: recordReader.PROVIDER_RECORD_MAX_BYTES,
      observedBytes: recordReader.PROVIDER_RECORD_MAX_BYTES + 1
    })
  const settleExit = async () => {
    child.emit('exit', 0, null)
    await drain()
    const ended = events.find((event) => event.type === 'ended' && 'cause' in event)
    if (!ended || ended.type !== 'ended' || !('cause' in ended)) {
      throw new Error('connection did not report its observed exit')
    }
    let record: AgentSessionRecord = {
      ...agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: SESSION })),
      provider: 'codex'
    }
    const hostSession: StructuredAgentSessionChildExitSession = {
      child: { generation, fence: 7, phase: 'ready' },
      journal
    }
    await settleStructuredAgentSessionChildExit(
      {
        logger,
        store: {
          getRecord: () => record,
          transitionHandoff: async (_sessionId, transition) => (record = transition(record))
        },
        sessions: new Map([[SESSION, hostSession]]),
        flushLifecycle: () => deferred.lifecycleBarrier(),
        publishFence: () => undefined,
        serialize: async (_sessionId, task) => task(),
        now: () => Date.now()
      },
      ended
    )
    expect(journal.activeTurnId()).toBeNull()
    expect(adapter.holdsLiveProviderProcess(SESSION, generation)).toBe(false)
    expect(
      journal
        .snapshot()
        .items.map((item) => readAgentJournalTurn(item.body)?.state)
        .filter(Boolean)
    ).toEqual(['interrupted'])
    expect(
      journal
        .snapshot()
        .items.filter((item) => item.body.kind === 'status' && item.body.tone === 'error')
    ).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          failure: expect.objectContaining({ kind: 'providerExited' }),
          text: 'Codex stopped while this response was in progress. You can continue in this conversation.'
        })
      })
    ])
    const status = journal
      .snapshot()
      .items.find((item) => item.body.kind === 'status' && item.body.tone === 'error')?.body
    if (!status || status.kind !== 'status') {
      throw new Error('missing exit error row')
    }
    expect(status.failure?.detail).toEqual({
      audience: 'log',
      text: 'Codex sent a completion update over 64 MB, so Orca could not read its outcome. Check any file changes before retrying.'
    })
    expect(structuredAgentSessionStatusBlock(status).providerFrame?.payload.head).toBe(
      status.failure?.detail?.text
    )
    return ended
  }
  const rejectThenComplete = (prefix: string) =>
    child.stdout.write(
      [
        JSON.stringify({ method: 'test/oversized', prefix }),
        JSON.stringify({
          method: 'turn/completed',
          params: { threadId: THREAD_ID, turn: { id: TURN, status: 'completed' } }
        }),
        ''
      ].join('\n')
    )
  return {
    journal,
    send,
    reject,
    rejectThenComplete,
    drain,
    settleExit,
    events,
    closed: () => connection?.closed
  }
}

it('ends a turn whose oversized completion is followed by idle, only after the observed exit', async () => {
  const session = await openedSession()
  session.reject(
    '{"method":"turn/completed","params":{"threadId":"thread-abc","turn":{"id":"turn-1","items":[{"text":"'
  )
  expect(session.closed()).toBe(true)
  session.send('thread/status/changed', { threadId: THREAD_ID, status: { type: 'idle' } })
  await session.drain()
  expect(session.events.some((event) => event.type === 'ended')).toBe(false)
  const ended = await session.settleExit()
  expect(ended.reason).toContain('over 64 MB')
})

it('does not call a successful large deletion failed when its completion was unreadable', async () => {
  const session = await openedSession()
  session.send('item/started', {
    threadId: THREAD_ID,
    turnId: TURN,
    item: {
      id: 'patch',
      type: 'fileChange',
      status: 'inProgress',
      changes: [{ path: 'large.txt', kind: { type: 'delete' }, diff: '' }]
    }
  })
  await session.drain()
  // Already-buffered success must not settle the lost completion before the child exits.
  session.rejectThenComplete(
    '{"method":"item/completed","params":{"threadId":"thread-abc","turnId":"turn-1","item":{"id":"patch","type":"fileChange","status":"completed","changes":[{"path":"large.txt","diff":"'
  )
  await session.drain()
  expect(session.journal.activeTurnId()).toBe(TURN)
  await session.settleExit()
  const patch = session.journal
    .snapshot()
    .items.find((item) => item.body.kind === 'tool-call')?.body
  if (!patch || patch.kind !== 'tool-call') {
    throw new Error('missing file-change row')
  }
  expect(patch.name).toBe('apply_patch')
  expect(agentJournalToolCallLifecycle(patch)).toBe('interrupted')
})

it('continues normal small item and turn completions after an oversized data-only update', async () => {
  const session = await openedSession()
  session.reject('{"method":"turn/diff/updated","params":{"diff":"')
  session.send('item/started', {
    threadId: THREAD_ID,
    turnId: TURN,
    item: { id: 'command', type: 'commandExecution', command: 'echo ok', status: 'inProgress' }
  })
  session.send('item/completed', {
    threadId: THREAD_ID,
    turnId: TURN,
    item: {
      id: 'command',
      type: 'commandExecution',
      command: 'echo ok',
      status: 'completed',
      exitCode: 0
    }
  })
  session.send('turn/completed', { threadId: THREAD_ID, turn: { id: TURN, status: 'completed' } })
  await session.drain()
  expect(session.journal.activeTurnId()).toBeNull()
  const call = session.journal.snapshot().items.find((item) => item.body.kind === 'tool-call')?.body
  if (!call || call.kind !== 'tool-call') {
    throw new Error('missing command row')
  }
  expect(agentJournalToolCallLifecycle(call)).toBe('completed')
  expect(session.events.some((event) => event.type === 'ended')).toBe(false)
})
