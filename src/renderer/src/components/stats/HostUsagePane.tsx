import { useRef, useState } from 'react'
import { ChevronDown, Monitor, RefreshCw, Server, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { StatCard } from './StatCard'
import { HostUsageCards } from './HostUsageCards'
import { HostUsageDailyChart } from './HostUsageDailyChart'
import { HostUsageRankings } from './HostUsageRankings'
import { HostUsageSessions } from './HostUsageSessions'
import { formatTokens, formatCost } from './usage-formatters'
import { useHostUsage } from './use-host-usage'
import { translate } from '@/i18n/i18n'

export function HostUsagePane(): React.JSX.Element {
  const [host, setHost] = useState('all')
  const [days, setDays] = useState(30)
  const [sessionOffset, setSessionOffset] = useState(0)
  const [sessionSearch, setSessionSearch] = useState('')
  const details = useRef<HTMLDivElement>(null)
  const { snapshot, enabled, compatible, error, busy, scan, reload } = useHostUsage(
    host,
    days,
    sessionOffset,
    sessionSearch
  )
  const allLabel = translate('auto.components.stats.HostUsagePane.allHosts', 'All hosts')
  const selected = snapshot?.hosts.find((entry) => entry.key === host)?.name ?? allLabel
  const hosts = snapshot?.hosts.filter((entry) => host === 'all' || entry.key === host) ?? []
  const scanning = busy || snapshot?.scanning === true
  const rangeOptions = [7, 30, 90, 0].map((value) => ({
    value: String(value),
    label: value
      ? translate('auto.components.stats.HostUsagePane.lastDays', 'Last {{days}} days', {
          days: value
        })
      : translate('auto.components.stats.HostUsagePane.allTime', 'All time')
  }))

  return (
    <div className="space-y-4" data-testid="host-usage-pane">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {translate('auto.components.stats.HostUsagePane.title', 'Local & remote usage')}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {translate(
                'auto.components.stats.HostUsagePane.scope',
                'All host agent logs · UTC dates · not account quota'
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label={allLabel} disabled={!snapshot}>
                  <Monitor className="size-3.5" />
                  {selected}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={host}
                  onValueChange={(value) => {
                    setHost(value)
                    setSessionOffset(0)
                  }}
                >
                  <DropdownMenuRadioItem value="all">{allLabel}</DropdownMenuRadioItem>
                  {snapshot?.hosts.map((entry) => (
                    <DropdownMenuRadioItem key={entry.key} value={entry.key}>
                      {entry.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {rangeOptions.find((option) => option.value === String(days))?.label}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={String(days)}
                  onValueChange={(value) => {
                    setDays(Number(value))
                    setSessionOffset(0)
                  }}
                >
                  {rangeOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {!enabled || !compatible ? (
          <p className="text-sm text-muted-foreground">
            {translate(
              'auto.components.stats.HostUsagePane.install',
              'Install and enable Kai’s usage plugin version 0.2 or newer in Settings → Plugins.'
            )}
          </p>
        ) : !snapshot ? (
          <p className="text-sm text-muted-foreground">
            {translate(
              'auto.components.stats.HostUsagePane.loading',
              'Connecting to the usage monitor…'
            )}
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <StatCard
                label={translate('auto.components.stats.HostUsagePane.tokens', 'Total tokens')}
                value={formatTokens(snapshot.summary.total)}
                icon={<Sparkles className="size-4" />}
              />
              <StatCard
                label={translate(
                  'auto.components.stats.HostUsagePane.sessions',
                  'Sessions active in range'
                )}
                value={snapshot.summary.sessions.toLocaleString()}
                icon={<Monitor className="size-4" />}
              />
              <StatCard
                label={translate(
                  'auto.components.stats.HostUsagePane.cost',
                  'Known estimated cost'
                )}
                value={
                  snapshot.summary.unknownCostRows && !snapshot.summary.knownCost
                    ? 'n/a'
                    : formatCost(snapshot.summary.knownCost)
                }
                icon={<Server className="size-4" />}
              />
            </div>
            {snapshot.summary.unknownCostRows > 0 && (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.stats.HostUsagePane.partialCost',
                  'Some model prices are unavailable; estimated cost is incomplete.'
                )}
              </p>
            )}
            <HostUsageDailyChart daily={snapshot.daily} />
            <HostUsageCards hosts={hosts} />
            <div className="flex flex-wrap gap-2">
              {snapshot.providers.map((provider) => (
                <Badge key={provider.key} variant="outline">
                  {provider.key}: {formatTokens(provider.total)}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {snapshot.interval
                ? translate(
                    'auto.components.stats.HostUsagePane.autoScan',
                    'Automatic scans every {{seconds}} seconds',
                    { seconds: snapshot.interval }
                  )
                : translate(
                    'auto.components.stats.HostUsagePane.autoOff',
                    'Automatic scanning is off'
                  )}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {snapshot?.warnings.map((warning) => (
          <p key={warning} role="status" className="text-xs text-destructive">
            {warning}
          </p>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void scan()}
            disabled={!enabled || !compatible || scanning}
          >
            <RefreshCw className="size-3.5" />
            {translate('auto.components.stats.HostUsagePane.scan', 'Scan selected hosts')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={!enabled || !compatible || busy}
          >
            {translate('auto.components.stats.HostUsagePane.reload', 'Reload collected statistics')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => details.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            disabled={!snapshot}
          >
            {translate('auto.components.stats.HostUsagePane.details', 'Projects & sessions')}
          </Button>
        </div>
      </section>
      {snapshot && (
        <div ref={details} className="space-y-4" data-testid="host-usage-details">
          <div key={`${host}:${days}`} className="grid gap-4 xl:grid-cols-2">
            <HostUsageRankings
              title={translate('auto.components.stats.HostUsageDetails.models', 'Model ranking')}
              rows={snapshot.models}
              total={snapshot.summary.total}
            />
            <HostUsageRankings
              title={translate(
                'auto.components.stats.HostUsageDetails.projects',
                'Project ranking'
              )}
              rows={snapshot.projects}
              total={snapshot.summary.total}
            />
          </div>
          <HostUsageSessions
            snapshot={snapshot}
            search={sessionSearch}
            onSearch={(value) => {
              setSessionSearch(value)
              setSessionOffset(0)
            }}
            onOffset={setSessionOffset}
          />
        </div>
      )}
    </div>
  )
}
