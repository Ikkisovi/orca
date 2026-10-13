import type { HostUsageSummary } from '../../../../shared/host-usage-summary'
import { Badge } from '../ui/badge'
import { formatTokens, formatUpdatedAt } from './usage-formatters'
import { translate } from '@/i18n/i18n'

function stateLabel(state: string): string {
  switch (state) {
    case 'ready':
      return translate('auto.components.stats.HostUsagePane.ready', 'Ready')
    case 'scanning':
      return translate('auto.components.stats.HostUsagePane.scanning', 'Scanning')
    case 'partial':
      return translate('auto.components.stats.HostUsagePane.partial', 'Partial data')
    case 'error':
      return translate(
        'auto.components.stats.HostUsagePane.error',
        'Scan failed — previous data retained'
      )
    case 'needs-ssh':
      return translate('auto.components.stats.HostUsagePane.needsSsh', 'SSH connection needed')
    default:
      return translate('auto.components.stats.HostUsagePane.unscanned', 'Not scanned yet')
  }
}

export function HostUsageCards({ hosts }: { hosts: HostUsageSummary['hosts'] }): React.JSX.Element {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {hosts.map((entry) => (
        <section
          key={entry.key}
          className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-4"
          data-testid="usage-host-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold text-foreground">{entry.name}</h4>
              <p className="text-xs text-muted-foreground">
                {entry.kind === 'local'
                  ? translate('auto.components.stats.HostUsagePane.local', 'This machine')
                  : entry.aliases.join(' / ')}
              </p>
            </div>
            <Badge variant="outline">{stateLabel(entry.state)}</Badge>
          </div>
          <p className="text-sm text-foreground">
            {entry.summary ? formatTokens(entry.summary.total) : '—'} tokens
          </p>
          <p className="text-xs text-muted-foreground">{formatUpdatedAt(entry.lastSuccessAt)}</p>
          {entry.error && (
            <p role="status" className="text-xs text-destructive">
              {entry.error}
            </p>
          )}
          {entry.providers.map((provider) =>
            provider.state === 'error' ? (
              <p key={provider.provider} role="status" className="text-xs text-destructive">
                {provider.provider}: {provider.error} · {formatUpdatedAt(provider.lastGoodAt)}
              </p>
            ) : null
          )}
        </section>
      ))}
    </div>
  )
}
