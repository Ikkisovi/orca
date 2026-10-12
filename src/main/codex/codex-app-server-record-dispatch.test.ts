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

function oversized(prefix: string) {
  return { kind: 'line-too-long' as const, maxLineBytes: MAX, observedBytes: MAX + 1, prefix }
}

function pendingCall(
  records: ReturnType<typeof createCodexAppServerRecordDispatcher>,
  id: number,
  method: string
) {
  const waiter = {
    method,
    resolve: vi.fn(),
    reject: vi.fn(),
    timer: setTimeout(() => undefined, 0)
  }
  records.addPending(id, waiter)
  return waiter
}

describe('createCodexAppServerRecordDispatcher oversized records', () => {
  it('skips an oversized notification with a sentence the chat row can show', () => {
    const { records, frames, onProtocolFailure } = dispatcher()

    records.rejectOversized(
      oversized('{"method":"item/completed","params":{"item":{"aggregatedOutput":"xxxx')
    )

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

  it('fails only the call an oversized reply belonged to, without a chat row', () => {
    const { records, frames, onProtocolFailure } = dispatcher()
    const owner = pendingCall(records, 7, 'thread/turns/list')
    const other = pendingCall(records, 8, 'turn/start')

    records.rejectOversized(oversized('{"id":7,"result":{"data":"xxxx'))

    expect(owner.reject).toHaveBeenCalledWith(expect.any(CodexAppServerFrameSizeError))
    expect(other.reject).not.toHaveBeenCalled()
    expect(frames).toEqual([])
    expect(onProtocolFailure).not.toHaveBeenCalled()
  })

  it('drops an oversized late reply to a timed-out call like any late reply', () => {
    const { records, frames, onProtocolFailure } = dispatcher()
    pendingCall(records, 7, 'thread/turns/list')
    const other = pendingCall(records, 8, 'turn/start')
    records.timeOutPending(7)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    records.rejectOversized(oversized('{"id":7,"result":{"data":"xxxx'))

    expect(warn).toHaveBeenCalledWith(
      '[codex-app-server] late reply to thread/turns/list after timeout (id 7)'
    )
    warn.mockRestore()
    expect(other.reject).not.toHaveBeenCalled()
    expect(frames).toEqual([])
    expect(onProtocolFailure).not.toHaveBeenCalled()
  })

  it('keeps a frame the chat never shows silent when it is oversized', () => {
    const { records, frames } = dispatcher()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    records.rejectOversized(oversized('{"method":"turn/diff/updated","params":{"diff":"xxxx'))

    warn.mockRestore()
    expect(frames).toEqual([])
  })

  it('declines an oversized server request and says so', () => {
    const { records, frames, writeResponse } = dispatcher()

    records.rejectOversized(
      oversized('{"id":"req-1","method":"item/tool/requestUserInput","params":{"q":"xx')
    )

    expect(writeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-1', error: expect.objectContaining({ code: -32001 }) })
    )
    expect(frames).toEqual([
      {
        kind: 'frame:oversized-request',
        payload: expect.objectContaining({
          message: 'Codex sent a request over 64 MB, so Orca declined it.'
        })
      }
    ])
  })
})
