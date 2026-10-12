import { describe, expect, it, vi } from 'vitest'
import { createCodexAppServerRecordDispatcher } from './codex-app-server-record-dispatch'
import { CodexAppServerFrameSizeError } from './codex-app-server-frame-size-error'

const MAX = 64 * 1024 * 1024

function dispatcher() {
  const frames: { kind: string; payload: unknown }[] = []
  const onProtocolFailure = vi.fn()
  const writeResponse = vi.fn()
  const records = createCodexAppServerRecordDispatcher({
    handlers: { onUnhandledFrame: (kind, payload) => frames.push({ kind, payload }) },
    writeResponse,
    onProtocolFailure
  })
  return { records, frames, onProtocolFailure, writeResponse }
}

describe('createCodexAppServerRecordDispatcher oversized records', () => {
  it('skips an oversized notification with a sentence the chat row can show', () => {
    const { records, frames, onProtocolFailure } = dispatcher()

    records.rejectOversized({
      kind: 'line-too-long',
      maxLineBytes: MAX,
      observedBytes: MAX + 1,
      prefix: '{"method":"item/completed","params":{"item":{"aggregatedOutput":"xxxx'
    })

    expect(frames).toEqual([
      {
        kind: 'frame:oversized-notification',
        payload: expect.objectContaining({
          message: 'Codex sent an update over 64 MB, so Orca skipped it.',
          method: 'item/completed'
        })
      }
    ])
    expect(onProtocolFailure).not.toHaveBeenCalled()
  })

  it('fails only the call an oversized reply belonged to', async () => {
    const { records, onProtocolFailure } = dispatcher()
    const reject = vi.fn()
    records.addPending(7, {
      method: 'thread/turns/list',
      resolve: vi.fn(),
      reject,
      timer: setTimeout(() => undefined, 60_000)
    })

    records.rejectOversized({
      kind: 'line-too-long',
      maxLineBytes: MAX,
      observedBytes: MAX + 1,
      prefix: '{"id":7,"result":{"data":"xxxx'
    })

    expect(reject).toHaveBeenCalledWith(expect.any(CodexAppServerFrameSizeError))
    expect(onProtocolFailure).not.toHaveBeenCalled()
  })
})
