export function usageQuery(args = {}, now = new Date()) {
  const { host = 'all', days = 30, sessionOffset = 0, sessionSearch = '' } = args
  if (
    typeof host !== 'string' ||
    host.length > 512 ||
    ![0, 7, 30, 90].includes(days) ||
    !Number.isSafeInteger(sessionOffset) ||
    sessionOffset < 0 ||
    typeof sessionSearch !== 'string' ||
    sessionSearch.length > 256
  ) {
    throw new Error('Invalid usage selection')
  }
  const query = new URLSearchParams({
    host,
    to: now.toISOString().slice(0, 10),
    sessionOffset: String(sessionOffset),
    sessionLimit: '50',
    sessionSearch
  })
  if (days) {
    query.set(
      'from',
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1))
        .toISOString()
        .slice(0, 10)
    )
  }
  return query
}

export function usageSummary(value) {
  return {
    schemaVersion: 1,
    scanning: value.scanning,
    interval: value.interval,
    warnings: value.warnings,
    summary: value.data.summary,
    daily: value.data.daily,
    providers: value.data.providers,
    models: value.data.models ?? [],
    projects: value.data.projects ?? [],
    recent: (value.data.recent ?? []).map((row) => ({
      id: row.id,
      host: row.host ?? '',
      provider: row.provider ?? 'Unknown',
      model: row.model ?? 'Unknown',
      project: row.project ?? 'Unknown',
      firstAt: row.firstAt ?? '',
      lastAt: row.lastAt ?? '',
      turns: row.turns ?? 0,
      total: row.total ?? 0
    })),
    sessionPagination: value.data.sessionPagination ?? {
      offset: 0,
      limit: 50,
      total: value.data.recent?.length ?? 0
    },
    hosts: value.hosts.map((host) => ({
      key: host.key,
      kind: host.kind,
      name: host.hostname ?? host.label ?? host.alias ?? host.key,
      aliases: host.aliases ?? [],
      state: host.state,
      error: host.error ?? null,
      lastSuccessAt: host.lastSuccessAt ?? null,
      summary: host.summary,
      providers: (host.providers ?? []).map((provider) => ({
        provider: provider.provider,
        state: provider.state,
        error: provider.error ?? null,
        lastGoodAt: provider.lastGoodAt ?? provider.completedAt ?? null
      }))
    }))
  }
}
