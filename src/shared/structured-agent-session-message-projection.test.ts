// A send the host kept as a card is drawn only as that card: the rule rides on the submission's
// own fact, never on the card still being there.

import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem, AgentJournalSubmission } from './agent-session-journal-types'
import { agentJournalSubmissionKey } from './agent-session-journal-item-key'
import { structuredAgentSessionSendBody } from './structured-agent-session-send-mutation'
import { projectStructuredAgentSessionMessages } from './structured-agent-session-message-projection'
import { projectNativeChatTranscriptMessages } from './native-chat-transcript-projection'
import { DISPATCH_REJECTED_CANCELLED } from './structured-agent-session-dispatch-rejection'

const KEPT_ID = 'client-kept'
// The desktop draws a rejected send in place, as not sent, unless the host kept it as a card.
const DESKTOP = { rejectedInPlace: true }

function rejected(fields: Partial<AgentJournalSubmission> = {}): AgentJournalSubmission {
  return {
    clientMessageId: KEPT_ID,
    fence: 1,
    payloadFingerprint: 'fingerprint-kept',
    dispatchState: 'rejected',
    providerItemId: null,
    reason: 'Orca restarted before this message was sent.',
    rejection: { kind: 'hostRestarted' },
    submittedAt: 1,
    resolvedAt: 2,
    ...fields
  }
}

function userItem(id: string, text: string, sequence: number): AgentJournalRenderItem {
  return {
    itemId: agentJournalSubmissionKey(id),
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
  }
}

/** The sending desktop's own bubble, had it not settled yet. */
const lingeringCopy = {
  clientMessageId: KEPT_ID,
  body: structuredAgentSessionSendBody('the kept words', []),
  queuedAt: 1
}

describe('a send kept as a card', () => {
  it('shows nothing of the original send, even beside its own local copy', () => {
    const kept = rejected({ keptAsQueuedMessageId: KEPT_ID })
    const items = [userItem(KEPT_ID, 'the kept words', 1)]
    expect(projectStructuredAgentSessionMessages(items, [lingeringCopy], [kept], DESKTOP)).toEqual(
      []
    )
    // A rejection with no card is drawn from the host's row, marked not sent.
    expect(
      projectStructuredAgentSessionMessages(items, [lingeringCopy], [rejected()], DESKTOP)
    ).toEqual([expect.objectContaining({ id: agentJournalSubmissionKey(KEPT_ID), unsent: true })])
  })

  // Edit is the card's text in the composer, then the card's Delete, then a new send.
  it('after an Edit sent again, shows exactly the new send', () => {
    const kept = rejected({ keptAsQueuedMessageId: KEPT_ID })
    const edited: AgentJournalSubmission = {
      ...rejected(),
      clientMessageId: 'client-edited',
      dispatchState: 'accepted',
      providerItemId: 'provider-edited',
      reason: null
    }
    delete edited.rejection
    const shown = projectStructuredAgentSessionMessages(
      [userItem(KEPT_ID, 'the kept words', 1), userItem('client-edited', 'the edited words', 2)],
      [lingeringCopy],
      [kept, edited],
      DESKTOP
    )
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ blocks: [{ text: 'the edited words' }] })
    expect(shown[0]).not.toHaveProperty('unsent')
  })
})

describe('a not-sent row', () => {
  const said = (id: string, text: string, sequence: number): AgentJournalRenderItem => ({
    itemId: id,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
  })
  const delivered = (id: string, submittedAt: number): AgentJournalSubmission => ({
    ...rejected({ clientMessageId: id, payloadFingerprint: id, submittedAt }),
    dispatchState: 'accepted',
    reason: null,
    rejection: undefined
  })
  const items = [
    userItem('first', 'first', 1),
    said('reply-1', 'one', 2),
    userItem(KEPT_ID, 'not sent', 3),
    userItem('later', 'later', 4),
    said('reply-2', 'two', 5)
  ]
  const submissions = [delivered('first', 1), rejected(), delivered('later', 3)]

  // The phone draws the list as given, so the projection itself puts the row in place.
  it('is listed where the host recorded it, not after later turns', () => {
    const shown = projectStructuredAgentSessionMessages(items, [], submissions, DESKTOP)
    expect(shown.map((message) => [message.id, message.unsent ?? false])).toEqual([
      [agentJournalSubmissionKey('first'), false],
      ['reply-1', false],
      [agentJournalSubmissionKey(KEPT_ID), true],
      [agentJournalSubmissionKey('later'), false],
      ['reply-2', false]
    ])
    // The desktop sorts by the same order, so what it draws is unchanged.
    expect(projectNativeChatTranscriptMessages(shown).map((message) => message.id)).toEqual(
      shown.map((message) => message.id)
    )
  })

  it('follows the stop row of a send taken back before it', () => {
    const stoppedId = 'stopped'
    const shown = projectStructuredAgentSessionMessages(
      [userItem(stoppedId, 'taken back', 1), userItem(KEPT_ID, 'not sent', 2)],
      [],
      [
        rejected({
          clientMessageId: stoppedId,
          payloadFingerprint: stoppedId,
          reason: DISPATCH_REJECTED_CANCELLED,
          rejection: undefined
        }),
        rejected({ submittedAt: 3 })
      ],
      DESKTOP
    )
    expect(shown.map((message) => message.id)).toEqual([
      agentJournalSubmissionKey(stoppedId),
      `stopped-before-start:${agentJournalSubmissionKey(stoppedId)}`,
      agentJournalSubmissionKey(KEPT_ID)
    ])
  })
})
