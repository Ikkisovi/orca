import test from 'node:test'
import assert from 'node:assert/strict'
import { usageQuery, usageSummary } from '../src/native-summary.mjs'

test('native summary range uses UTC calendar boundaries and excludes session details', () => {
  const query = usageQuery({ host: 'ssh:venus', days: 30 }, new Date('2026-03-01T01:00:00Z'))
  assert.equal(query.get('from'), '2026-01-31')
  assert.equal(query.get('to'), '2026-03-01')
  assert.equal(query.get('host'), 'ssh:venus')
  assert.equal(usageQuery({ days: 0 }).has('from'), false)
  assert.throws(() => usageQuery({ days: 1 }))
  assert.throws(() => usageQuery({ host: {} }))
  const summary = usageSummary({ scanning: false, interval: 60, warnings: [],
    data: { summary: { total: 40 }, providers: [], daily: [], recent: [{ id: 'private-session' }] },
    hosts: [{ key: 'local', kind: 'local', label: 'Mac', state: 'ready', summary: { total: 40 },
      providers: [{ provider: 'pi', state: 'error', error: 'unreadable', lastGoodAt: 123, sessions: ['private-session'] }] }] })
  assert.equal(summary.hosts[0].name, 'Mac')
  assert.equal(summary.hosts[0].providers[0].lastGoodAt, 123)
  assert.equal(JSON.stringify(summary).includes('private-session'), false)
})
