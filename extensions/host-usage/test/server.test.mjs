import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../dist/server.mjs'

test('authenticated reload never scans; scan deduplicates concurrent jobs and retains errors', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'orca-host-usage-test-'))
  let calls = 0, fail = false
  const service = await startServer({ stateDir,
    discovery: async () => ({ hosts: [{ key: 'local', kind: 'local', label: 'Mac', aliases: ['local'] }, { key: 'ssh:venus', kind: 'ssh', alias: 'venus', aliases: ['venus'], label: 'Venus' }], warnings: [] }),
    execute: async spec => { calls++; assert.equal(spec.env.TZ, 'UTC'); if (fail) return { code: 1, stderr: 'offline' }; return { code: 0, stdout: JSON.stringify({ schemaVersion: 1, hostKey: spec.program === 'ssh' ? 'venus' : 'mac', completedAt: 123, providers: [] }) } }
  })
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }
  try {
    assert.equal((await fetch(service.origin + '/api/usage')).status, 401)
    assert.equal((await fetch(service.origin + '/api/usage', { headers })).status, 200)
    assert.equal(calls, 0)
    const first = service.scan(), second = service.scan()
    assert.equal(first, second)
    await first; assert.equal(calls, 2)
    fail = true; await service.scan()
    assert.equal(service.hosts()[1].state, 'error')
    assert.equal(service.hosts()[1].snapshot.hostKey, 'venus')
    assert.equal((await fetch(service.origin + '/api/settings', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{"interval":0}' })).status, 403)
    assert.equal((await fetch(service.origin + '/api/settings', { method: 'POST', headers, body: '{"interval":1}' })).status, 400)
    assert.equal((await fetch(service.origin + '/api/hosts', { method: 'POST', headers, body: '{"alias":"--ProxyCommand=bad"}' })).status, 400)
  } finally { await service.stop(); await rm(stateDir, { recursive: true, force: true }) }
})
