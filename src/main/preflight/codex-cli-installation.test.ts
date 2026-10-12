import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readCodexCliInstallation } from './codex-cli-installation'

const { runProcess } = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('@orca/process-host', async (original) => ({
  ...(await original<object>()),
  runProcess
}))

const roots: string[] = []
async function binary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-installation-test-'))
  roots.push(root)
  const file = join(root, 'codex')
  await writeFile(file, 'fake binary; never executed')
  return file
}
function prints(stdout: string, timedOut = false): void {
  runProcess.mockResolvedValue({ code: 0, stdout, stderr: '', timedOut })
}
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  runProcess.mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Codex installation version probes', () => {
  it('probes every read and sees changes behind an unchanged launcher', async () => {
    const program = await binary()
    const input = { program, env: { PATH: '/launch/path' } }
    for (const version of ['0.135.0', '0.136.0', '0.135.0']) {
      prints(`company-wrapper 0.1.0\ncodex-cli ${version}`)
      expect((await readCodexCliInstallation(input)).version).toBe(version)
    }
    expect(runProcess).toHaveBeenCalledTimes(3)
    expect(runProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        program,
        env: input.env,
        args: ['--version'],
        timeoutMs: 5_000,
        maxOutputBytes: 4_096
      })
    )
  })

  it('allows a timeout and reads the next version without waiting', async () => {
    const program = await binary()
    prints('codex-cli 0.135.0', true)
    expect((await readCodexCliInstallation({ program })).status).toBe('unknown')
    prints('codex-cli 0.136.0')
    expect((await readCodexCliInstallation({ program })).status).toBe('ready')
    expect(runProcess).toHaveBeenCalledTimes(2)
  })

  it('proves a missing binary from the filesystem and allows an installed binary with a broken interpreter', async () => {
    const program = await binary()
    expect((await readCodexCliInstallation({ program: join(program, 'missing') })).status).toBe(
      'unknown'
    )
    expect(
      (await readCodexCliInstallation({ program: join(program, '..', 'missing') })).status
    ).toBe('missing')
    expect(runProcess).not.toHaveBeenCalled()
    runProcess.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect((await readCodexCliInstallation({ program })).status).toBe('unknown')
    runProcess.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'EACCES' }))
    expect((await readCodexCliInstallation({ program: await binary() })).status).toBe('unknown')
  })
})
