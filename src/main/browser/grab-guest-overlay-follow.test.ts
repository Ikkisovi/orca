import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { BROWSER_GRAB_SELECTED_ATTRIBUTE } from '../../shared/browser-annotation-viewport-bridge'
import { buildGuestOverlayScript } from './grab-guest-script'

type Rect = { x: number; y: number; width: number; height: number }

const guestAborts: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(guestAborts.splice(0).map((abort) => abort()))
})

async function armGuest(previousMarker?: string) {
  const { Window } = await import('happy-dom')
  const window = new Window()
  guestAborts.push(() => window.happyDOM.abort())
  const document = window.document

  // The overlay lives in a closed shadow root; keep a handle so the test can read the outline.
  const shadowRoots: ReturnType<typeof window.HTMLElement.prototype.attachShadow>[] = []
  const attachShadow = window.HTMLElement.prototype.attachShadow
  window.HTMLElement.prototype.attachShadow = function (init) {
    const root = attachShadow.call(this, init)
    shadowRoots.push(root)
    return root
  }

  const scroller = document.createElement('div')
  const target = document.createElement('button')
  if (previousMarker !== undefined) {
    target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, previousMarker)
  }
  scroller.appendChild(target)
  document.body.appendChild(scroller)
  let targetRect: Rect = { x: 40, y: 300, width: 120, height: 30 }
  target.getBoundingClientRect = () =>
    new window.DOMRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height)
  document.elementFromPoint = () => target

  const frames: (() => void)[] = []
  const resizeCallbacks: (() => void)[] = []
  const context = {
    window,
    document,
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback)
      }
      observe(): void {}
      disconnect(): void {}
    }
  }
  expect(runInNewContext(buildGuestOverlayScript('arm'), context)).toBe(true)
  const grab: {
    host: { dispatchEvent: (event: unknown) => void }
    freezeHighlight: (selectionId: string) => void
    cleanup: () => void
  } = Object.getOwnPropertyDescriptor(window, '__orcaGrab')?.value
  const flushFrames = (): void => {
    for (const frame of frames.splice(0)) {
      frame()
    }
  }
  const outline = (): Rect => {
    // The outline is the first box inside the overlay container.
    const box = shadowRoots[0].firstElementChild?.firstElementChild
    if (!(box instanceof window.HTMLElement)) {
      throw new Error('outline not rendered')
    }
    const style = box.style
    return {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height)
    }
  }

  // Hover the target, then click-freeze it like awaitClick does.
  grab.host.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 50, clientY: 310 }))
  flushFrames()
  grab.freezeHighlight('selection-1')

  return {
    window,
    scroller,
    target,
    grab,
    outline,
    flushFrames,
    resizeCallbacks,
    moveTarget: (rect: Rect) => {
      targetRect = rect
    }
  }
}

describe('grab overlay after the click', () => {
  it('keeps the outline on the element when a box inside the page scrolls', async () => {
    const guest = await armGuest()
    expect(guest.outline()).toEqual({ x: 40, y: 300, width: 120, height: 30 })

    guest.moveTarget({ x: 40, y: 180, width: 120, height: 30 })
    guest.scroller.dispatchEvent(new guest.window.Event('scroll'))
    guest.flushFrames()

    expect(guest.outline()).toEqual({ x: 40, y: 180, width: 120, height: 30 })
  })

  it('re-measures on window resize and when the element changes size', async () => {
    const guest = await armGuest()

    guest.moveTarget({ x: 20, y: 250, width: 90, height: 24 })
    guest.window.dispatchEvent(new guest.window.Event('resize'))
    guest.flushFrames()
    expect(guest.outline()).toEqual({ x: 20, y: 250, width: 90, height: 24 })

    guest.moveTarget({ x: 20, y: 250, width: 90, height: 80 })
    for (const callback of guest.resizeCallbacks) {
      callback()
    }
    guest.flushFrames()
    expect(guest.outline()).toEqual({ x: 20, y: 250, width: 90, height: 80 })
  })

  it('marks the selected element for the viewport bridge and clears it on teardown', async () => {
    const guest = await armGuest()
    expect(guest.target.getAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE)).toBe('selection-1')

    guest.grab.cleanup()
    expect(guest.target.hasAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE)).toBe(false)

    guest.moveTarget({ x: 0, y: 0, width: 1, height: 1 })
    guest.scroller.dispatchEvent(new guest.window.Event('scroll'))
    expect(guest.flushFrames).not.toThrow()
  })

  it('restores a page-owned marker value on teardown', async () => {
    const guest = await armGuest('page-owned')
    expect(guest.target.getAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE)).toBe('selection-1')

    guest.grab.cleanup()
    expect(guest.target.getAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE)).toBe('page-owned')
  })

  it('does not overwrite a page marker changed after the selection', async () => {
    const guest = await armGuest('page-owned')
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'page-updated')

    guest.grab.cleanup()

    expect(guest.target.getAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE)).toBe('page-updated')
  })
})
