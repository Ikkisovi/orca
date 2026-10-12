import type { Readable } from 'node:stream'
import {
  createIncrementalNdjsonFramer,
  type NdjsonRejectedRecord
} from '../../shared/main-process-ndjson-framer'

type RecordReaderStream = Pick<Readable, 'on' | 'pause' | 'resume' | 'setEncoding'>

/** One provider stdout record, bounded so a runaway line cannot exhaust the process reading it.
 *  Far above anything kept: Codex caps command/MCP output at 1 MiB and journal rows keep 16 KiB. */
export const PROVIDER_RECORD_MAX_BYTES = 64 * 1024 * 1024

export type ProviderRecordReader = {
  pause: () => void
  resume: () => void
}

export function createProviderRecordReader(input: {
  stdout: RecordReaderStream
  onRecord: (record: unknown, line: string) => void
  onRejected: (rejected: NdjsonRejectedRecord) => void
  onFatal: (error: Error) => void
}): ProviderRecordReader {
  let paused = false
  const framer = createIncrementalNdjsonFramer(input.onRecord, input.onRejected, {
    maxLineBytes: PROVIDER_RECORD_MAX_BYTES,
    shouldPause: () => paused
  })

  input.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    try {
      framer.feed(chunk)
    } catch (error) {
      input.onFatal(error instanceof Error ? error : new Error(String(error)))
    }
  })

  return {
    pause: () => {
      paused = true
      input.stdout.pause()
    },
    resume: () => {
      if (!paused) {
        return
      }
      paused = false
      framer.resume()
      if (!paused) {
        input.stdout.resume()
      }
    }
  }
}
