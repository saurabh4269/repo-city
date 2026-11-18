#!/usr/bin/env node
/**
 * Your own repository as a city, in one command:
 *
 *   npm run city:repo -- /path/to/your/repo [--include src] [--name "My app"]
 *
 * 1. finds the source folder (src/, lib/, else the repo root) and the tests
 *    (test/, tests/, *.test.*, *.spec.*);
 * 2. runs those tests with Node's built-in test runner (node:test, which also
 *    runs .ts on Node 22.18+), here, on this machine;
 * 3. reads each failure's real stack: the first frame inside your source is the
 *    burning building and its floor (function);
 * 4. adds git history (scaffolding) and bakes the light, and writes
 *    public/cities/<id>.json. Open https://localhost:8083/?city=./cities/<id>.json
 *
 * Nothing is uploaded: the city JSON stays in this project's public/ folder.
 * Test suites for other runners (jest, vitest, mocha, tap): run them yourself and
 * pass `--tests results.json` (format: tools/repo-to-city/run-tests.mjs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { run } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './run-tests.mjs'
import { buildCity } from './index.mjs'
import { writeLight } from './light-bake.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(HERE, '..', '..')
const TEST_RX = /(^|\/)(test|tests|__tests__)\/.*\.(c?js|mjs|ts|mts)$|\.(test|spec)\.(c?js|mjs|ts|mts)$/
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor'])

function walk (root, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(root, r, out)
    else out.push(r)
  }
  return out
}

/** Run the repo's tests with node:test; failures keep their stack, with paths relative to the repo. */
export async function runNodeTests (root, testFiles) {
  const abs = path.resolve(root)
  const real = fs.realpathSync(abs) // /var → /private/var on macOS: stacks use the real path
  const rel = (v) => String(v ?? '').replace(/file:\/\//g, '').split(real + path.sep).join('').split(abs + path.sep).join('')
  const res = { runner: `node:test (node ${process.versions.node})`, total: 0, passed: 0, failed: 0, durationMs: 0, files: {}, failures: [] }
  if (!testFiles.length) return res
  const t0 = performance.now()
  const cwd = process.cwd()
  process.chdir(abs) // tests often read fixtures relative to the repo
  // run() refuses to start inside another test run (NODE_TEST_CONTEXT): this is a separate suite, not a subtest
  const ctx = process.env.NODE_TEST_CONTEXT
  delete process.env.NODE_TEST_CONTEXT
  try {
    await new Promise((resolve) => {
      const stream = run({ files: testFiles.map((f) => path.join(abs, f)), concurrency: true, timeout: 60000 })
      const file = (d) => rel(d.file || '')
      const count = (d, ok) => {
        const f = (res.files[file(d)] ||= { passed: 0, failed: 0 })
        res.total++
        if (ok) { res.passed++; f.passed++ } else { res.failed++; f.failed++ }
      }
      stream.on('test:pass', (d) => { if (d.details?.type !== 'suite') count(d, true) })
      stream.on('test:fail', (d) => {
        if (d.details?.type === 'suite') return
        count(d, false)
        const err = d.details?.error
        const cause = err?.cause ?? err
        const stack = rel(cause?.stack || err?.stack || '')
        const isAssert = cause?.code === 'ERR_ASSERTION'
        res.failures.push({
          testFile: file(d),
          testName: d.name,
          line: d.line || 0,
          assertion: isAssert ? String(cause.operator || 'assert') : '',
          expected: isAssert ? fmt(cause.expected) : '',
          actual: isAssert ? fmt(cause.actual) : stack.slice(0, 600),
          message: rel(String(cause?.message || err?.message || 'failed')).split('\n')[0].slice(0, 200),
          stack: stack.slice(0, 1200),
        })
      })
      stream.on('end', resolve)
      stream.on('data', () => {})
    })
  } finally {
    process.chdir(cwd)
    if (ctx !== undefined) process.env.NODE_TEST_CONTEXT = ctx
  }
  res.durationMs = Math.round(performance.now() - t0)
  return res
}
const fmt = (v) => {
  try { return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const root = args._?.[0] || args.root
  if (!root || !fs.existsSync(root)) {
    console.error('usage: npm run city:repo -- /path/to/repo [--include src,lib] [--name "My app"] [--tests results.json]')
    process.exit(2)
  }
  const files = walk(path.resolve(root))
  const include = args.include || ['src', 'lib'].find((d) => files.some((f) => f.startsWith(d + '/'))) || '.'
  const id = String(args.id || path.basename(path.resolve(root))).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  let resultsFile = args.tests
  if (!resultsFile) {
    const tests = files.filter((f) => TEST_RX.test(f))
    console.log(`${id}: running ${tests.length} test files with node:test…`)
    const res = await runNodeTests(root, tests)
    console.log(`${id}: ${res.passed}/${res.total} passed, ${res.failed} failed (${res.durationMs} ms)`)
    resultsFile = path.join(PROJECT, 'artifacts', `${id}-tests.json`)
    fs.mkdirSync(path.dirname(resultsFile), { recursive: true })
    fs.writeFileSync(resultsFile, JSON.stringify(res, null, 2) + '\n')
  }
  const out = path.join(PROJECT, 'public', 'cities', `${id}.json`)
  const city = buildCity({ root, id, name: args.name || id, include, exclude: 'test,tests,__tests__', base: include === '.' ? '' : include, tests: resultsFile, history: 'git', layout: 'affinity' })
  city.light = writeLight(city, out)
  fs.writeFileSync(out, JSON.stringify(city) + '\n')
  const fire = city.run.failures[0]
  console.log(`${id}: ${city.buildings.length} buildings, ${city.run.failed} failing${fire ? ` (fire: ${fire.building}, floor ${fire.fn})` : ''} -> ${path.relative(PROJECT, out)}`)
  console.log(`open https://localhost:8083/?city=./cities/${id}.json`)
}
