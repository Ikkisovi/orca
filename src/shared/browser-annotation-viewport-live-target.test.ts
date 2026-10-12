import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BROWSER_ANNOTATION_VIEWPORT_MESSAGE_PREFIX,
  BROWSER_GRAB_SELECTED_ATTRIBUTE,
  buildBrowserAnnotationViewportBridgeScript
} from './browser-annotation-viewport-bridge'
import {
  parseBrowserAnnotationViewportReport,
  type BrowserAnnotationViewportReport
} from './browser-annotation-viewport-report'

type Rect = { x: number; y: number; width: number; height: number }

const TOKEN = 'live-target-test-token'
const guestAborts: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(guestAborts.splice(0).map((abort) => abort()))
})

async function createGuest() {
  const { Window } = await import('happy-dom')
  const window = new Window({ width: 1000, height: 800 })
  guestAborts.push(() => window.happyDOM.abort())
  const document = window.document
  const scroller = document.createElement('div')
  const target = document.createElement('section')
  scroller.appendChild(target)
  document.body.appendChild(scroller)
  let targetRect: Rect = { x: 40, y: 300, width: 120, height: 30 }
  target.getBoundingClientRect = () =>
    new window.DOMRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height)

  const frames: (() => void)[] = []
  const resizeCallbacks: (() => void)[] = []
  const reports: BrowserAnnotationViewportReport[] = []
  const prefix = `${BROWSER_ANNOTATION_VIEWPORT_MESSAGE_PREFIX}${TOKEN}:`
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
    },
    console: {
      debug: (message: string) => {
        const report = parseBrowserAnnotationViewportReport(message.slice(prefix.length))
        if (message.startsWith(prefix) && report) {
          reports.push(report)
        }
      }
    }
  }
  const install = (emitViewport: boolean, selectionId = 'selection-1'): void => {
    runInNewContext(
      buildBrowserAnnotationViewportBridgeScript({
        emitViewport,
        enabled: true,
        token: TOKEN,
        markers: [],
        selectionId
      }),
      context
    )
  }
  const flushFrames = (): void => {
    for (const frame of frames.splice(0)) {
      frame()
    }
  }
  return {
    window,
    scroller,
    target,
    install,
    flushFrames,
    resizeCallbacks,
    lastReport: () => reports.at(-1),
    moveTarget: (rect: Rect) => {
      targetRect = rect
    }
  }
}

describe('annotation viewport bridge live target', () => {
  it('reports the selected element measured live, including scroll inside a box', async () => {
    const guest = await createGuest()
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')
    guest.install(true)
    guest.flushFrames()
    expect(guest.lastReport()).toEqual({
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1000,
      target: { x: 40, y: 300, width: 120, height: 30 }
    })

    // A box scrolling inside the page leaves window scroll unchanged.
    guest.moveTarget({ x: 40, y: 120, width: 120, height: 30 })
    guest.scroller.dispatchEvent(new guest.window.Event('scroll'))
    guest.flushFrames()
    expect(guest.lastReport()?.target).toEqual({ x: 40, y: 120, width: 120, height: 30 })
  })

  it('ignores an earlier page-owned selection marker', async () => {
    const guest = await createGuest()
    const decoy = guest.window.document.createElement('div')
    decoy.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'page-owned')
    decoy.getBoundingClientRect = () => new guest.window.DOMRect(600, 400, 40, 20)
    guest.window.document.body.insertBefore(decoy, guest.scroller)
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')

    guest.install(true)
    guest.flushFrames()

    expect(guest.lastReport()?.target).toEqual({ x: 40, y: 300, width: 120, height: 30 })
  })

  it('switches to a new selection when the bridge is reused', async () => {
    const guest = await createGuest()
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')
    guest.install(true)
    guest.flushFrames()

    const next = guest.window.document.createElement('button')
    next.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-2')
    next.getBoundingClientRect = () => new guest.window.DOMRect(200, 100, 80, 20)
    guest.window.document.body.appendChild(next)
    guest.install(true, 'selection-2')
    guest.flushFrames()

    expect(guest.lastReport()?.target).toEqual({ x: 200, y: 100, width: 80, height: 20 })
  })

  it('does not report a target when two elements copy the same selection value', async () => {
    const guest = await createGuest()
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')
    const decoy = guest.window.document.createElement('div')
    decoy.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')
    guest.window.document.body.insertBefore(decoy, guest.scroller)

    guest.install(true)
    guest.flushFrames()

    expect(guest.lastReport()?.target).toBeUndefined()
  })

  it('re-reports on resize and when the element changes size', async () => {
    const guest = await createGuest()
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')
    guest.install(true)
    guest.flushFrames()

    guest.moveTarget({ x: 10, y: 200, width: 80, height: 30 })
    guest.window.dispatchEvent(new guest.window.Event('resize'))
    guest.flushFrames()
    expect(guest.lastReport()?.target).toEqual({ x: 10, y: 200, width: 80, height: 30 })

    guest.moveTarget({ x: 10, y: 200, width: 80, height: 90 })
    for (const callback of guest.resizeCallbacks) {
      callback()
    }
    guest.flushFrames()
    expect(guest.lastReport()?.target).toEqual({ x: 10, y: 200, width: 80, height: 90 })
  })

  it('reports no target once the grab overlay has released the element', async () => {
    const guest = await createGuest()
    guest.target.setAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE, 'selection-1')
    guest.install(true)
    guest.flushFrames()

    guest.target.removeAttribute(BROWSER_GRAB_SELECTED_ATTRIBUTE)
    guest.window.dispatchEvent(new guest.window.Event('scroll'))
    guest.flushFrames()
    expect(guest.lastReport()?.target).toBeUndefined()
  })
})

describe('parseBrowserAnnotationViewportReport', () => {
  it('keeps only well-formed numbers and boxes', () => {
    expect(
      parseBrowserAnnotationViewportReport(
        JSON.stringify({ scrollX: 'x', scrollY: 4, viewportWidth: -1, target: { x: 1 } })
      )
    ).toEqual({ scrollX: 0, scrollY: 4 })
    expect(parseBrowserAnnotationViewportReport('not json')).toBeNull()
    expect(parseBrowserAnnotationViewportReport('7')).toBeNull()
  })
})
