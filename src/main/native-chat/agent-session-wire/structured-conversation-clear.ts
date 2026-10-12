// `/clear` on the session's lane: the agent stopped, then a fresh provider context committed in the
// same conversation. The command RPC runs it at once, and the queue runs a /clear card when its turn
// comes; neither ever hands it to the agent.

import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import { agentSessionOperationKey } from '../../../shared/agent-session-operation-ledger'
import type { AgentSessionQueuedSendReceipt } from '../../../shared/agent-session-wire'
import { agentSessionRefusalReference } from '../../../shared/agent-session-wire-refusals'
import {
  providerContextBoundaryForClear,
  type AgentSessionConversationClear
} from '../../runtime/agent-session-conversation-command-record'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { QueuedMessageRow } from '../agent-session-journal/queued-message-table'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import type { TurnOutcome } from './structured-agent-session-turns'
import {
  conversationCommandBlocked,
  type ConversationCommandAdmissionContext
} from './structured-conversation-command-admission'

/** Who a clear the queue ran is recorded as: no client pressed it, so no caller replays from it. */
export const QUEUED_CLEAR_CALLER_KEY = 'trusted-local:queued-clear'

/** The key the drain spends a /clear card under. */
export function queuedClearOperationKey(messageId: string): string {
  return agentSessionOperationKey(QUEUED_CLEAR_CALLER_KEY, messageId)
}

/** What the person sent for `/clear`, as its card shows it. */
export function structuredAgentSessionClearBody(): AgentJournalMessageItem {
  return {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: '/clear' }],
    command: { name: 'clear' }
  }
}

/** A /clear card as it stands; once pruned it ran or was deleted, so withdrawn. */
export function queuedClearCardState(
  journal: Pick<AgentSessionJournal, 'queuedMessages'>,
  messageId: string
): AgentSessionQueuedSendReceipt {
  const card = journal.queuedMessages.get(messageId)
  return card
    ? { messageId, position: card.position, state: card.state }
    : { messageId, position: 0, state: 'withdrawn' }
}

export type ConversationClearContext = ConversationCommandAdmissionContext & {
  journal: AgentSessionJournal
}

/**
 * Refused while anything it would cut off is in flight; else the agent is stopped, admission is
 * read again at the stop's fence, and `commit` writes the clear. The caller holds the lane.
 */
export async function clearConversationOnLane(
  context: StructuredAgentSessionMutationContext,
  ctx: ConversationClearContext,
  marker: { operationId: string; callerKey: string },
  commit: (clear: AgentSessionConversationClear) => Promise<unknown>
): Promise<TurnOutcome<AgentSessionConversationClear['command']>> {
  const { sessionId } = ctx
  const store = context.deps.store
  const blocked = conversationCommandBlocked(
    ctx,
    store.getRecord(sessionId)!,
    context.readChildWork(sessionId),
    context.sessions.get(sessionId)?.child ? undefined : 'at-rest'
  )
  if (blocked) {
    return { ok: false, refusal: blocked }
  }
  await context.stopAgent(sessionId, { cause: 'context-clear' })
  const stopped = store.getRecord(sessionId)!
  const fence = stopped.lease.runtimeFence
  const rechecked = conversationCommandBlocked(
    { ...ctx, fence },
    stopped,
    context.readChildWork(sessionId),
    'at-rest'
  )
  if (rechecked) {
    return { ok: false, refusal: rechecked }
  }
  const command: AgentSessionConversationClear['command'] = {
    command: 'clear',
    runtimeFence: fence,
    ...marker,
    phase: 'committed',
    state: 'completed'
  }
  await commit({ sessionId, fence, command, now: context.now() })
  return { ok: true, value: command }
}

/**
 * A /clear card's turn, from the drain or its own Send, on the session's lane. The card is spent in
 * its clear's own transaction, so it runs once; refused or failed, it comes back with why, and the
 * cards behind it wait.
 */
export async function runQueuedConversationClear(
  context: StructuredAgentSessionMutationContext,
  ctx: ConversationClearContext,
  card: Pick<QueuedMessageRow, 'messageId'>,
  settledByOp = queuedClearOperationKey(card.messageId)
): Promise<void> {
  let fact = agentSessionFailureFact('commandRefused')
  const marker = { operationId: card.messageId, callerKey: QUEUED_CLEAR_CALLER_KEY }
  try {
    const cleared = await clearConversationOnLane(context, ctx, marker, (clear) =>
      ctx.journal.context.clear(
        providerContextBoundaryForClear(clear),
        // The record's only store receipt in this write: a second one would drop its adoption.
        context.deps.store.conversationReceipts.clear(() => clear, marker),
        settledByOp,
        card.messageId
      )
    )
    if (cleared.ok) {
      return
    }
    fact = agentSessionFailureFact('commandRefused', {
      refusal: agentSessionRefusalReference(cleared.refusal)
    })
  } catch (error) {
    context.deps.logger.warn('running a queued /clear failed', {
      scope: 'queued-clear',
      sessionId: ctx.sessionId,
      error
    })
  }
  const { reason, rejection } = agentSessionFailureWords(fact, {
    command: 'clear',
    surface: 'rejection'
  })
  await ctx.journal.queuedMessages.returnUnsent({ messageId: card.messageId, reason, rejection })
}
