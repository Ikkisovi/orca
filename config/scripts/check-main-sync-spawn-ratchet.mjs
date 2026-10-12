import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript-api'
import { literalString, propertyName, unwrap } from './static-module-specifiers.mjs'
import { isTestOnlySourcePath } from './test-only-source-path.mjs'

// Ratchet for synchronous child-process launches in Electron main and shared code: each one
// freezes every window until the child exits, and on Windows antivirus makes every launch slow.

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const BASELINE_PATH = 'config/main-sync-spawn-baseline.txt'
const SCAN_DIRECTORIES = ['src/main', 'src/shared']
const SECURE_WRITERS = new Set([
  'writeSecureFile',
  'writeSecureJsonFile',
  'writeDurableSecureJsonFile',
  'writeSecureJsonFileWithinLimit'
])
const CHILD_PROCESS_SYMBOLS = new Set(['execFileSync', 'spawnSync', 'execSync'])
const PROCESS_HOST_SYMBOLS = new Set(['runProcessSync'])
// Repo-relative modules (no extension) that export the synchronous secure writers.
const SECURE_WRITER_MODULES = new Set([
  'src/shared/secure-file',
  'src/shared/bounded-secure-json-file'
])

function normalized(file) {
  return file.replaceAll('\\', '/')
}

/** Gated symbols a module specifier exports, or null when the module is not gated. */
export function gatedSymbolsFor(file, specifier) {
  const normalizedSpecifier = normalized(specifier)
  if (normalizedSpecifier === 'child_process' || normalizedSpecifier === 'node:child_process') {
    return CHILD_PROCESS_SYMBOLS
  }
  if (normalizedSpecifier === '@orca/process-host') {
    return PROCESS_HOST_SYMBOLS
  }
  if (!normalizedSpecifier.startsWith('.')) {
    return null
  }
  const target = path.posix
    .normalize(path.posix.join(path.posix.dirname(file), normalizedSpecifier))
    .replace(/\.[cm]?[jt]sx?$/, '')
  return SECURE_WRITER_MODULES.has(target) ? SECURE_WRITERS : null
}

/**
 * Gated synchronous-launch symbols a file reaches: named imports (aliased too), re-exports, and
 * member reads or destructures of a namespace, default import, `require(...)` or `import(...)`.
 * Bindings are file-wide, not scope-aware; computed specifiers and member names are not resolved.
 */
export function collectSyncLaunchUses(file, contents) {
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, false)
  if (source.parseDiagnostics.length > 0) {
    throw new Error(`Cannot parse ${file}; the sync-spawn ratchet must not skip it.`)
  }
  const used = new Set()
  const namespaces = new Map()
  const aliases = []
  const members = []
  const destructures = []

  function moduleSymbols(node) {
    node = unwrap(node)
    if (!node) {
      return null
    }
    if (ts.isIdentifier(node)) {
      return namespaces.get(node.text) ?? null
    }
    const loads =
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    const specifier = loads ? literalString(node.arguments[0]) : null
    return specifier === null ? null : gatedSymbolsFor(file, specifier)
  }
  function recordUse(symbols, name) {
    if (symbols?.has(name)) {
      used.add(name)
    }
  }
  function visitImport(node) {
    const symbols = gatedSymbolsFor(file, node.moduleSpecifier.text)
    const clause = node.importClause
    if (!symbols || !clause || clause.isTypeOnly) {
      return
    }
    if (clause.name) {
      namespaces.set(clause.name.text, symbols)
    }
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) {
      namespaces.set(named.name.text, symbols)
    }
    for (const element of named && ts.isNamedImports(named) ? named.elements : []) {
      if (!element.isTypeOnly) {
        recordUse(symbols, (element.propertyName ?? element.name).text)
      }
    }
  }
  function visitExport(node) {
    const symbols =
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly
        ? gatedSymbolsFor(file, node.moduleSpecifier.text)
        : null
    if (!symbols) {
      return
    }
    if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
      symbols.forEach((symbol) => used.add(symbol))
      return
    }
    for (const element of node.exportClause.elements) {
      if (!element.isTypeOnly) {
        recordUse(symbols, (element.propertyName ?? element.name).text)
      }
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      visitImport(node)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const symbols = gatedSymbolsFor(file, node.moduleReference.expression.text)
      if (symbols) {
        namespaces.set(node.name.text, symbols)
      }
    } else if (ts.isExportDeclaration(node)) {
      visitExport(node)
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      members.push(node)
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        aliases.push({ name: node.name.text, initializer: node.initializer })
      } else if (ts.isObjectBindingPattern(node.name)) {
        destructures.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  // Aliases can chain (`const cp = require('child_process'); const run = cp`).
  for (let changed = true; changed;) {
    changed = false
    for (const { name, initializer } of aliases) {
      const symbols = moduleSymbols(initializer)
      if (symbols && !namespaces.has(name)) {
        namespaces.set(name, symbols)
        changed = true
      }
    }
  }
  for (const node of members) {
    recordUse(moduleSymbols(node.expression), propertyName(node))
  }
  for (const node of destructures) {
    const symbols = moduleSymbols(node.initializer)
    for (const element of symbols ? node.name.elements : []) {
      const key = element.propertyName ?? element.name
      recordUse(symbols, ts.isIdentifier(key) ? key.text : literalString(key))
    }
  }
  return [...used].sort()
}

export function isRatchetedSourcePath(file) {
  return (
    SCAN_DIRECTORIES.some((directory) => file.startsWith(`${directory}/`)) &&
    !file.endsWith('.d.ts') &&
    !isTestOnlySourcePath(file)
  )
}

/** Files using gated symbols, the ones the baseline does not cover, and stale baseline entries. */
export function assessSyncSpawnUses(sources, baseline) {
  const users = new Map()
  for (const [file, contents] of sources) {
    if (!isRatchetedSourcePath(file)) {
      continue
    }
    const symbols = collectSyncLaunchUses(file, contents)
    if (symbols.length > 0) {
      users.set(file, symbols)
    }
  }
  const baselineSet = new Set(baseline)
  const current = [...users.keys()].sort()
  return {
    users: current,
    added: current
      .filter((file) => !baselineSet.has(file))
      .map((file) => ({ file, symbols: users.get(file) })),
    stale: baseline.filter((file) => !users.has(file)).sort()
  }
}

export function readSyncSpawnBaseline(contents) {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export function collectSyncSpawnSources(root = ROOT) {
  return new Map(
    globSync(
      SCAN_DIRECTORIES.map((directory) => `${directory}/**/*.{ts,tsx,mts,cts,js,mjs,cjs}`),
      { cwd: root, exclude: ['**/node_modules/**'] }
    )
      .map(normalized)
      .filter(isRatchetedSourcePath)
      .sort()
      .map((file) => [file, readFileSync(path.join(root, file), 'utf8')])
  )
}

export function main(root = ROOT) {
  const baseline = readSyncSpawnBaseline(readFileSync(path.join(root, BASELINE_PATH), 'utf8'))
  const result = assessSyncSpawnUses(collectSyncSpawnSources(root), baseline)
  const failures = [
    ...result.added.map(
      ({ file, symbols }) =>
        `${file}: new synchronous launch (${symbols.join(', ')}) blocks the main thread; use an async API`
    ),
    ...result.stale.map((file) => `${file}: remove stale ${BASELINE_PATH} entry`)
  ]
  if (failures.length > 0) {
    console.error(`[main-sync-spawn-ratchet]\n${failures.join('\n')}`)
    return 1
  }
  console.log(`[main-sync-spawn-ratchet] ok; ${result.users.length} legacy sync launchers remain`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
