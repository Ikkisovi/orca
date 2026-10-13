import { useState } from 'react'
import type { HostUsageSummary } from '../../../../shared/host-usage-summary'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { formatSessionTime, formatTokens } from './usage-formatters'
import { translate } from '@/i18n/i18n'

export function HostUsageSessions({
  snapshot,
  search,
  onSearch,
  onOffset
}: {
  snapshot: HostUsageSummary
  search: string
  onSearch: (search: string) => void
  onOffset: (offset: number) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<HostUsageSummary['recent'][number] | null>(null)
  const pagination = snapshot.sessionPagination
  const hostName = (host: string) =>
    snapshot.hosts.find((entry) => entry.key === host)?.name ?? host
  const first = pagination.total ? pagination.offset + 1 : 0
  const last = pagination.offset + snapshot.recent.length
  return (
    <section
      className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4"
      data-testid="host-usage-sessions"
    >
      <h4 className="text-sm font-semibold text-foreground">
        {translate('auto.components.stats.HostUsageDetails.sessions', 'Individual sessions')}
      </h4>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.stats.HostUsageDetails.sessionScope',
          'Sessions active in the selected UTC dates. Token totals cover each session’s lifetime; rankings above cover the selected period.'
        )}
      </p>
      <Input
        aria-label={translate(
          'auto.components.stats.HostUsageDetails.search',
          'Search session, model, provider or project'
        )}
        placeholder={translate(
          'auto.components.stats.HostUsageDetails.search',
          'Search session, model, provider or project'
        )}
        value={search}
        maxLength={256}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
              {[
                translate('auto.components.stats.HostUsageDetails.lastActive', 'Last active'),
                translate('auto.components.stats.HostUsageDetails.host', 'Host'),
                translate('auto.components.stats.HostUsageDetails.session', 'Session'),
                translate('auto.components.stats.HostUsageDetails.model', 'Model'),
                translate('auto.components.stats.HostUsageDetails.project', 'Project'),
                translate(
                  'auto.components.stats.HostUsageDetails.lifetimeTokens',
                  'Lifetime tokens'
                )
              ].map((heading) => (
                <th key={heading} className="px-2 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.recent.map((row) => (
              <tr
                key={`${row.host}:${row.provider}:${row.id}`}
                className="border-b border-border/40 last:border-b-0"
              >
                <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                  {formatSessionTime(row.lastAt)}
                </td>
                <td className="px-2 py-2 text-muted-foreground">{hostName(row.host)}</td>
                <td className="px-2 py-2">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setSelected(row)}
                    aria-label={`${row.provider}: ${row.id}`}
                  >
                    {row.provider} / {row.id.slice(0, 12)}
                  </Button>
                </td>
                <td className="px-2 py-2 text-muted-foreground">{row.model}</td>
                <td className="max-w-64 break-words px-2 py-2">{row.project}</td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                  {formatTokens(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {snapshot.recent.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {translate(
            'auto.components.stats.HostUsageDetails.noSessions',
            'No sessions match this selection.'
          )}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={pagination.offset === 0}
          onClick={() => onOffset(Math.max(0, pagination.offset - pagination.limit))}
        >
          {translate('auto.components.stats.HostUsageDetails.previous', 'Previous')}
        </Button>
        <span>
          {first}–{last} / {pagination.total}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={last >= pagination.total}
          onClick={() => onOffset(pagination.offset + pagination.limit)}
        >
          {translate('auto.components.stats.HostUsageDetails.next', 'Next')}
        </Button>
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.stats.HostUsageDetails.sessionDetails', 'Session usage')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.stats.HostUsageDetails.metadataOnly',
                'Session totals and activity timestamps.'
              )}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {[
                [
                  translate('auto.components.stats.HostUsageDetails.session', 'Session'),
                  selected.id
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.host', 'Host'),
                  hostName(selected.host)
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.provider', 'Provider'),
                  selected.provider
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.model', 'Model'),
                  selected.model
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.project', 'Project'),
                  selected.project
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.firstActive', 'First active'),
                  formatSessionTime(selected.firstAt)
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.lastActive', 'Last active'),
                  formatSessionTime(selected.lastAt)
                ],
                [
                  translate(
                    'auto.components.stats.HostUsageDetails.lifetimeTokens',
                    'Lifetime tokens'
                  ),
                  formatTokens(selected.total)
                ],
                [
                  translate('auto.components.stats.HostUsageDetails.activity', 'Turns / events'),
                  selected.turns.toLocaleString()
                ]
              ].map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
