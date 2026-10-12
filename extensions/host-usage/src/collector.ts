import { createHash } from 'node:crypto'
import { hostname, homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { scanCodexUsageFiles } from '../../../src/main/codex-usage/scanner'
import { scanClaudeUsageFiles } from '../../../src/main/claude-usage/scanner'
import { scanOpenCodeUsageDatabases } from '../../../src/main/opencode-usage/scanner'
import { normalizeOpenCodeUsagePersistedDatabases } from '../../../src/main/opencode-usage/persisted-database-normalization'
import { listClaudeProfileHomes } from '../../../src/main/claude-accounts/claude-profile-installed-router'
import { getOrcaUserDataPath } from '../../../src/main/codex/codex-home-paths'
import { readClaudeUsageSourceCache, persistClaudeUsageSourceCache } from '../../../src/main/claude-usage/persisted-source-cache'
import { estimateCostUsd as codexCost } from '../../../src/main/codex-usage/codex-usage-cost-estimate'
import { estimateCostUsd as claudeCost } from '../../../src/main/claude-usage/claude-model-pricing'
import { PiScanner } from '../vendor/venus/scanner/pi-scanner'
import { DshScanner } from '../vendor/venus/scanner/dsh-scanner'

async function readJson(file: string, fallback: unknown = []) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function atomicJson(file: string, value: unknown) {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 })
  await rename(temp, file)
}

function dailyRow(provider: string, row: any) {
  const input = row.inputTokens ?? row.tokens?.input ?? 0
  const output = row.outputTokens ?? row.tokens?.output ?? 0
  const cached = row.cachedInputTokens ?? row.cacheReadTokens ?? row.tokens?.cacheRead ?? 0
  const cacheWrite = row.cacheWriteInputTokens ?? row.cacheWriteTokens ?? row.tokens?.cacheWrite ?? 0
  const reasoning = row.reasoningOutputTokens ?? row.reasoningTokens ?? row.tokens?.reasoning ?? 0
  // Keep first-party totals; each client defines cache and reasoning buckets differently.
  const total = row.totalTokens ?? row.tokens?.totalTokens ?? (input + output + cached + cacheWrite)
  let cost = row.estimatedCostUsd ?? null
  if (provider === 'codex') cost = codexCost(row.model, { ...row, cachedInputTokens: cached })
  if (provider === 'claude') cost = claudeCost(row.model, input, output, cached, cacheWrite, row.cacheWrite1hTokens)
  return {
    day: row.day, provider, model: row.model ?? 'Unknown',
    project: row.projectLabel ?? row.projectKey ?? 'Unknown',
    input, output, cached, cacheWrite, reasoning, total,
    turns: row.turnCount ?? row.eventCount ?? 0, cost
  }
}

function sessionRow(provider: string, row: any) {
  return {
    id: row.sessionId, provider, model: row.model ?? row.primaryModel ?? 'Unknown',
    project: row.cwd ?? row.lastCwd ?? row.primaryProjectLabel ?? 'Unknown',
    firstAt: new Date(row.firstTimestamp).toISOString(),
    lastAt: new Date(row.lastTimestamp).toISOString(),
    turns: row.turnCount ?? row.eventCount ?? 0,
    total: row.totalTokens ?? row.tokens?.totalTokens ?? 0
  }
}

export async function collect(config: any = {}) {
  process.env.TZ = 'UTC'
  const cache = config.cacheDir ?? join(homedir(), '.cache', 'orca-host-usage')
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const startedAt = Date.now()
  let machine = hostname()
  if (process.platform === 'linux') machine = (await readFile('/etc/machine-id', 'utf8')).trim()
  const hostKey = createHash('sha256').update(`${machine}:${userInfo().username}`).digest('hex')
  const providers: any[] = []
  for (const provider of ['codex', 'claude', 'opencode', 'pi', 'dsh']) {
    const scanAt = Date.now()
    process.stderr.write(`Scanning ${provider}\n`)
    try {
      const cacheFile = join(cache, `${provider}-sources${['pi', 'dsh'].includes(provider) ? '-v2' : ''}.json`)
      let result: any
      if (provider === 'codex') {
        result = await scanCodexUsageFiles([], await readJson(cacheFile))
        await atomicJson(cacheFile, result.processedFiles)
      } else if (provider === 'claude') {
        const ref = { path: cacheFile, schemaVersion: 7, worktreeFingerprint: null, reuse: true }
        const previous = await readClaudeUsageSourceCache(ref)
        const profiles = listClaudeProfileHomes(getOrcaUserDataPath()).flatMap(home => [join(home, 'projects'), join(home, 'transcripts')])
        result = await scanClaudeUsageFiles([], previous.sources, undefined, profiles, previous.verifiedSources)
        await persistClaudeUsageSourceCache(ref, result.processedFiles, previous)
      } else if (provider === 'opencode') {
        result = await scanOpenCodeUsageDatabases([], normalizeOpenCodeUsagePersistedDatabases(await readJson(cacheFile)))
        await atomicJson(cacheFile, result.processedDatabases)
      } else if (provider === 'pi') {
        result = await new PiScanner(join(homedir(), '.pi', 'agent', 'sessions'), cacheFile).scan()
      } else {
        result = await new DshScanner([join(homedir(), '.dsh', 'sessions'), ...(config.dshRoots ?? [])], cacheFile).scan()
      }
      providers.push({ provider, state: 'ready', startedAt: scanAt, completedAt: Date.now(),
        sourceCount: result.processedFiles?.length ?? result.processedDatabases?.length ?? result.fileCount ?? 0,
        daily: result.dailyAggregates.map((row: any) => dailyRow(provider, row)),
        sessions: result.sessions.map((row: any) => sessionRow(provider, row)) })
    } catch (error) {
      providers.push({ provider, state: 'error', startedAt: scanAt, completedAt: null,
        error: error instanceof Error ? error.message : String(error), daily: [], sessions: [] })
    }
  }
  return { schemaVersion: 1, hostKey, hostname: hostname(), platform: process.platform,
    scope: 'all-host-agent-logs', timezone: 'UTC', startedAt, completedAt: Date.now(), providers }
}

if (process.argv.includes('--collect')) {
  const encoded = process.argv[process.argv.indexOf('--collect') + 1]
  collect(encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : {})
    .then(snapshot => process.stdout.write(JSON.stringify(snapshot)))
    .catch(error => { process.stderr.write(String(error)); process.exitCode = 1 })
}
