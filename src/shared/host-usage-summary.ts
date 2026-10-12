import { z } from 'zod'

export const HOST_USAGE_PLUGIN_KEY = 'ikkisovi.host-usage'
const count = z.number().finite().nonnegative()
const text = z.string().max(4096)
const timestamp = count.nullable()
const totals = z.object({
  total: count,
  input: count,
  output: count,
  cached: count,
  cacheWrite: count,
  reasoning: count,
  turns: count,
  knownCost: count,
  unknownCostRows: count
})

export const hostUsageSummarySchema = z.object({
  schemaVersion: z.literal(1),
  scanning: z.boolean(),
  interval: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(300)]),
  warnings: z.array(text).max(128),
  summary: totals.extend({ sessions: count }),
  providers: z.array(totals.extend({ key: text })).max(32),
  daily: z.array(totals.extend({ key: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  hosts: z
    .array(
      z.object({
        key: text,
        kind: z.enum(['local', 'ssh', 'environment']),
        name: text,
        aliases: z.array(text),
        state: z.enum(['unscanned', 'scanning', 'ready', 'partial', 'error', 'needs-ssh']),
        error: text.nullable(),
        lastSuccessAt: timestamp,
        summary: totals.extend({ sessions: count }).nullable(),
        providers: z
          .array(
            z.object({
              provider: text,
              state: z.enum(['ready', 'error']),
              error: text.nullable(),
              lastGoodAt: timestamp
            })
          )
          .max(32)
      })
    )
    .max(128)
})

export type HostUsageSummary = z.infer<typeof hostUsageSummarySchema>
