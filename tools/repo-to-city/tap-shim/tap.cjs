'use strict'
/**
 * A small, dependency-free stand-in for the parts of `tap@16` that the
 * semver test suite uses (test/plan/end, equal/not/ok/notOk, same/strictSame,
 * match/notMatch, throws, resolveMatchSnapshot against tap-snapshots/).
 *
 * It runs the GENUINE test files unchanged: `preload.cjs` redirects
 * `require('tap')` here. Each test file runs in its own node process; results
 * are written as JSON to the file named by $TAP_SHIM_OUT when the process
 * is about to exit.
 */
const fs = require('fs')
const path = require('path')
const util = require('util')

const TEST_FILE = path.resolve(process.env.TAP_SHIM_FILE || process.argv[1])
const ROOT = path.resolve(process.env.TAP_SHIM_ROOT || process.cwd())
const REL_FILE = path.relative(ROOT, TEST_FILE).split(path.sep).join('/')
const TIMEOUT_MS = 30000

const results = { file: REL_FILE, passed: 0, failed: 0, failures: [], snapshots: 0 }

// ---------- assertion location ----------
let fileLines = null
const sourceLine = (n) => {
  if (!fileLines) {
    try { fileLines = fs.readFileSync(TEST_FILE, 'utf8').split('\n') } catch { fileLines = [] }
  }
  return (fileLines[n - 1] || '').trim()
}
const findLine = (stack) => {
  for (const l of String(stack || '').split('\n')) {
    const i = l.indexOf(TEST_FILE + ':')
    if (i >= 0) {
      const m = /:(\d+):(\d+)\)?\s*$/.exec(l.slice(i + TEST_FILE.length))
      if (m) return Number(m[1])
    }
  }
  return 0
}

// ---------- comparison helpers ----------
const fmt = (v) => util.inspect(v, { depth: 4, breakLength: Infinity, maxStringLength: 4000 })

const isObj = (v) => v !== null && typeof v === 'object'

function deepEq (a, b, strict, seen = new Map()) {
  if (strict ? Object.is(a, b) || a === b : a == b) return true // eslint-disable-line eqeqeq
  if (!isObj(a) || !isObj(b)) {
    if (!strict && typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true
    return false
  }
  if (seen.get(a) === b) return true
  seen.set(a, b)
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b)
  if (a instanceof Date || b instanceof Date) return +a === +b
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [k, v] of a) if (!b.has(k) || !deepEq(v, b.get(k), strict, seen)) return false
    return true
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEq(a[k], b[k], strict, seen)) return false
  }
  return true
}

/** tmatch-style loose pattern match (what tap's t.match does). */
function tmatch (obj, pattern, seen = new Map()) {
  if (obj === pattern) return true
  if (pattern === null || pattern === undefined) return obj == pattern // eslint-disable-line eqeqeq
  if (pattern instanceof RegExp) {
    if (obj instanceof RegExp) return String(obj) === String(pattern)
    return pattern.test(String(obj))
  }
  if (typeof pattern === 'function') {
    if (pattern === String) return typeof obj === 'string' || obj instanceof String
    if (pattern === Number) return (typeof obj === 'number' && !isNaN(obj)) || obj instanceof Number
    if (pattern === Boolean) return typeof obj === 'boolean' || obj instanceof Boolean
    if (pattern === Symbol) return typeof obj === 'symbol'
    if (pattern === Function) return typeof obj === 'function'
    if (pattern === Object) return isObj(obj)
    if (pattern === Array) return Array.isArray(obj)
    if (typeof obj === 'function' && obj === pattern) return true
    return obj instanceof pattern
  }
  if (typeof pattern === 'string') {
    return typeof obj === 'string' ? obj.includes(pattern) || obj === pattern : String(obj) === pattern
  }
  if (typeof pattern !== 'object') return obj == pattern // eslint-disable-line eqeqeq
  if (!isObj(obj) && typeof obj !== 'function') return false
  if (seen.get(obj) === pattern) return true
  seen.set(obj, pattern)
  if (pattern instanceof Error) {
    return tmatch(obj.message, pattern.message, seen) && (!pattern.name || obj.name === pattern.name)
  }
  for (const k of Object.keys(pattern)) {
    if (!tmatch(obj[k], pattern[k], seen)) return false
  }
  return true
}

// ---------- snapshot (tap-snapshots/<file>.test.cjs) ----------
let snapshotStore
const loadSnapshots = () => {
  if (snapshotStore === undefined) {
    const f = path.join(ROOT, 'tap-snapshots', REL_FILE + '.test.cjs')
    try { snapshotStore = require(f) } catch { snapshotStore = null }
  }
  return snapshotStore
}
/** Minimal tcompare-style format: objects with sorted keys, multi-line strings as String(...). */
function snapFormat (v, indent = '') {
  const pad = indent + '  '
  if (typeof v === 'string') {
    const body = v.endsWith('\n') ? v.slice(0, -1) : v
    if (!body.includes('\n')) return JSON.stringify(v)
    return 'String(\n' + v.split('\n').map(l => pad + l).join('\n') + '\n' + indent + ')'
  }
  if (v === null || typeof v !== 'object') return String(v)
  if (Array.isArray(v)) {
    return 'Array [\n' + v.map(x => pad + snapFormat(x, pad) + ',\n').join('') + indent + ']'
  }
  const keys = Object.keys(v).sort()
  return 'Object {\n' + keys.map(k => pad + JSON.stringify(k) + ': ' + snapFormat(v[k], pad) + ',\n').join('') + indent + '}'
}

// ---------- Test ----------
class Test {
  constructor (name, fn, parent) {
    this.name = name
    this.fn = fn
    this.parent = parent
    this.queue = []
    this.count = 0 // assertions + subtests, for plan()
    this.planned = null
    this.ended = false
    this.snapCounters = new Map()
    this.cleanSnapshot = parent ? parent.cleanSnapshot : (s) => s
    this._wake = null
  }

  get fullName () {
    const parts = []
    for (let t = this; t && t.parent; t = t.parent) parts.unshift(t.name)
    return parts.join(' > ')
  }

  poke () { if (this._wake) { const w = this._wake; this._wake = null; w() } }

  // ---- results ----
  _assert (ok, message, extra = {}, stackFrom) {
    this.count++
    if (ok) {
      results.passed++
    } else {
      results.failed++
      const stack = stackFrom || new Error().stack
      const line = findLine(stack)
      results.failures.push({
        testFile: REL_FILE,
        testName: this.fullName || REL_FILE,
        message: String(message || extra.defaultMessage || 'assertion failed'),
        line,
        assertion: line ? sourceLine(line) : '',
        expected: 'expected' in extra ? fmt(extra.expected) : '',
        actual: 'actual' in extra ? fmt(extra.actual) : '',
        operator: extra.operator || '',
      })
    }
    if (this.planned !== null && this.count >= this.planned) this.poke()
    return ok
  }

  pass (m) { return this._assert(true, m) }
  fail (m, extra) { return this._assert(false, m, { operator: 'fail', ...(extra || {}) }) }
  ok (v, m) { return this._assert(!!v, m || 'expect truthy value', { expected: true, actual: v, operator: 'ok' }) }
  notOk (v, m) { return this._assert(!v, m || 'expect falsey value', { expected: false, actual: v, operator: 'notOk' }) }
  equal (a, b, m) { return this._assert(a === b, m || 'should be equal', { expected: b, actual: a, operator: 'equal' }) }
  not (a, b, m) { return this._assert(a !== b, m || 'should not be equal', { expected: b, actual: a, operator: 'not' }) }
  same (a, b, m) { return this._assert(deepEq(a, b, false), m || 'should be equivalent', { expected: b, actual: a, operator: 'same' }) }
  strictSame (a, b, m) { return this._assert(deepEq(a, b, true), m || 'should be equivalent strictly', { expected: b, actual: a, operator: 'strictSame' }) }
  match (a, p, m) { return this._assert(tmatch(a, p), m || 'should match pattern provided', { expected: p, actual: a, operator: 'match' }) }
  notMatch (a, p, m) { return this._assert(!tmatch(a, p), m || 'should not match pattern provided', { expected: p, actual: a, operator: 'notMatch' }) }
  comment () {}
  teardown (fn) { process.on('beforeExit', fn) }

  throws (fn, wanted, m) {
    if (typeof wanted === 'string') { m = wanted; wanted = undefined }
    // tap ignores an expectation that is not an object, class or regexp
    if (wanted !== undefined && (wanted === null || (typeof wanted !== 'object' && typeof wanted !== 'function'))) wanted = undefined
    try {
      fn()
    } catch (er) {
      if (wanted === undefined) return this._assert(true, m)
      let ok
      if (typeof wanted === 'function' && wanted.prototype instanceof Error || wanted === Error) ok = er instanceof wanted
      else ok = tmatch(er, wanted)
      return this._assert(ok, m || 'expected to throw a matching error', { expected: wanted, actual: er, operator: 'throws' })
    }
    return this._assert(false, m || 'expected to throw', { expected: wanted || 'an error', actual: 'no error', operator: 'throws' })
  }

  async resolveMatchSnapshot (promise, m) {
    const stack = new Error().stack
    const value = await promise
    const key = `${REL_FILE} TAP ${this.fullName} > ${m} `
    const n = (this.snapCounters.get(key) || 0) + 1
    this.snapCounters.set(key, n)
    const store = loadSnapshots()
    const want = store && store[key + n]
    const got = '\n' + this.cleanSnapshot(snapFormat(value)) + '\n'
    results.snapshots++
    return this._assert(want !== undefined && want === got, m || 'must match snapshot',
      { expected: want === undefined ? '(no snapshot)' : want, actual: got, operator: 'matchSnapshot' }, stack)
  }

  plan (n) { this.planned = n; if (this.count >= n) this.poke() }
  end () { this.ended = true; this.poke() }

  test (name, opts, fn) {
    if (typeof opts === 'function') { fn = opts; opts = {} }
    if (typeof name === 'function') { fn = name; name = fn.name || '(unnamed test)' }
    const child = new Test(name, fn, this)
    let resolve
    child.done = new Promise(r => { resolve = r })
    child.resolveDone = resolve
    this.queue.push(child)
    this.poke()
    if (this === root) scheduleRoot()
    return child.done
  }

  _finished () {
    return this.ended || (this.planned !== null && this.count >= this.planned) || this.promiseDone
  }

  async run () {
    let ret
    try {
      ret = this.fn(this)
    } catch (er) {
      this._assert(false, 'test threw: ' + (er && er.message), { actual: er, operator: 'error' }, er && er.stack)
      this.ended = true
    }
    if (ret && typeof ret.then === 'function') {
      ret.then(() => { this.promiseDone = true; this.poke() }, (er) => {
        this._assert(false, 'test promise rejected: ' + (er && er.message), { actual: er, operator: 'error' }, er && er.stack)
        this.promiseDone = true
        this.poke()
      })
    }
    await this.drain()
    if (this.planned !== null && this.count !== this.planned) {
      this._assert(false, `test count(${this.count}) != plan(${this.planned})`, { expected: this.planned, actual: this.count, operator: 'plan' })
    }
    if (this.parent) this.parent.count++
    this.resolveDone()
  }

  async drain () {
    const started = Date.now()
    while (true) {
      while (this.queue.length) await this.queue.shift().run()
      if (this._finished() && !this.queue.length) return
      const timedOut = await new Promise(resolve => {
        this._wake = () => { clearTimeout(timer); resolve(false) }
        const timer = setTimeout(() => resolve(true), Math.max(1, TIMEOUT_MS - (Date.now() - started)))
      })
      if (timedOut) {
        this._wake = null
        this._assert(false, 'timeout: test did not end', { operator: 'timeout' })
        return
      }
    }
  }
}

const root = new Test('', null, null)
let rootScheduled = false
let rootRunning = Promise.resolve()
function scheduleRoot () {
  if (rootScheduled) return
  rootScheduled = true
  setImmediate(() => {
    rootRunning = (async () => {
      while (root.queue.length) await root.queue.shift().run()
      rootScheduled = false
    })()
  })
}

let written = false
const write = () => {
  if (written) return
  written = true
  if (process.env.TAP_SHIM_OUT) fs.writeFileSync(process.env.TAP_SHIM_OUT, JSON.stringify(results))
  else process.stdout.write(JSON.stringify(results) + '\n')
}
process.on('beforeExit', () => {
  if (root.queue.length || rootScheduled) return
  write()
})
process.on('uncaughtException', (er) => {
  root._assert(false, 'uncaught exception: ' + (er && er.message), { actual: er, operator: 'error' }, er && er.stack)
  write()
  process.exit(1)
})

root.Test = Test
root.test = root.test.bind(root)
module.exports = root
