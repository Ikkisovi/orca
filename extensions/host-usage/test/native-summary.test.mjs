import test from 'node:test'
import assert from 'node:assert/strict'
import { usageQuery, usageSummary } from '../src/native-summary.mjs'

test('native summary uses UTC boundaries and exposes only requested usage metadata', () => {
  const query = usageQuery({ host: 'ssh:venus', days: 30 }, new Date('2026-03-01T01:00:00Z'))
  assert.equal(query.get('from'), '2026-01-31')
  assert.equal(query.get('to'), '2026-03-01')
  assert.equal(query.get('host'), 'ssh:venus')
  assert.equal(usageQuery({ days: 0 }).has('from'), false)
  assert.throws(() => usageQuery({ days: 1 }))
  assert.throws(() => usageQuery({ host: {} }))
  const summary = usageSummary({
    scanning: false,
    interval: 60,
    warnings: [],
    data: {
      summary: { total: 40 },
      providers: [],
      daily: [],
      models: [{ key: 'codex / model', total: 40 }],
      projects: [],
      recent: [{ id: 'session-1', total: 40, prompt: 'private-message' }],
      sessionPagination: { total: 1, offset: 0, limit: 50 }
    },
    hosts: [
      {
        key: 'local',
        kind: 'local',
        label: 'Mac',
        state: 'ready',
        summary: { total: 40 },
        providers: [
          {
            provider: 'pi',
            state: 'error',
            error: 'unreadable',
            lastGoodAt: 123,
            sessions: ['private-session']
          }
        ]
      }
    ]
  })
  assert.equal(summary.hosts[0].name, 'Mac')
  assert.equal(summary.hosts[0].providers[0].lastGoodAt, 123)
  assert.equal(summary.models[0].key, 'codex / model')
  assert.equal(summary.recent[0].id, 'session-1')
  assert.equal(summary.sessionPagination.total, 1)
  assert.equal(JSON.stringify(summary).includes('private-session'), false)
  assert.equal(JSON.stringify(summary).includes('private-message'), false)
  assert.equal(
    usageQuery({ sessionOffset: 100, sessionSearch: 'gpt-6' }).get('sessionOffset'),
    '100'
  )
  assert.throws(() => usageQuery({ sessionOffset: -1 }))
  assert.throws(() => usageQuery({ sessionSearch: 'x'.repeat(257) }))
})
