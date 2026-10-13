import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createMacAppActivationHandler } from './macos-app-activation'

function makeWindow(
  destroyed = false,
  visible = true
): Pick<BrowserWindow, 'isDestroyed' | 'isVisible'> {
  return {
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => visible)
  }
}

describe('createMacAppActivationHandler', () => {
  it('leaves an existing window to native macOS activation', () => {
    const requestActivation = vi.fn()
    const handler = createMacAppActivationHandler({
      getWindow: () => makeWindow(),
      requestActivation
    })

    handler()

    expect(requestActivation).not.toHaveBeenCalled()
  })

  it.each([null, makeWindow(true), makeWindow(false, false)])(
    'requests desktop activation for a missing, destroyed or hidden window',
    (window) => {
      const requestActivation = vi.fn()
      const handler = createMacAppActivationHandler({
        getWindow: () => window,
        requestActivation
      })

      handler()

      expect(requestActivation).toHaveBeenCalledTimes(1)
    }
  )
})
