import { runProcess } from './process.mjs'
import { cli } from './hosts.mjs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let launching
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const receiptFile = join(homedir(), '.cache', 'orca-host-usage', 'dashboard', 'service.json')
async function currentService() {
  try {
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8')), url = new URL(receipt.url)
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') return null
    const response = await fetch(`${url.origin}/api/usage`, { headers: { Authorization: `Bearer ${url.hash.slice(1)}` }, signal: AbortSignal.timeout(1500) })
    return response.ok ? receipt : null
  } catch { return null }
}
async function ensureService() {
  const existing = await currentService()
  if (existing) return existing
  if (launching) return launching
  launching = (async () => {
    if (process.platform === 'win32') throw new Error('Run npm start in a local Orca terminal on Windows; automatic service launch currently supports macOS/Linux.')
    const inventory = await runProcess({ program: cli, args: ['worktree', 'list', '--json'], timeoutMs: 10_000 })
    if (inventory.code !== 0) throw new Error(inventory.stdout || inventory.stderr)
    const worktree = JSON.parse(inventory.stdout).result.worktrees.find(value => value.hostId === 'local' || value.identity?.executionHostId === 'local')
    if (!worktree) throw new Error('Open a local Orca workspace to start the usage monitor.')
    const script = fileURLToPath(new URL('./standalone.mjs', import.meta.url))
    const command = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(script)} --service`
    const created = await runProcess({ program: cli, args: ['terminal', 'create', '--worktree', `id:${worktree.id}`, '--title', 'Usage monitor', '--command', command, '--json'], timeoutMs: 20_000 })
    if (created.code !== 0) throw new Error(created.stdout || created.stderr)
    for (let tries = 0; tries < 40; tries++) {
      const running = await currentService()
      if (running) return running
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error('Usage monitor did not become ready. Inspect its Orca terminal.')
  })().finally(() => { launching = null })
  return launching
}
export default function activate(orca) {
  orca.commands.register('usage-open', async () => {
    const dashboard = await ensureService()
    const result = await runProcess({ program: cli, args: ['tab', 'create', '--url', dashboard.url, '--json'], timeoutMs: 20_000 })
    if (result.code !== 0) throw new Error(result.stderr || result.stdout)
    return { opened: true }
  })
  orca.commands.register('usage-scan', async () => {
    const dashboard = await ensureService()
    const url = new URL(dashboard.url)
    await fetch(`${url.origin}/api/scan`, { method: 'POST', headers: { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' }, body: '{}' })
    return { accepted: true }
  })
}
// The monitor is owned by its visible Orca terminal, beyond the worker's idle reap.
