// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RefObject } from 'react'
import type { AppState } from '@/store'
import { afterEach, expect, it, vi } from 'vitest'
import NewWorkspaceComposerModal from './NewWorkspaceComposerModal'

type ComposerModalState = Pick<AppState, 'activeModal' | 'closeModal' | 'settings' | 'modalData'>

const { submitQuick } = vi.hoisted(() => ({ submitQuick: vi.fn() }))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: ComposerModalState) => unknown) =>
    select({
      activeModal: 'new-workspace-composer',
      closeModal: vi.fn(),
      settings: null,
      modalData: {}
    })
}))
vi.mock('@/hooks/useComposerState', async () => {
  const { useRef } = await import('react')
  return {
    useComposerState: () => ({
      composerRef: useRef<HTMLDivElement>(null),
      cardProps: { detectedAgentIds: [], projectOptions: [], selectedRepoIsGit: true },
      createDisabled: false,
      submitQuick
    })
  }
})
vi.mock('@/components/agent/AgentSettingsDialog', () => ({ default: () => null }))
vi.mock('@/components/NewWorkspaceComposerCard', () => ({
  default: ({ composerRef }: { composerRef: RefObject<HTMLDivElement | null> }) => (
    <div ref={composerRef} data-sparse-preset-editing>
      <input aria-label="Preset name" />
    </div>
  )
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  submitQuick.mockReset()
})

it.each(['Macintosh', 'Windows', 'Linux'])(
  'blocks screen submit while editing a sparse preset on %s',
  (platform) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
    render(<NewWorkspaceComposerModal />)
    const input = screen.getByRole('textbox', { name: 'Preset name' })
    const shortcut = {
      key: 'Enter',
      metaKey: platform === 'Macintosh',
      ctrlKey: platform !== 'Macintosh'
    }
    fireEvent.keyDown(input, shortcut)
    expect(submitQuick).not.toHaveBeenCalled()
    input.parentElement?.removeAttribute('data-sparse-preset-editing')
    fireEvent.keyDown(input, shortcut)
    expect(submitQuick).toHaveBeenCalledOnce()
  }
)
