import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { NdjsonRejectedRecord } from '../../shared/main-process-ndjson-framer'
import { createProviderRecordReader, PROVIDER_RECORD_MAX_BYTES } from './provider-record-reader'

const CHUNK_BYTES = 1024 * 1024

function startReader() {
  const stdout = new PassThrough()
  const records: unknown[] = []
  const rejected: NdjsonRejectedRecord[] = []
  const fatal: Error[] = []
  createProviderRecordReader({
    stdout,
    onRecord: (record) => records.push(record),
    onRejected: (record) => rejected.push(record),
    onFatal: (error) => fatal.push(error)
  })
  return { stdout, records, rejected, fatal }
}

/** Writes `bytes` of filler in pipe-sized pieces, as a child's stdout arrives. */
async function writeFiller(stdout: PassThrough, bytes: number): Promise<void> {
  const chunk = Buffer.alloc(CHUNK_BYTES, 'x')
  for (let left = bytes; left > 0; left -= CHUNK_BYTES) {
    stdout.write(left >= CHUNK_BYTES ? chunk : chunk.subarray(0, left))
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('createProviderRecordReader', () => {
  it('parses a record exactly at the cap', async () => {
    const { stdout, records, rejected } = startReader()
    const head = '{"data":"'
    const tail = '"}'
    stdout.write(head)
    await writeFiller(stdout, PROVIDER_RECORD_MAX_BYTES - head.length - tail.length)
    stdout.write(`${tail}\n`)
    await new Promise((resolve) => setImmediate(resolve))

    expect(rejected).toEqual([])
    expect(records).toEqual([
      { data: 'x'.repeat(PROVIDER_RECORD_MAX_BYTES - head.length - tail.length) }
    ])
  })

  it('rejects a record over the cap as it crosses it, then parses the next record', async () => {
    const { stdout, records, rejected, fatal } = startReader()
    const head = '{"method":"item/completed","params":{"output":"'
    stdout.write(head)
    await writeFiller(stdout, PROVIDER_RECORD_MAX_BYTES)

    // Rejected while the record is still arriving: nothing waits for a newline that may never come.
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      kind: 'line-too-long',
      maxLineBytes: PROVIDER_RECORD_MAX_BYTES
    })
    const prefix = rejected[0]?.kind === 'line-too-long' ? rejected[0].prefix : ''
    expect(prefix.startsWith(head)).toBe(true)
    expect(Buffer.byteLength(prefix, 'utf8')).toBeLessThanOrEqual(64 * 1024)

    await writeFiller(stdout, 8 * CHUNK_BYTES)
    stdout.write('"}}\n{"method":"turn/completed","params":{}}\n')
    await new Promise((resolve) => setImmediate(resolve))

    expect(rejected).toHaveLength(1)
    expect(records).toEqual([{ method: 'turn/completed', params: {} }])
    expect(fatal).toEqual([])
  })
})
