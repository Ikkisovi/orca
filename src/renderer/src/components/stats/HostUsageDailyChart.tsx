import type { HostUsageSummary } from '../../../../shared/host-usage-summary'
import { formatTokens } from './usage-formatters'
import { translate } from '@/i18n/i18n'

export function HostUsageDailyChart({
  daily
}: {
  daily: HostUsageSummary['daily']
}): React.JSX.Element {
  const title = translate('auto.components.stats.HostUsageDailyChart.title', 'Daily usage')
  let maximum = 1
  for (const row of daily) {
    maximum = Math.max(maximum, row.total)
  }
  const firstDay = Date.parse(daily[0]?.key ?? '')
  const lastDay = Date.parse(daily.at(-1)?.key ?? '')
  const dayCount = Math.max(1, (lastDay - firstDay) / 86_400_000 + 1)
  const barWidth = 908 / dayCount
  const labelCount = Math.min(7, dayCount)

  return (
    <section
      className="rounded-lg border border-border/60 bg-card/40 p-4"
      data-testid="host-usage-daily-chart"
    >
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {translate(
          'auto.components.stats.HostUsageDailyChart.description',
          'Daily token totals for the selected hosts and date range · UTC'
        )}
      </p>
      {daily.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          {translate(
            'auto.components.stats.HostUsageDailyChart.empty',
            'No collected usage in this date range.'
          )}
        </p>
      ) : (
        <svg viewBox="0 0 1000 250" className="mt-3 w-full text-xs" role="img" aria-label={title}>
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio}>
              <line
                x1={72}
                x2={980}
                y1={210 - 190 * ratio}
                y2={210 - 190 * ratio}
                className="stroke-border"
              />
              <text x={64} y={214 - 190 * ratio} textAnchor="end" className="fill-muted-foreground">
                {formatTokens(maximum * ratio)}
              </text>
            </g>
          ))}
          {daily.map((row) => {
            const offset = (Date.parse(row.key) - firstDay) / 86_400_000
            const height = (190 * row.total) / maximum
            return (
              <rect
                key={row.key}
                data-day={row.key}
                x={72 + offset * barWidth + barWidth * 0.1}
                y={210 - height}
                width={barWidth * 0.8}
                height={height}
                rx={1}
                className="fill-chart-2 hover:fill-chart-3"
              >
                <title>
                  {row.key}: {row.total.toLocaleString()} tokens ({formatTokens(row.total)})
                </title>
              </rect>
            )
          })}
          {Array.from({ length: labelCount }, (_, index) => {
            const offset =
              labelCount === 1 ? 0 : Math.round((index * (dayCount - 1)) / (labelCount - 1))
            const day = new Date(firstDay + offset * 86_400_000).toISOString().slice(0, 10)
            return (
              <text
                key={day}
                x={72 + (offset + 0.5) * barWidth}
                y={238}
                textAnchor="middle"
                className="fill-muted-foreground"
              >
                {day.slice(5)}
              </text>
            )
          })}
        </svg>
      )}
    </section>
  )
}
