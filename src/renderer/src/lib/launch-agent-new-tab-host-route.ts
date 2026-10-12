import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { agentLaunchPaneNoticeText } from '@/components/terminal-pane/agent-launch-pane-notice-text'
import {
  launchAgentThroughHost,
  startPaneLaunch,
  windowMakesHostLaunchTab,
  type HostAgentLaunchArgs,
  type HostAgentLaunchOutcome
} from '@/lib/agent-launch-through-host'
import { pasteAgentLaunchPromptOnceReady } from '@/lib/launch-agent-tab-prompt-paste'
import { getAgentLabel } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import { PROJECT_RUNTIME_REPAIR_REQUIRED_CODE } from '../../../shared/project-runtime-repair-message'
import type { TuiAgent } from '../../../shared/tui-agent'

/**
 * Whether a new agent tab is an AI button's launch: by the host's rules, its prompt pasted once
 * the agent is ready (temporary: until the host delivers it). A typed prompt (`auto-submit`,
 * `draft`) keeps the window's rules, and a launch the host could turn into a chat keeps main's.
 */
export function newTabPromptLaunchesThroughHost(args: {
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  pastesPrompt: boolean
}): boolean {
  return (
    args.promptDelivery === 'submit-after-ready' && args.pastesPrompt && windowMakesHostLaunchTab()
  )
}

/** Why the host refused, each reason in its one existing wording. */
function notStartedText(outcome: { code?: string; message?: string }, agent: TuiAgent): string {
  // The host words a runtime repair in the project settings page's own sentence.
  if (outcome.code === PROJECT_RUNTIME_REPAIR_REQUIRED_CODE && outcome.message) {
    return outcome.message
  }
  const notice = agentLaunchPaneNoticeText({ kind: 'not-started', code: outcome.code ?? '' })
  if (isTuiAgentEnabled(agent, useAppStore.getState().settings?.disabledTuiAgents)) {
    return notice
  }
  const disabled = translate(
    'components.agentSessionContinuation.agentDisabled',
    '{{agent}} is disabled in Agent settings.',
    { agent: getAgentLabel(agent) }
  )
  return `${notice} ${disabled}`
}

/** The tab is gone, so the pane's own words go in a notice, with its prompt to copy. */
function showLaunchNotStartedNotice(
  outcome: HostAgentLaunchOutcome,
  prompt: string,
  agent: TuiAgent
): void {
  if (outcome.kind !== 'not-started') {
    return
  }
  const copy = translate(
    'auto.components.terminal.pane.AgentLaunchPaneNotice.copyPrompt',
    'Copy prompt'
  )
  toast.error(
    notStartedText(outcome, agent),
    prompt
      ? { action: { label: copy, onClick: () => void window.api.ui.writeClipboardText(prompt) } }
      : {}
  )
}

/**
 * A "+" tab whose pane starts the host's plan, made by this window's own prompt and WSL-shell
 * rules (TEMPORARY parity). Returns the ids the caller makes its tab under.
 */
export function startNewTabPaneLaunch(
  args: Omit<HostAgentLaunchArgs, 'windowRules' | 'carriedPrompt'> & {
    /** The window's planner put the prompt on the command line. */
    carriesPrompt: boolean
    promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  }
): { id: string; initialLeafId: string; agentLaunchPane: { leafId: string } } {
  const { carriesPrompt, promptDelivery, ...launch } = args
  const { tabId, leafId, outcome } = startPaneLaunch({
    ...launch,
    windowRules: true,
    ...(carriesPrompt
      ? {
          carriedPrompt: {
            text: args.prompt,
            delivery: promptDelivery === 'draft' ? 'draft' : 'submit'
          }
        }
      : {})
  })
  void outcome.then((launched) => showLaunchNotStartedNotice(launched, args.prompt, args.agent))
  return { id: tabId, initialLeafId: leafId, agentLaunchPane: { leafId } }
}

/**
 * Starts the agent through the host with no prompt and pastes the prompt as main does. Readiness is
 * watched from the moment the tab's terminal exists, as main watches it, so an agent that is ready
 * before the host answers is not missed; the paste is written only once the host has started its
 * agent in this tab, so it never meets a shell this window spawned.
 */
export function launchNewTabPromptThroughHost(
  args: HostAgentLaunchArgs & {
    /** What is pasted, which can differ from the prompt the user wrote. */
    pasteContent: string
    submit: boolean
    onPromptDelivered?: () => void
    onPromptDeliveryUnconfirmed?: () => void
  }
): {
  tabId: string
  promptDeliveryResult: Promise<{ delivered: boolean; failureNotified: boolean }>
} {
  const { pasteContent, submit, onPromptDelivered, onPromptDeliveryUnconfirmed, ...launch } = args
  const { tabId, outcome } = launchAgentThroughHost(launch)
  // Only the host's agent can fill this tab's terminal while the window's own spawn is held.
  const pasted = pasteAgentLaunchPromptOnceReady({
    worktreeId: args.worktreeId,
    tabId,
    agent: args.agent,
    content: pasteContent,
    submit,
    prompt: args.prompt,
    sendGate: outcome.then(
      (launched) => launched.kind === 'started',
      () => false
    ),
    ...(onPromptDelivered ? { onPromptDelivered } : {}),
    ...(onPromptDeliveryUnconfirmed ? { onPromptDeliveryUnconfirmed } : {})
  })
  const promptDeliveryResult = outcome.then((launched) => {
    if (launched.kind === 'started') {
      return pasted
    }
    // The pane, or this notice for a tab that went, already says why: never a second notice.
    showLaunchNotStartedNotice(launched, args.prompt, args.agent)
    return { delivered: false, failureNotified: true }
  })
  return { tabId, promptDeliveryResult }
}
