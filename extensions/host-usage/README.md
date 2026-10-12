# Kai's usage for Orca

An Orca extension for local and remote agent usage. The dashboard opens in Orca's built-in browser; its monitor runs in a named **Usage monitor** terminal on a local Orca workspace.

It scans Codex, Claude, OpenCode, Pi and DSH logs on the local machine and saved SSH hosts. Saved paired environments are linked to matching SSH connections. Hosts that only have a pairing connection show **needs SSH** until an SSH alias is added. Multiple aliases for a machine are combined using the SSH destination and the collector's machine/user identity.

## Use

Run **Usage: Open local & remote dashboard** from Orca's command palette, or **Mod+Alt+U**. **Usage: Scan local & remote hosts** starts a real scan.

- **重新加载统计** reads the latest collected snapshots.
- **扫描主机** checks logs on the selected host, or all hosts.
- Automatic scanning defaults to every minute; choose 30 seconds, five minutes, or off.
- Filter by host, client, project and UTC date range, including last month.
- Connection and provider errors retain the last successful data and its timestamp.

The page includes daily tokens, models, projects, active sessions and estimated costs where the pinned upstream pricing table recognizes a model. Pi/DSH costs remain unknown. Recent-session token values cover each entire session; the overview's token totals use the selected daily range. The scope is **all host agent logs**, including sessions launched outside Orca. These totals are not account quota or billing totals.

## Build and install

From this folder in the fork checkout:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

In **Orca Settings → Plugins → Install plugin → Local folder**, select this folder's `dist` directory and review the trusted worker before enabling it. Installation uses Orca's own installer, content hashes and consent checks. Neither a native app patch nor an Orca restart is required.

To verify an already installed plugin or open its dashboard through local runtime RPC:

```sh
node scripts/register.mjs
node scripts/register.mjs --open
```

The scanner is bundled without Electron dependencies; builds do not scan hosts or embed private data. Rebuilding the source does not modify the immutable installed copy. Reinstall `dist` after changing code.

## Lifecycle and transport

The native plugin worker is reclaimed by Orca after five idle minutes. It launches or reconnects to a monitor owned by a local Orca terminal so this reclamation does not stop monitoring. Close **Usage monitor** to stop the service; reopening the plugin starts it again. Disabling/uninstalling the launcher alone does not stop an already running monitor terminal. Automatic launch currently supports macOS/Linux; on Windows run `npm start` in a local Orca terminal.

Remote scanning sends the same bundled collector through SSH stdin and runs it with the existing SSH configuration, `BatchMode=yes` and finite deadlines. Remote Node 22+ is required; compressed DSH archives need `zstdcat`. No daemon or plugin is installed on the remote host, and existing SSH host-key verification remains enabled.

Each collector writes private incremental caches under its own `~/.cache/orca-host-usage`; the dashboard stores collected usage metadata and its service receipt in `~/.cache/orca-host-usage/dashboard`. These are separate from Orca's native usage files. Only session IDs, model/project metadata and token aggregates return from a remote scan; prompts, assistant text and raw logs remain on that host. The HTTP listener binds only to `127.0.0.1`; API calls need the generated bearer token. The dashboard URL carries that token in its fragment. Do not share the dashboard URL or service receipt.

Orca's current sandboxed sidebar panel forbids network requests and lacks a usage-data bridge. The extension's sidebar entry provides instructions; the live dashboard uses an embedded browser tab and does not weaken the sidebar sandbox.

The DSH collector also checks the existing Venus archive root `/mnt/intel_ssd/ikkipipi_data/dsh_sessions`. Other machines may add DSH archive roots in the local dashboard state file's `dshRoots` array before restarting the monitor.

## Provenance and checks

Codex/Claude/OpenCode scanners and process handling are bundled directly from this Orca fork's source. The narrow build resolver maps the scanners' worktree comparison import to Orca's existing `worktree-path-comparison.ts` implementation, avoiding the unrelated IPC module graph.

Pi/DSH source was copied from the user-customized Venus plugin at `/mnt/intel_ssd/orca-workspaces/orca/shad/src`, read before implementation. See [vendor/venus/PROVENANCE.md](vendor/venus/PROVENANCE.md). Native settings-page patches from Venus were inspected but are not installed by this extension.

Tests cover Codex cumulative-token duplicates and incremental rescans, omission of prompt contents, alias deduplication, UTC range/project/client filters, stale data on failed scans, API authentication and origin checks, and concurrent scan reuse. Live verification covered both this Mac and Venus and all five provider statuses. Hardware/account totals change continuously; verification results are a timestamped snapshot.
