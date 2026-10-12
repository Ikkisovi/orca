import { runProcess } from './process.mjs'

export const cli = process.env.ORCA_CLI_COMMAND || (process.platform === 'linux' ? 'orca-ide' : 'orca')
export const validAlias = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,200}$/.test(value)

async function orcaJson(args) {
  const result = await runProcess({ program: cli, args: [...args, '--json'], timeoutMs: 15_000 })
  if (result.code !== 0) throw new Error(result.stdout || result.stderr || 'Orca discovery failed')
  const response = JSON.parse(result.stdout)
  if (!response.ok) throw new Error(response.error?.message || 'Orca discovery failed')
  return response.result
}

export async function discoverHosts(manual = []) {
  const settled = await Promise.allSettled([orcaJson(['host', 'list']), orcaJson(['environment', 'list'])])
  const warnings = settled.filter(item => item.status === 'rejected').map(item => String(item.reason))
  const hosts = settled[0].status === 'fulfilled' ? settled[0].value.hosts : []
  const environments = settled[1].status === 'fulfilled' ? settled[1].value.environments : []
  const aliases = [...new Set([...hosts.filter(host => host.kind === 'ssh').map(host => host.name), ...manual])].filter(validAlias)
  const resolved = await Promise.all(aliases.map(async alias => {
    const result = await runProcess({ program: 'ssh', args: ['-G', alias], timeoutMs: 5000 })
    if (result.code !== 0) return { alias, key: `ssh:${alias}`, label: alias, aliases: [alias], kind: 'ssh' }
    const config = Object.fromEntries(result.stdout.split('\n').map(line => { const at = line.indexOf(' '); return [line.slice(0, at), line.slice(at + 1)] }))
    return { alias, key: `ssh:${config.user}@${config.hostname}:${config.port}`, address: config.hostname,
      label: alias, aliases: [alias], kind: 'ssh' }
  }))
  const byKey = new Map()
  for (const host of resolved) {
    const existing = byKey.get(host.key)
    if (existing) existing.aliases.push(host.alias)
    else byKey.set(host.key, host)
  }
  const remote = [...byKey.values()]
  for (const environment of environments) {
    const endpoint = environment.endpoints?.find(value => value.id === environment.preferredEndpointId) ?? environment.endpoints?.[0]
    let address
    try { address = new URL(endpoint.endpoint).hostname } catch { continue }
    const host = remote.find(value => value.address === address)
    if (host) host.aliases.push(environment.name)
    else remote.push({ key: `environment:${environment.id}`, label: environment.name, aliases: [environment.name],
      kind: 'environment', error: 'Add an SSH alias for this machine to enable scanning.' })
  }
  return { hosts: [{ key: 'local', label: hosts.find(value => value.kind === 'local')?.machineName ?? 'This machine',
    aliases: ['local'], kind: 'local' }, ...remote], warnings }
}
