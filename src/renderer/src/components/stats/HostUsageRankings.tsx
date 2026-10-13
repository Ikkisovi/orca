import { useState } from 'react'
import type { HostUsageSummary } from '../../../../shared/host-usage-summary'
import { Button } from '../ui/button'
import { formatTokens, formatCost } from './usage-formatters'
import { translate } from '@/i18n/i18n'

export function HostUsageRankings({
  title,
  rows,
  total
}: {
  title: string
  rows: HostUsageSummary['models']
  total: number
}): React.JSX.Element {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / 10))
  const current = Math.min(page, pages - 1)
  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.stats.HostUsageDetails.rankingScope',
          'Ranked by tokens in the selected hosts and date range.'
        )}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'auto.components.stats.HostUsageDetails.empty',
            'No collected usage in this selection.'
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.HostUsageDetails.name', 'Name')}
                </th>
                <th className="px-2 py-2 text-right font-medium">Tokens</th>
                <th className="px-2 py-2 text-right font-medium">
                  {translate('auto.components.stats.HostUsageDetails.share', 'Share')}
                </th>
                <th className="px-2 py-2 text-right font-medium">
                  {translate('auto.components.stats.HostUsageDetails.cost', 'Known cost estimate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(current * 10, current * 10 + 10).map((row, index) => (
                <tr key={row.key} className="border-b border-border/40 last:border-b-0">
                  <td className="px-2 py-2 text-muted-foreground">{current * 10 + index + 1}</td>
                  <td className="max-w-64 break-words px-2 py-2 text-foreground">{row.key}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                    {formatTokens(row.total)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {total ? ((row.total / total) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {row.unknownCostRows && !row.knownCost ? 'n/a' : formatCost(row.knownCost)}
                    {row.unknownCostRows > 0 ? ' *' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {translate('auto.components.stats.HostUsageDetails.previous', 'Previous')}
          </Button>
          <span>
            {current + 1} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={current + 1 === pages}
            onClick={() => setPage(current + 1)}
          >
            {translate('auto.components.stats.HostUsageDetails.next', 'Next')}
          </Button>
        </div>
      )}
    </section>
  )
}
