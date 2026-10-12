import { createConnection } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const userData = process.env.ORCA_USER_DATA_PATH ?? (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'orca')
  : process.platform === 'win32' ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'orca') : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'orca'))
const metadata = JSON.parse(await readFile(join(userData, 'orca-runtime.json'), 'utf8'))
const endpoint = metadata.transports.find(value => ['unix', 'pipe'].includes(value.kind))?.endpoint
if (!endpoint) throw new Error('No local Orca runtime socket is available.')
async function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint), id = randomUUID(); let buffer = ''
    socket.setEncoding('utf8'); socket.setTimeout(20_000, () => socket.destroy(new Error('Orca RPC timeout')))
    socket.once('error', reject)
    socket.on('connect', () => socket.write(JSON.stringify({ id, method, params, authToken: metadata.authToken }) + '\n'))
    socket.on('data', data => {
      buffer += data
      while (buffer.includes('\n')) {
        const at = buffer.indexOf('\n'), value = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1)
        if (value._keepalive || value.id !== id) continue
        socket.end()
        if (value.ok) resolve(value.result)
        else reject(new Error(value.error?.message ?? JSON.stringify(value.error)))
      }
    })
  })
}
const key = 'ikkisovi.host-usage'
const list = await rpc('plugins.list')
const plugin = list.find(value => value.pluginKey === key)
if (!plugin) throw new Error('Install dist through Orca Settings → Plugins first.')
console.log(JSON.stringify({ pluginKey: plugin.pluginKey, status: plugin.status, consentFingerprint: plugin.consentFingerprint, isDev: plugin.isDev }, null, 2))
if (process.argv.includes('--approve-worker')) {
  await rpc('plugins.consent', { pluginKey: key, reviewedFingerprint: plugin.consentFingerprint, decision: 'approve' })
  console.log('Approved the reviewed trusted Node worker through Orca’s consent API.')
}
if (process.argv.includes('--open')) {
  const result = await rpc('plugins.invokeCommand', { pluginKey: key, commandId: 'usage-open' })
  console.log(JSON.stringify({ command: 'usage-open', result }))
}
