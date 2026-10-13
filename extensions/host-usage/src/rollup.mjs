const empty = () => ({
  total: 0,
  input: 0,
  output: 0,
  cached: 0,
  cacheWrite: 0,
  reasoning: 0,
  turns: 0,
  knownCost: 0,
  unknownCostRows: 0
})
export function normalizeModelName(raw) {
  // Match the Venus overview: route prefixes and clients do not identify a model.
  const name = String(raw ?? '')
    .trim()
    .split('/')
    .at(-1)
    .trim()
  return !name || /^(null|unknown)$/i.test(name) ? 'Unknown model' : name
}
function add(target, row) {
  for (const key of ['total', 'input', 'output', 'cached', 'cacheWrite', 'reasoning', 'turns']) {
    target[key] += row[key] || 0
  }
  if (typeof row.cost === 'number' && Number.isFinite(row.cost)) {
    target.knownCost += row.cost
  } else if (row.total > 0) {
    target.unknownCostRows++
  }
}

export function rollup(
  hosts,
  {
    host = 'all',
    provider = 'all',
    from,
    to,
    project = '',
    sessionOffset = 0,
    sessionLimit = 100,
    sessionSearch = ''
  } = {}
) {
  const seen = new Set(),
    rows = [],
    sessions = [],
    included = []
  for (const item of hosts) {
    if (host !== 'all' && item.key !== host) {
      continue
    }
    const snapshot = item.snapshot
    if (!snapshot || seen.has(snapshot.hostKey)) {
      continue
    }
    seen.add(snapshot.hostKey)
    included.push(item.key)
    for (const data of snapshot.providers) {
      if (provider !== 'all' && data.provider !== provider) {
        continue
      }
      // A failed refresh retains last-good rows with the provider's stale/error status.
      rows.push(
        ...data.daily
          .filter(
            (row) =>
              (!from || row.day >= from) &&
              (!to || row.day <= to) &&
              (!project || row.project.toLowerCase().includes(project.toLowerCase()))
          )
          .map((row) => ({ ...row, host: item.key }))
      )
      sessions.push(
        ...data.sessions
          .filter(
            (row) =>
              (!from || row.lastAt.slice(0, 10) >= from) &&
              (!to || row.firstAt.slice(0, 10) <= to) &&
              (!project || row.project.toLowerCase().includes(project.toLowerCase()))
          )
          .map((row) => ({ ...row, host: item.key }))
      )
    }
  }
  const summary = empty(),
    days = new Map(),
    models = new Map(),
    projects = new Map(),
    providers = new Map()
  for (const row of rows) {
    add(summary, row)
    for (const [map, key] of [
      [days, row.day],
      [models, normalizeModelName(row.model)],
      [projects, row.project],
      [providers, row.provider]
    ]) {
      if (!map.has(key)) {
        map.set(key, { key, ...empty() })
      }
      add(map.get(key), row)
    }
  }
  const sorted = (map) => [...map.values()].sort((a, b) => b.total - a.total)
  const offset = Math.max(0, Math.floor(Number(sessionOffset) || 0))
  const limit = Math.min(100, Math.max(1, Math.floor(Number(sessionLimit) || 100)))
  const search = String(sessionSearch).toLowerCase()
  const matching = sessions
    .filter(
      (row) =>
        !search ||
        [row.id, row.host, row.provider, row.model, row.project].some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(search)
        )
    )
    .sort(
      (a, b) =>
        b.lastAt.localeCompare(a.lastAt) ||
        `${a.host}:${a.provider}:${a.id}`.localeCompare(`${b.host}:${b.provider}:${b.id}`)
    )
  return {
    summary: {
      ...summary,
      sessions: new Set(sessions.map((row) => `${row.host}:${row.provider}:${row.id}`)).size
    },
    includedHosts: included,
    daily: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
    models: sorted(models),
    projects: sorted(projects),
    providers: sorted(providers),
    recent: matching.slice(offset, offset + limit),
    sessionPagination: { offset, limit, total: matching.length }
  }
}

export function reconcileSnapshot(previous, next) {
  if (!previous || previous.hostKey !== next.hostKey) {
    return next
  }
  return {
    ...next,
    providers: next.providers.map((data) =>
      data.state === 'error'
        ? {
            ...previous.providers.find((old) => old.provider === data.provider),
            ...data,
            daily: previous.providers.find((old) => old.provider === data.provider)?.daily ?? [],
            sessions:
              previous.providers.find((old) => old.provider === data.provider)?.sessions ?? [],
            lastGoodAt:
              previous.providers.find((old) => old.provider === data.provider)?.lastGoodAt ??
              previous.providers.find((old) => old.provider === data.provider)?.completedAt ??
              null
          }
        : data
    )
  }
}
