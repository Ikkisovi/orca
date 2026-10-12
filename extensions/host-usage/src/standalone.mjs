import { startServer } from './server.mjs'
import { runProcess } from './process.mjs'
import { cli } from './hosts.mjs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { writeFile, unlink } from 'node:fs/promises'

const stateDir = process.env.ORCA_USAGE_STATE_DIR ?? (process.argv.includes('--service') ? join(homedir(), '.cache', 'orca-host-usage', 'dashboard') : resolve('.state'))
const dashboard = await startServer({ stateDir })
const receipt = join(stateDir, 'service.json')
if (process.argv.includes('--service')) await writeFile(receipt, JSON.stringify({ pid: process.pid, url: dashboard.url, startedAt: Date.now() }), { mode: 0o600 })
if (process.argv.includes('--open')) {
  const result = await runProcess({ program: cli, args: ['tab', 'create', '--url', dashboard.url, '--json'], timeoutMs: 20_000 })
  if (result.code !== 0) console.error(result.stderr || result.stdout)
  else console.log('Opened usage dashboard in Orca.')
} else if (!process.argv.includes('--service')) console.log('Dashboard URL:', dashboard.url)
else console.log('Usage monitor running. Close this terminal to stop it.')
void dashboard.scan()
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await dashboard.stop(); if (process.argv.includes('--service')) await unlink(receipt).catch(() => {}); process.exit(0) })
