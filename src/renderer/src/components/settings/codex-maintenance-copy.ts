import { translate } from '@/i18n/i18n'
import type { CodexCliInstallation } from '../../../../shared/codex-cli-installation'
import { sayAgentSessionFailureTranslated } from '../native-chat/agent-session-failure-words-text'

export function codexMaintenanceLabel(busy = false): string {
  return busy
    ? translate('codex.maintenance.installing', 'Installing…')
    : translate('codex.maintenance.install', 'Install Codex')
}

export function codexMaintenanceSettingsStatus(installation: CodexCliInstallation): string | null {
  if (installation.status === 'missing') {
    return translate('auto.components.settings.AgentSkillSetupPanel.5289300939', 'Not installed')
  }
  return installation.status === 'unsupported'
    ? sayAgentSessionFailureTranslated('codexCliTooOld', {
        installedVersion: installation.version ?? '',
        minimumVersion: installation.minimumVersion
      })
    : null
}
