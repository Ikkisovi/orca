import { build } from 'esbuild'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(root, 'dist')
await mkdir(dist, { recursive: true })
await build({
  absWorkingDir: root, entryPoints: ['src/collector.ts'], outfile: 'dist/collector.cjs',
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  plugins: [{ name: 'narrow-worktree-import', setup(api) {
    api.onResolve({ filter: /ipc\/worktree-logic$/ }, () => ({ path: resolve(root, '../../src/main/ipc/worktree-path-comparison.ts') }))
  } }]
})
await build({ absWorkingDir: root, entryPoints: ['src/process.ts'], outfile: 'dist/process.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm' })
for (const name of ['server.mjs', 'hosts.mjs', 'rollup.mjs', 'main.mjs', 'standalone.mjs', 'dashboard.html', 'dashboard.js', 'dashboard.css', 'panel.html']) {
  await cp(resolve(root, 'src', name), resolve(dist, name))
}
await cp(resolve(root, 'orca-plugin.json'), resolve(dist, 'orca-plugin.json'))
await cp(resolve(root, '../../LICENSE'), resolve(dist, 'LICENSE'))
// Reuse the canonical tokens and font instead of maintaining a second palette.
const css = await readFile(resolve(root, '../../src/renderer/src/assets/main.css'), 'utf8')
const names = ['background', 'foreground', 'card', 'card-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'border', 'input', 'ring', 'destructive', 'radius', 'font-mono']
const tokens = block => names.map(name => block.match(new RegExp(`--${name}:([^;]+);`))).filter(Boolean).map(match => match[0]).join('\n')
const light = css.slice(css.indexOf(':root {'))
const dark = css.slice(css.indexOf('\n.dark {'))
await writeFile(resolve(dist, 'tokens.css'), `:root {${tokens(light)}}\n@media(prefers-color-scheme:dark){:root{${tokens(dark)}}}\n@font-face{font-family:Geist;src:url('/font.woff2')}\n`)
await cp(resolve(root, '../../src/renderer/src/assets/fonts/Geist-Variable.woff2'), resolve(dist, 'font.woff2'))
console.log('Built host-usage extension; build does not scan or embed private data.')
