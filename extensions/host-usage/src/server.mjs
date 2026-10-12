import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runProcess } from './process.mjs'
import { discoverHosts, validAlias } from './hosts.mjs'
import { rollup, reconcileSnapshot } from './rollup.mjs'

const assets = fileURLToPath(new URL('./', import.meta.url))
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const LIMIT = 32 * 1024 * 1024
export async function startServer({ stateDir = join(homedir(), '.cache', 'orca-host-usage', 'dashboard'), bundleDir = assets, discovery = discoverHosts, execute = runProcess } = {}) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const stateFile = join(stateDir, 'state.json')
  let saved = { manual: [], interval: 60, hosts: [] }
  try { saved = { ...saved, ...JSON.parse(await readFile(stateFile, 'utf8')) } } catch {}
  let hosts = saved.hosts, warnings = [], scanning = null, lastDiscovery = 0, timer
  const token = randomBytes(32).toString('hex')
  const controller = new AbortController()
  const collector = await readFile(join(bundleDir, 'collector.cjs'), 'utf8')
  let writes = Promise.resolve()
  const persist = () => {
    writes = writes.catch(() => {}).then(async () => {
    const temp = stateFile + '.tmp'
    await writeFile(temp, JSON.stringify({ ...saved, hosts }), { mode: 0o600 })
    await rename(temp, stateFile)
    })
    return writes
  }
  async function discover() {
    const found = await discovery(saved.manual)
    warnings = found.warnings
    const old = new Map(hosts.map(host => [host.key, host]))
    hosts = found.hosts.map(host => ({ ...old.get(host.key), ...host, state: old.get(host.key)?.state ?? 'unscanned' }))
    lastDiscovery = Date.now()
    await persist()
  }
  async function collectHost(host) {
    if (host.kind === 'environment') { host.state = 'needs-ssh'; return }
    host.state = 'scanning'; host.error = null; host.scanStartedAt = Date.now()
    try {
      const config = host.kind === 'local' ? { cacheDir: join(stateDir, 'sources') }
        : { dshRoots: saved.dshRoots ?? ['/mnt/intel_ssd/ikkipipi_data/dsh_sessions'] }
      const encoded = Buffer.from(JSON.stringify(config)).toString('base64')
      const args = host.kind === 'local' ? [join(bundleDir, 'collector.cjs'), '--collect', encoded]
        : ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', host.alias,
          `TZ=UTC node - --collect ${shellQuote(encoded)}`]
      const result = await execute({ program: host.kind === 'local' ? process.execPath : 'ssh', args,
        env: { ...process.env, TZ: 'UTC', ELECTRON_RUN_AS_NODE: '1' },
        input: host.kind === 'local' ? undefined : collector, timeoutMs: 180_000,
        signal: controller.signal,
        maxOutputBytes: LIMIT, killOnOutputLimit: true, detached: process.platform !== 'win32' })
      if (result.code !== 0 || result.timedOut || result.outputTruncated) throw new Error(result.timedOut ? 'Scan timed out; previous data retained.' : result.stderr || 'Collector failed')
      const snapshot = JSON.parse(result.stdout)
      if (snapshot.schemaVersion !== 1 || !snapshot.hostKey || !Array.isArray(snapshot.providers)) throw new Error('Unsupported collector response')
      host.snapshot = reconcileSnapshot(host.snapshot, snapshot)
      host.state = snapshot.providers.some(provider => provider.state === 'error') ? 'partial' : 'ready'
      host.lastSuccessAt = snapshot.completedAt
    } catch (error) { host.state = 'error'; host.error = String(error.message ?? error) }
    host.scanCompletedAt = Date.now()
    await persist()
  }
  function scan(key = 'all') {
    if (scanning) return scanning
    scanning = (async () => {
      if (Date.now() - lastDiscovery > 60_000) await discover()
      await Promise.all(hosts.filter(host => key === 'all' || key === host.key).map(collectHost))
    })().catch(error => { warnings = [String(error)] }).finally(() => { scanning = null })
    return scanning
  }
  function schedule() {
    clearInterval(timer)
    if (saved.interval) timer = setInterval(() => { void scan() }, saved.interval * 1000)
    timer?.unref()
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname.startsWith('/api/')) {
        const given = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '')
        const expected = Buffer.from(token)
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) { res.writeHead(401); res.end('Unauthorized'); return }
        if (req.headers.origin && req.headers.origin !== origin) { res.writeHead(403); res.end('Invalid origin'); return }
        res.setHeader('Content-Type', 'application/json')
        if (url.pathname === '/api/usage' && req.method === 'GET') {
          res.end(JSON.stringify({ hosts: hosts.map(({ snapshot, ...host }) => ({ ...host,
            hostname: snapshot?.hostname, providers: snapshot?.providers.map(({ daily, sessions, ...provider }) => provider) })),
            warnings, scanning: Boolean(scanning), interval: saved.interval, timezone: 'UTC',
            data: rollup(hosts, Object.fromEntries(url.searchParams)) })); return
        }
        if (req.method !== 'POST') { res.writeHead(404); res.end('{}'); return }
        let body = ''
        for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.writeHead(413); res.end('{}'); return } }
        const value = body ? JSON.parse(body) : {}
        if (url.pathname === '/api/scan') {
          if (value.host && value.host !== 'all' && !hosts.some(host => host.key === value.host)) throw new Error('Unknown host')
          void scan(value.host || 'all')
          res.writeHead(202); res.end(JSON.stringify({ accepted: true })); return
        }
        if (url.pathname === '/api/settings') {
          if (![0, 30, 60, 300].includes(value.interval)) throw new Error('Invalid interval')
          saved.interval = value.interval; schedule(); await persist()
        } else if (url.pathname === '/api/hosts') {
          if (!validAlias(value.alias)) throw new Error('Use an SSH config alias or user@host')
          saved.manual = [...new Set([...saved.manual, value.alias])]; await scanning; await discover()
        } else { res.writeHead(404); res.end('{}'); return }
        res.end(JSON.stringify({ ok: true })); return
      }
      const files = { '/': ['dashboard.html', 'text/html'], '/dashboard.js': ['dashboard.js', 'text/javascript'],
        '/dashboard.css': ['dashboard.css', 'text/css'], '/tokens.css': ['tokens.css', 'text/css'], '/font.woff2': ['font.woff2', 'font/woff2'] }
      const file = files[url.pathname]
      if (!file || req.method !== 'GET') { res.writeHead(404); res.end(); return }
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'")
      res.setHeader('Content-Type', file[1]); res.end(await readFile(join(bundleDir, file[0])))
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: String(error.message ?? error) })) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`
  await discover(); schedule()
  return { url: `${origin}/#${token}`, origin, token, scan, discover, hosts: () => hosts,
    stop: async () => { clearInterval(timer); controller.abort(); await scanning; await writes; await new Promise(resolve => server.close(resolve)) } }
}
