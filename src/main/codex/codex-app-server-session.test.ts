import { afterEach, describe, expect, it } from 'vitest'
import { runCodexAppServerSession } from './codex-app-server-session'
import { CodexAppServerFrameSizeError } from './codex-app-server-frame-size-error'
import { PROVIDER_RECORD_MAX_BYTES } from '../provider-process/provider-record-reader'

const originalCodexHome = process.env.CODEX_HOME

afterEach(() => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
  }
})

describe('runCodexAppServerSession environment', () => {
  it('removes inherited variables requested by a default-home invocation', async () => {
    process.env.CODEX_HOME = '/tmp/inherited-managed-home'
    const server = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (typeof message.id !== 'number') return
        const result = message.method === 'env/get'
          ? { codexHome: process.env.CODEX_HOME ?? null }
          : {}
        process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
      })
    `

    const result = await runCodexAppServerSession(
      {
        command: process.execPath,
        cliPath: null,
        args: ['-e', server],
        envToDelete: ['CODEX_HOME'],
        timeoutMs: 5_000
      },
      ({ request }) => request('env/get')
    )

    expect(result).toEqual({ codexHome: null })
  })

  it('keeps the session alive after a large legitimate response', async () => {
    const server = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (typeof message.id !== 'number') return
        const result = message.method === 'test/large'
          ? { data: 'x'.repeat(1024 * 1024 + 1) }
          : { alive: true }
        process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
      })
    `

    const result = await runCodexAppServerSession(
      {
        command: process.execPath,
        cliPath: null,
        args: ['-e', server],
        timeoutMs: 5_000
      },
      async ({ request }) => {
        const large = (await request('test/large')) as { data: string }
        const followup = await request('test/followup')
        return { largeBytes: Buffer.byteLength(large.data, 'utf8'), followup }
      }
    )

    expect(result).toEqual({ largeBytes: 1024 * 1024 + 1, followup: { alive: true } })
  })

  it('fails a call whose reply is over the record cap at once and keeps the session usable', async () => {
    const server = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (typeof message.id !== 'number') return
        if (message.method === 'test/huge') {
          process.stdout.write('{"id":' + message.id + ',"result":{"data":"')
          process.stdout.write('x'.repeat(${PROVIDER_RECORD_MAX_BYTES}) + '"}}\n')
          return
        }
        process.stdout.write(JSON.stringify({ id: message.id, result: { alive: true } }) + '\n')
      })
    `

    const result = await runCodexAppServerSession(
      {
        command: process.execPath,
        cliPath: null,
        args: ['-e', server],
        timeoutMs: 60_000
      },
      async ({ request }) => {
        const huge = await request('test/huge').then(
          () => null,
          (error: unknown) => error
        )
        const followup = await request('test/followup')
        return { huge, followup }
      }
    )

    expect(result.huge).toBeInstanceOf(CodexAppServerFrameSizeError)
    expect(result.followup).toEqual({ alive: true })
  })
})
