/**
 * Launch panes this window made before asking the host to launch into them.
 *
 * Such a pane must not spawn until the host has answered: before that, main knows of no launch for
 * it and would give it a shell. The hold ends with the host's answer. Session-only: a pane that
 * mounts after a reload spawns from the launch still waiting in main, or as any pane does.
 */

type Hold = { released: Promise<void>; release: () => void }

const holds = new Map<string, Hold>()

// Not `makePaneKey`: that validates the leaf id, and a launch must never fail over bookkeeping.
function holdKey(tabId: string, leafId: string): string {
  return JSON.stringify([tabId, leafId])
}

/** Holds the pane's spawn; the returned function ends the hold and is safe to call twice. */
export function holdAgentLaunchPaneSpawn(tabId: string, leafId: string): () => void {
  const key = holdKey(tabId, leafId)
  let release!: () => void
  const hold: Hold = {
    released: new Promise((resolve) => {
      release = resolve
    }),
    release: () => {
      if (holds.get(key) === hold) {
        holds.delete(key)
      }
      release()
    }
  }
  holds.get(key)?.release()
  holds.set(key, hold)
  return hold.release
}

/** What the pane's spawn awaits first, or null when nothing holds it. */
export function agentLaunchPaneSpawnHold(
  tabId: string | undefined,
  leafId: string | undefined
): Promise<void> | null {
  return tabId && leafId ? (holds.get(holdKey(tabId, leafId))?.released ?? null) : null
}
