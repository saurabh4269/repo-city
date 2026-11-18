#!/usr/bin/env node
/**
 * Run a repo's real tap test files and save normalized results.
 *
 *   node tools/repo-to-city/run-tests.mjs --root fixtures/semver \
 *     [--fix tools/repo-to-city/semver-fix.json --variant fixed] \
 *     --out fixtures/semver-results/bugged.json
 *
 * Every test file under <root>/test (except test/fixtures) runs in its own node
 * process with `require('tap')` redirected to tap-shim/tap.cjs, a tiny
 * dependency-free implementation of the tap@16 API the files use. The test
 * files themselves are not modified.
 *
 * --variant fixed copies <root> to a temp dir, applies fix.json (after
 * checking the bugged line is there) and runs the copy, so the snapshot on
 * disk stays bugged.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRELOAD = path.join(HERE, 'tap-shim', 'preload.cjs')

export function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      out[k] = v
    }
  }
  return out
}

function listTests (root, testDir, excludeDirs) {
  const res = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      const rel = path.relative(root, p).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (!excludeDirs.includes(rel)) walk(p)
      } else if (/\.(c?js|mjs)$/.test(e.name)) res.push(rel)
    }
  }
  walk(path.join(root, testDir))
  return res.sort()
}

/** Apply fix.json ({file, line, before, after}) to a file; throws if the line does not match. */
export function applyFix (root, fix, direction = 'fix') {
  const file = path.join(root, fix.file)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const idx = fix.line - 1
  const [from, to] = direction === 'fix' ? [fix.before, fix.after] : [fix.after, fix.before]
  if (lines[idx].trim() !== from.trim()) {
    throw new Error(`${fix.file}:${fix.line} expected "${from.trim()}" but found "${lines[idx].trim()}"`)
  }
  const indent = lines[idx].match(/^\s*/)[0]
  lines[idx] = indent + to.trim()
  fs.writeFileSync(file, lines.join('\n'))
}

function runOne (root, rel, tmpDir) {
  return new Promise((resolve) => {
    const outFile = path.join(tmpDir, rel.replace(/[\\/]/g, '__') + '.json')
    const abs = path.join(root, rel)
    const child = spawn(process.execPath, ['--require', PRELOAD, abs], {
      cwd: root,
      env: { ...process.env, TAP_SHIM_OUT: outFile, TAP_SHIM_FILE: abs, TAP_SHIM_ROOT: root, NODE_DEBUG: '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d })
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000)
    child.on('close', (code) => {
      clearTimeout(timer)
      let r
      try {
        r = JSON.parse(fs.readFileSync(outFile, 'utf8'))
      } catch {
        r = {
          file: rel, passed: 0, failed: 1,
          failures: [{ testFile: rel, testName: '(file)', message: `test file crashed (exit ${code}): ${stderr.split('\n')[0] || ''}`.slice(0, 200), assertion: '', expected: '', actual: '' }],
        }
      }
      resolve(r)
    })
  })
}

async function pool (items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

export async function runTests ({ root, fix, variant = 'bugged', testDir = 'test', exclude = ['test/fixtures'], concurrency = Math.max(2, os.cpus().length - 1) }) {
  root = path.resolve(root)
  let runRoot = root
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-city-tests-'))
  try {
    if (variant === 'fixed') {
      if (!fix) throw new Error('--variant fixed needs --fix')
      runRoot = path.join(tmp, 'repo')
      fs.cpSync(root, runRoot, { recursive: true })
      applyFix(runRoot, fix, 'fix')
    } else if (fix) {
      // sanity: the snapshot on disk must be the bugged version
      const line = fs.readFileSync(path.join(root, fix.file), 'utf8').split('\n')[fix.line - 1]
      if (line.trim() !== fix.before.trim()) throw new Error(`${fix.file}:${fix.line} is not the bugged line: "${line.trim()}"`)
    }
    const resultsDir = path.join(tmp, 'results')
    fs.mkdirSync(resultsDir)
    const tests = listTests(runRoot, testDir, exclude)
    const t0 = performance.now()
    const per = await pool(tests, concurrency, (rel) => runOne(runRoot, rel, resultsDir))
    const durationMs = Math.round(performance.now() - t0)
    const files = {}
    const failures = []
    let passed = 0
    let failed = 0
    for (const r of per) {
      files[r.file] = { passed: r.passed, failed: r.failed }
      passed += r.passed
      failed += r.failed
      for (const f of r.failures) {
        failures.push({
          testFile: f.testFile,
          testName: f.testName,
          line: f.line || 0,
          assertion: f.assertion,
          expected: String(f.expected).slice(0, 400),
          actual: String(f.actual).slice(0, 400),
          message: f.message,
        })
      }
    }
    return {
      runner: `tap-shim (tap 16 API) on node ${process.versions.node}`,
      variant,
      total: passed + failed,
      passed,
      failed,
      durationMs,
      files,
      failures,
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.root || !args.out) {
    console.error('usage: run-tests.mjs --root <repo> --out <results.json> [--fix fix.json --variant bugged|fixed]')
    process.exit(2)
  }
  const fix = args.fix ? JSON.parse(fs.readFileSync(args.fix, 'utf8')) : null
  const res = await runTests({ root: args.root, fix, variant: args.variant || 'bugged' })
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
  fs.writeFileSync(args.out, JSON.stringify(res, null, 2) + '\n')
  console.log(`${args.variant || 'bugged'}: ${res.passed}/${res.total} passed, ${res.failed} failed in ${Object.keys(res.files).length} files (${res.durationMs} ms) -> ${args.out}`)
}
