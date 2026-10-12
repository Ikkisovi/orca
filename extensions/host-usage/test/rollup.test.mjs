import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollup, reconcileSnapshot } from '../src/rollup.mjs'

const row = (day, total, extra = {}) => ({ day, total, input: total - 10, output: 10, cached: 20, cacheWrite: 0, reasoning: 5, turns: 1, cost: null, provider: 'codex', model: 'unknown', project: '/repo', ...extra })
const snapshot = (hostKey, rows) => ({ hostKey, completedAt: 42, providers: [{ provider: 'codex', state: 'ready', completedAt: 42, daily: rows, sessions: [{ id: 'one', firstAt: '2026-10-01T00:00:00Z', lastAt: '2026-10-12T00:00:00Z', project: '/repo', provider: 'codex' }] }] })
test('deduplicates machine aliases and aggregates daily model rows once', () => {
  const s = snapshot('venus', [row('2026-10-12', 100), row('2026-10-12', 200, { model: 'other' })])
  const result = rollup([{ key: 'openalice-main', snapshot: s }, { key: 'lol', snapshot: s }])
  assert.equal(result.summary.total, 300)
  assert.equal(result.daily.length, 1)
  assert.equal(result.summary.sessions, 1)
  assert.equal(result.summary.unknownCostRows, 2)
  assert.equal(result.summary.knownCost, 0)
})
test('range, project, provider and host filters apply independently', () => {
  const hosts = [{ key: 'local', snapshot: snapshot('mac', [row('2026-09-01', 100), row('2026-10-12', 200), row('2026-10-12', 400, { project: '/other' })]) }]
  assert.equal(rollup(hosts, { from: '2026-10-01', to: '2026-10-12', project: '/repo' }).summary.total, 200)
  assert.equal(rollup(hosts, { provider: 'pi' }).summary.total, 0)
  assert.equal(rollup(hosts, { host: 'remote' }).summary.total, 0)
})
test('failed provider refresh retains last-good data and timestamps', () => {
  const old = snapshot('venus', [row('2026-10-12', 100)])
  const failed = { ...old, completedAt: 50, providers: [{ provider: 'codex', state: 'error', completedAt: null, error: 'unreadable', daily: [], sessions: [] }] }
  const next = reconcileSnapshot(old, failed)
  assert.equal(next.providers[0].state, 'error')
  assert.equal(next.providers[0].lastGoodAt, 42)
  assert.equal(rollup([{ key: 'venus', snapshot: next }]).summary.total, 100)
  assert.equal(reconcileSnapshot(old, { ...failed, hostKey: 'different' }).providers[0].daily.length, 0)
})
