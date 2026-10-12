import type { AgentSessionProviderContextBoundary } from '../../../shared/agent-session-provider-context'
import type { JournalReducerState } from './journal-reducer'
import { journalItemRowBuilder } from './journal-row-builders'
import type { JournalOperationReceipt, JournalRowWriter } from './journal-row-writer'
import type { JournalQueuedMessages } from './journal-queued-messages'
import type { JournalTombstoneRow } from './journal-row-schema'
import {
  buildJournalQueueClearRow,
  journalQueueResumeRowBuilder
} from './journal-stop-and-resume-rows'
import { QueuedMessageNotConsumableError } from './queued-message-consume-error'
import type { QueuedMessageRow } from './queued-message-table'

/** A /clear the queue holds: the host runs it when its turn comes, never the agent. */
export function isQueuedClearCard(card: Pick<QueuedMessageRow, 'body'>): boolean {
  return card.body.command?.name === 'clear'
}

export function appendJournalContextClear(input: {
  state: () => JournalReducerState
  writer: JournalRowWriter
  cards: JournalQueuedMessages
  boundary: AgentSessionProviderContextBoundary
  receipt: JournalOperationReceipt
  settledByOp: string
  /** The /clear card this clear runs; without one, the first unsettled /clear card is this clear's. */
  ranFrom?: string
}) {
  const { boundary, state, ranFrom } = input
  let commandIds: string[] = []
  return input.writer
    .enqueueRows(
      () => {
        const all = input.cards.list()
        const unsettled = (card: QueuedMessageRow) =>
          card.state === 'waiting' || card.state === 'returned'
        const at = all.findIndex((card) =>
          ranFrom === undefined
            ? isQueuedClearCard(card) && unsettled(card)
            : card.messageId === ranFrom
        )
        // Cut through the /clear card: the cards behind it were queued for the fresh context.
        const cards = at === -1 && ranFrom === undefined ? all : all.slice(0, at + 1)
        commandIds = cards
          .filter((card) => card.body.command && unsettled(card))
          .map((card) => card.messageId)
        const messageIds = cards
          .filter((card) => card.state === 'waiting' && !card.body.command)
          .map((card) => card.messageId)
        return [
          // Run from its card, it lifts the queue's pauses as a turn the queue sends would; a typed
          // /clear never lifts a person's Stop or a reopen's pause.
          ...(ranFrom === undefined
            ? []
            : [journalQueueResumeRowBuilder(state, boundary.afterFence)]),
          journalItemRowBuilder(
            state,
            { provider: 'orca', clientMessageId: `context-clear:${boundary.operationId}` },
            {
              kind: 'status',
              text: 'Context cleared',
              presentation: 'context-cleared',
              contextClear: boundary
            },
            { fence: boundary.afterFence, turnScope: { kind: 'thread' } }
          ),
          (seq: number, ts: number): JournalTombstoneRow =>
            buildJournalQueueClearRow({
              state: state(),
              seq,
              ts,
              fence: boundary.afterFence,
              clear: { operationId: boundary.operationId, messageIds }
            })
        ]
      },
      {
        write: (db) => {
          const withdrawn = input.cards.withdrawInTransaction(db, {
            messageIds: commandIds,
            settledByOp: input.settledByOp
          })
          // The card and its clear commit together or not at all, so it never runs twice.
          if (ranFrom !== undefined && !withdrawn.includes(ranFrom)) {
            throw new QueuedMessageNotConsumableError(ranFrom, 'waiting')
          }
          input.receipt.write(db)
        },
        committed: input.receipt.committed
      }
    )
    .then((rows) => ({
      epoch: state().epoch,
      sequence: rows.at(-1)?.seq ?? state().lastSequence
    }))
}
