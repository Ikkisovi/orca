import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assessSyncSpawnUses,
  collectSyncLaunchUses,
  main,
  readSyncSpawnBaseline
} from './check-main-sync-spawn-ratchet.mjs'

const roots = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function uses(source, file = 'src/main/consumer.ts') {
  return collectSyncLaunchUses(file, source)
}

describe('main sync-spawn ratchet', () => {
  it.each([
    ["import { execFileSync } from 'node:child_process'", ['execFileSync']],
    ["import { execFileSync as run } from 'child_process'\nrun('git')", ['execFileSync']],
    ["import * as cp from 'node:child_process'\ncp.spawnSync('git')", ['spawnSync']],
    ["import cp from 'child_process'\ncp['execSync']('git')", ['execSync']],
    ["import cp = require('child_process')\ncp.execFileSync('git')", ['execFileSync']],
    ["require('node:child_process').execSync('git')", ['execSync']],
    [
      "const cp = require('child_process')\nconst alias = cp\nalias.spawnSync('git')",
      ['spawnSync']
    ],
    ["const { spawnSync: run } = require('node:child_process')", ['spawnSync']],
    ["const { execSync } = await import('node:child_process')", ['execSync']],
    ["(await import('child_process')).execFileSync('git')", ['execFileSync']],
    ["export { spawnSync } from 'node:child_process'", ['spawnSync']],
    ["import { runProcessSync as run } from '@orca/process-host'", ['runProcessSync']],
    ["import { writeSecureFile } from '../shared/secure-file'", ['writeSecureFile']],
    [
      "import { writeDurableSecureJsonFile, writeSecureJsonFile } from '../shared/secure-file.ts'",
      ['writeDurableSecureJsonFile', 'writeSecureJsonFile']
    ],
    [
      "import * as store from '..\\\\shared\\\\bounded-secure-json-file'\nstore.writeSecureJsonFileWithinLimit(p, v, 1)",
      ['writeSecureJsonFileWithinLimit']
    ]
  ])('finds %s', (source, expected) => {
    expect(uses(source)).toEqual(expected)
  })

  it.each([
    "import { spawn, execFile } from 'node:child_process'",
    "import type { execFileSync } from 'node:child_process'",
    "import { type spawnSync } from 'child_process'",
    "import * as cp from 'child_process'\ntype Run = typeof cp.execFileSync",
    "import { runProcess } from '@orca/process-host'",
    "import { runProcessSync } from '@orca/process-host/process-spec'",
    "import { writeSecureFile } from './secure-file'",
    'const other = { spawnSync() {} }\nother.spawnSync()',
    "// execFileSync('git')\nconst script = \"require('child_process').execSync('ls')\"",
    "import * as cp from 'child_process'\ncp.spawn('git')"
  ])('ignores %s', (source) => {
    expect(uses(source)).toEqual([])
  })

  it('counts writer imports by the module they resolve to, not by name', () => {
    expect(uses("import { writeSecureFile } from './secure-file'", 'src/shared/store.ts')).toEqual([
      'writeSecureFile'
    ])
  })

  it('fails closed on source it cannot parse', () => {
    expect(() => uses('import {')).toThrow('Cannot parse src/main/consumer.ts')
  })

  it('reports new users and stale entries, scoped to production main and shared source', () => {
    const sync = "import { execSync } from 'node:child_process'"
    expect(
      assessSyncSpawnUses(
        new Map(
          Object.entries({
            'src/main/legacy.ts': sync,
            'src/shared/new.ts': "import { runProcessSync } from '@orca/process-host'",
            'src/main/clean.ts': "import { spawn } from 'node:child_process'",
            'src/main/consumer.test.ts': sync,
            'src/main/fixtures/script.ts': sync,
            'src/cli/handlers/core.ts': sync,
            'src/relay/host.ts': sync
          })
        ),
        ['src/main/legacy.ts', 'src/main/clean.ts']
      )
    ).toEqual({
      users: ['src/main/legacy.ts', 'src/shared/new.ts'],
      added: [{ file: 'src/shared/new.ts', symbols: ['runProcessSync'] }],
      stale: ['src/main/clean.ts']
    })
  })

  it('reads baseline entries without comments or blank lines', () => {
    expect(readSyncSpawnBaseline('# header\n\n src/main/a.ts \nsrc/shared/b.ts\n')).toEqual([
      'src/main/a.ts',
      'src/shared/b.ts'
    ])
  })

  it('fails a scanned tree with an unlisted launcher and passes once it is listed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-main-sync-spawn-'))
    roots.push(root)
    const files = {
      'src/main/launch.ts': "import { spawnSync } from 'node:child_process'",
      'src/main/launch.test.ts': "import { spawnSync } from 'node:child_process'",
      'src/renderer/src/view.ts': "import { spawnSync } from 'node:child_process'",
      'config/main-sync-spawn-baseline.txt': '# debt\n'
    }
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), source)
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(main(root)).toBe(1)
    expect(error.mock.calls[0][0]).toContain(
      'src/main/launch.ts: new synchronous launch (spawnSync)'
    )
    writeFileSync(path.join(root, 'config/main-sync-spawn-baseline.txt'), 'src/main/launch.ts\n')
    expect(main(root)).toBe(0)
  })
})
