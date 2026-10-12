import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { useStructuredAgentSessionHostQueuesMessages } from '@/runtime/structured-agent-session-host-capability'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import { getChatBehaviorEntriesByKey } from './chat-behavior-search'

// This screen edits this machine's settings, so it asks this machine's runtime; a paired host that
// predates queueing sends a follow-up right away whatever the switch says.
const STRUCTURED_CHAT_HOST: RuntimeClientTarget = { kind: 'local' }

type NativeChatQueueFollowUpsSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisible?: boolean
}

export function NativeChatQueueFollowUpsSetting({
  settings,
  updateSettings,
  forceVisible = false
}: NativeChatQueueFollowUpsSettingProps): React.JSX.Element | null {
  const hostQueuesMessages = useStructuredAgentSessionHostQueuesMessages(STRUCTURED_CHAT_HOST)
  // A host without the capability ignores the preference; the switch would do nothing.
  if (!hostQueuesMessages) {
    return null
  }
  const queueFollowUpsEnabled = settings.nativeChatQueueFollowUps !== false
  const entry = getChatBehaviorEntriesByKey().queueFollowUps
  return (
    <SearchableSetting
      {...entry}
      id={entry.targetSectionId}
      forceVisible={forceVisible}
      className="max-w-none"
    >
      <SettingsSwitchRow
        label={entry.title}
        description={entry.description}
        checked={queueFollowUpsEnabled}
        ariaLabel={translate(
          'components.settings.nativeChat.queueFollowUpsToggleLabel',
          'Toggle queue follow-ups'
        )}
        onChange={() => updateSettings({ nativeChatQueueFollowUps: !queueFollowUpsEnabled })}
      />
    </SearchableSetting>
  )
}
