import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { projectStructuredItemsToNativeChat } from '../../../../shared/structured-agent-session-projection'
import type { AgentJournalStatusItem } from '../../../../shared/agent-session-journal-types'
import { MessageRow } from './NativeChatMessageRow'
import {
  NativeChatOrcaStopContext,
  type NativeChatOrcaStopView
} from './native-chat-orca-stop-context'

function orcaStopView(
  hostLabel: string | null,
  continueAvailable: boolean,
  remoteHost: boolean
): NativeChatOrcaStopView {
  return { hostLabel, remoteHost, continueAvailable }
}

export function renderStatus(
  body: AgentJournalStatusItem,
  hostLabel: string | null = null,
  continueAvailable = false,
  remoteHost = false,
  agentName?: string
) {
  const [message] = projectStructuredItemsToNativeChat([
    {
      itemId: 'notice',
      sequence: 1,
      revision: 1,
      observedAt: 1,
      body,
      turnScope: { kind: 'turn', turnItemId: 'cut-turn' }
    }
  ])
  const view = orcaStopView(hostLabel, continueAvailable, remoteHost)
  return render(
    <NativeChatOrcaStopContext.Provider value={view}>
      <MessageRow
        message={message!}
        agentName={agentName}
        expandSignal={false}
        onScrollMessageToTop={vi.fn()}
      />
    </NativeChatOrcaStopContext.Provider>
  )
}
