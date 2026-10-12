import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from './settings-search'

export const getChatBehaviorTitle = (): string =>
  translate('components.settings.nativeChat.behaviorTitle', 'Behavior')

export const getChatBehaviorEntriesByKey = createLocalizedCatalog(() => ({
  resumeOnRestart: {
    targetSectionId: 'chat-resume-on-restart',
    title: translate(
      'components.settings.nativeChat.resumeTitle',
      'Resume working chats automatically after a restart'
    ),
    description: translate(
      'components.settings.nativeChat.resumeCopy',
      'When Orca quits or installs an update, chats that were working are automatically resumed when Orca is reopened.'
    ),
    keywords: [
      translate('components.settings.nativeChat.resumeSearchUpdate', 'update'),
      translate('components.settings.nativeChat.resumeSearchRelaunch', 'relaunch')
    ]
  },
  queueFollowUps: {
    targetSectionId: 'chat-queue-follow-ups',
    title: translate('components.settings.nativeChat.queueFollowUpsTitle', 'Queue follow-ups'),
    description: translate(
      'components.settings.nativeChat.queueFollowUpsCopy',
      'Messages you send while the agent is working wait as cards you can steer, edit, or delete. Messages with images send right away.'
    ),
    keywords: [
      translate('components.settings.nativeChat.queueSearchQueue', 'queue'),
      translate('components.settings.nativeChat.queueSearchSteer', 'steer')
    ]
  },
  shellEnvironment: {
    targetSectionId: 'chat-shell-environment',
    title: translate('components.settings.nativeChat.shellEnvTitle', 'Use your shell environment'),
    description: translate(
      'components.settings.nativeChat.shellEnvCopy',
      'Codex and Claude chats start with every variable your login shell exports, the same as a terminal. Turn off to choose which ones they get.'
    ),
    keywords: [
      translate('components.settings.nativeChat.shellEnvSearchVariables', 'environment variables'),
      translate('components.settings.nativeChat.shellEnvSearchPath', 'PATH'),
      translate('components.settings.nativeChat.shellEnvSearchProxy', 'proxy')
    ]
  }
}))

export function getChatBehaviorSearchEntries(): SettingsSearchEntry[] {
  return Object.values(getChatBehaviorEntriesByKey())
}
