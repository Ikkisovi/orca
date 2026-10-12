import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '../dist/process.mjs'

test('Codex repeated totals are not double-counted and prompts stay out of collector results', async () => {
  const home = await mkdtemp(join(tmpdir(), 'orca-usage-fixture-'))
  const root = join(home, '.codex', 'sessions'); await mkdir(root, { recursive: true })
  const usage = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 250, reasoning_output_tokens: 100, total_tokens: 1250 }
  const records = [{ type: 'session_meta', payload: { id: 'fixture', cwd: '/fixture' } },
    { type: 'turn_context', payload: { model: 'gpt-5.2-codex' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE-PROMPT' }] } },
    ...[0, 1].map(i => ({ timestamp: `2026-10-12T10:00:0${i}Z`, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } }))]
  await writeFile(join(root, 'rollout.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n')
  const config = Buffer.from(JSON.stringify({ cacheDir: join(home, 'cache') })).toString('base64')
  try {
    for (let i = 0; i < 2; i++) {
      const result = await runProcess({ program: process.execPath, args: ['dist/collector.cjs', '--collect', config], env: { ...process.env, HOME: home, ORCA_USER_DATA_PATH: join(home, 'orca'), XDG_DATA_HOME: join(home, 'data'), TZ: 'UTC' }, timeoutMs: 20_000 })
      assert.equal(result.code, 0, result.stderr)
      assert.ok(!result.stdout.includes('PRIVATE-PROMPT'))
      const data = JSON.parse(result.stdout).providers.find(item => item.provider === 'codex')
      assert.equal(data.state, 'ready'); assert.equal(data.daily.reduce((n, row) => n + row.total, 0), 1250)
      assert.equal(data.daily[0].cached, 400); assert.equal(data.daily[0].reasoning, 100)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('Pi fallback counts both cache buckets without adding reasoning twice; corrupt DSH archives fail visibly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'orca-usage-pi-fixture-'))
  const pi = join(home, '.pi', 'agent', 'sessions'), dsh = join(home, '.dsh', 'sessions')
  await mkdir(pi, { recursive: true }); await mkdir(dsh, { recursive: true })
  await writeFile(join(pi, 'test.jsonl'), JSON.stringify({ type: 'message', timestamp: '2026-10-12T10:00:00Z', message: { role: 'assistant', usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, reasoning: 6 }, content: 'PRIVATE-ASSISTANT' } }) + '\n')
  await writeFile(join(dsh, 'broken.jsonl.zstd'), 'not a zstd archive')
  const config = Buffer.from(JSON.stringify({ cacheDir: join(home, 'cache') })).toString('base64')
  try {
    const result = await runProcess({ program: process.execPath, args: ['dist/collector.cjs', '--collect', config], env: { ...process.env, HOME: home, ORCA_USER_DATA_PATH: join(home, 'orca'), XDG_DATA_HOME: join(home, 'data'), TZ: 'UTC' }, timeoutMs: 20_000 })
    assert.equal(result.code, 0, result.stderr)
    assert.ok(!result.stdout.includes('PRIVATE-ASSISTANT'))
    const providers = JSON.parse(result.stdout).providers
    assert.equal(providers.find(item => item.provider === 'pi').daily[0].total, 135)
    assert.equal(providers.find(item => item.provider === 'dsh').state, 'error')
    assert.match(providers.find(item => item.provider === 'dsh').error, /Cannot decompress/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
