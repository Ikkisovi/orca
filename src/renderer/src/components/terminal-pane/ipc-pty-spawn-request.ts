import type { IpcPtyTransportOptions, PtyConnectResult, PtyTransport } from './pty-transport-types'
import {
  createAgentSessionCreateOperation,
  type AgentSessionCreateOperation
} from '../../runtime/agent-session-create-operation'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { toRuntimeTerminalWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { makePaneKey } from '../../../../shared/stable-pane-id'

type PtyConnectOptions = Parameters<PtyTransport['connect']>[0]
const modelLaunchOperations = new WeakMap<IpcPtyTransportOptions, AgentSessionCreateOperation>()

/** `incarnationId` names which lifetime of the returned id this spawn owns; absent when the
 *  execution host predates the field. It is deliberately NOT on `PtyConnectResult` — only the
 *  connect handshake needs it, to fence buffered state left by an earlier owner of the same id. */
export type IpcPtySpawnResponse = PtyConnectResult & {
  isReattach?: boolean
  incarnationId?: string
}

export async function spawnIpcPty(
  transportOptions: IpcPtyTransportOptions,
  connectOptions: PtyConnectOptions,
  admittedSessionId?: string
): Promise<IpcPtySpawnResponse> {
  if (
    !admittedSessionId &&
    transportOptions.launchAgent === 'opencode' &&
    Object.values(transportOptions.agentLaunchPreferences ?? {}).some(
      (value) => value !== undefined
    )
  ) {
    await launchOpenCodeModelIntoPane(transportOptions)
  }
  const {
    cwd,
    cwdFallback,
    env,
    envToDelete,
    command,
    commandDelivery,
    launchConfig,
    resumeProviderSession,
    launchToken,
    launchAgent,
    startupCommandDelivery,
    connectionId,
    worktreeId,
    tabId,
    leafId,
    placement,
    shellOverride,
    projectRuntime,
    terminalColorQueryReplies,
    terminalKittyKeyboardProtocol,
    telemetry
  } = transportOptions
  const shouldSendLocalCwdFallback =
    cwdFallback === 'worktree' && !connectionId && !admittedSessionId
  const resumesAgent = Boolean(connectOptions.resumeProviderSession ?? resumeProviderSession)
  const spawnIntent =
    resumesAgent && !admittedSessionId ? connectOptions.resumeSpawnIntent : undefined
  // Why: a reattach under an admitted session id must never stop the PTY it is reattaching.
  const replacesPtyId = admittedSessionId ? null : (connectOptions.claimReplacedPtyId?.() ?? null)
  return window.api.pty.spawn({
    cols: connectOptions.cols ?? 80,
    rows: connectOptions.rows ?? 24,
    cwd,
    ...(shouldSendLocalCwdFallback ? { cwdFallback } : {}),
    env: connectOptions.env ?? env,
    ...((connectOptions.envToDelete ?? envToDelete)
      ? { envToDelete: connectOptions.envToDelete ?? envToDelete }
      : {}),
    command: connectOptions.command ?? command,
    ...((connectOptions.commandDelivery ?? commandDelivery)
      ? { commandDelivery: connectOptions.commandDelivery ?? commandDelivery }
      : {}),
    ...((connectOptions.launchConfig ?? launchConfig)
      ? { launchConfig: connectOptions.launchConfig ?? launchConfig }
      : {}),
    ...((connectOptions.resumeProviderSession ?? resumeProviderSession)
      ? { resumeProviderSession: connectOptions.resumeProviderSession ?? resumeProviderSession }
      : {}),
    ...((connectOptions.launchToken ?? launchToken)
      ? { launchToken: connectOptions.launchToken ?? launchToken }
      : {}),
    ...((connectOptions.launchAgent ?? launchAgent)
      ? { launchAgent: connectOptions.launchAgent ?? launchAgent }
      : {}),
    ...((connectOptions.startupCommandDelivery ?? startupCommandDelivery)
      ? {
          startupCommandDelivery: connectOptions.startupCommandDelivery ?? startupCommandDelivery
        }
      : {}),
    ...(connectionId ? { connectionId } : {}),
    ...(admittedSessionId ? { sessionId: admittedSessionId } : {}),
    ...(connectOptions.initiallyHidden ? { initiallyHidden: true } : {}),
    worktreeId,
    ...(tabId ? { tabId } : {}),
    ...(leafId ? { leafId } : {}),
    ...(placement && !admittedSessionId ? { placement } : {}),
    ...(spawnIntent ? { spawnIntent } : {}),
    ...(replacesPtyId ? { replacesPtyId } : {}),
    ...(shellOverride ? { shellOverride } : {}),
    ...(projectRuntime ? { projectRuntime } : {}),
    ...(terminalColorQueryReplies ? { terminalColorQueryReplies } : {}),
    ...(terminalKittyKeyboardProtocol === true ? { terminalKittyKeyboardProtocol: true } : {}),
    ...(telemetry ? { telemetry } : {})
  })
}

/** The host checks the model and plans the launch; this pane's own spawn then runs that plan. */
async function launchOpenCodeModelIntoPane(
  transportOptions: IpcPtyTransportOptions
): Promise<void> {
  const { worktreeId, tabId, leafId, connectionId, resumeProviderSession } = transportOptions
  if (!worktreeId || !tabId || !leafId || connectionId || resumeProviderSession) {
    throw new Error('capability_unsupported')
  }
  let operation = modelLaunchOperations.get(transportOptions)
  if (!operation) {
    operation = createAgentSessionCreateOperation()
    modelLaunchOperations.set(transportOptions, operation)
  }
  const { agentPrompt, agentPromptDelivery, agentArgsOverride, agentLaunchPreferences } =
    transportOptions
  const sessionOptions = Object.entries(agentLaunchPreferences ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
  await operation.run((operationId) =>
    callRuntimeRpc({ kind: 'local' }, 'agent.launchReplay', {
      agent: 'opencode',
      operationId,
      target: {
        kind: 'existing',
        worktree: toRuntimeTerminalWorktreeSelector(worktreeId)
      },
      paneKey: makePaneKey(tabId, leafId),
      spawnTrigger: 'window-pane',
      sessionOptions: Object.fromEntries(sessionOptions),
      ...(agentArgsOverride !== undefined ? { agentArgs: agentArgsOverride } : {}),
      ...(transportOptions.cwd ? { cwd: transportOptions.cwd } : {}),
      // The prompt rides the command line, as the host's chat create put it there.
      ...(agentPrompt
        ? {
            prompt: {
              text: agentPrompt,
              delivery: agentPromptDelivery === 'draft' ? 'draft' : 'submit'
            },
            promptCarry: 'window'
          }
        : {})
    })
  )
}
