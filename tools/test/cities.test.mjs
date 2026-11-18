import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCity } from './validate-city.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))
const semver = load('public/cities/semver.json')
const fix = load('tools/repo-to-city/semver-fix.json')
const fixed = load('fixtures/semver-results/fixed.json')
const bugged = load('fixtures/semver-results/bugged.json')

test('semver.json matches the CityData contract', () => {
  assert.deepEqual(validateCity(semver), [])
  assert.ok(fs.statSync(path.join(ROOT, 'public/cities/semver.json')).size < 300 * 1024, 'under 300 KB')
})

test('semver: exactly one failing floor, the one holding the fix line', () => {
  const failing = semver.buildings.flatMap((b) => b.functions.filter((f) => f.failing).map((f) => [b.id, f]))
  assert.equal(failing.length, 1)
  const [bid, fn] = failing[0]
  assert.equal(bid, fix.file)
  assert.ok(fn.startLine <= fix.line && fix.line <= fn.endLine)
  assert.equal(semver.fix.building, bid)
  assert.equal(semver.fix.fn, fn.name)
  assert.equal(semver.fix.line, fix.line)
  assert.equal(fn.bugLine, fix.line)
  const b = semver.buildings.find((x) => x.id === bid)
  assert.ok(b.functions.length >= 4, 'the burning building has several floors')
  // the excerpt shows the bug line
  const codeLines = fn.code.split('\n')
  const at = codeLines[fn.bugLine - (fn.codeStart ?? fn.startLine)]
  assert.equal(at.trim(), fix.before.trim().slice(0, 59).length < fix.before.trim().length ? at.trim() : fix.before.trim())
})

test('semver: failures are real, few, in one test file and point at the burning building', () => {
  assert.ok(semver.run.failed >= 2 && semver.run.failed <= 10, `failed=${semver.run.failed}`)
  assert.equal(semver.run.failed, bugged.failed)
  assert.equal(semver.run.total, bugged.total)
  assert.equal(new Set(semver.run.failures.map((f) => f.testFile)).size, 1)
  for (const f of semver.run.failures) {
    assert.equal(f.building, semver.fix.building)
    assert.equal(f.fn, semver.fix.fn)
    assert.ok(f.assertion.length > 0, 'assertion line captured')
  }
  const b = semver.buildings.find((x) => x.id === semver.fix.building)
  assert.equal(b.tests.failed, semver.run.failed)
})

test('semver: the fixed run is green and has the same number of assertions', () => {
  assert.ok(semver.fix, 'fix present')
  assert.equal(semver.fix.run.failed, 0)
  assert.equal(fixed.failed, 0)
  assert.equal(semver.fix.run.total, semver.run.total)
  assert.equal(semver.stats.tests, semver.run.total)
  assert.equal(semver.stats.failing, semver.run.failed)
})

test('semver: all source folders are in the city', () => {
  const ds = new Set(semver.districts.map((d) => d.id))
  for (const d of ['classes', 'functions', 'ranges', 'internal']) assert.ok(ds.has(d), d)
  assert.ok(semver.buildings.length <= 70)
  assert.ok(semver.buildings.length >= 40)
})

test('streets reference existing buildings and match building imports', () => {
  for (const city of [semver, ...(fs.existsSync(path.join(ROOT, 'public/cities/repo-city.json')) ? [load('public/cities/repo-city.json')] : [])]) {
    const ids = new Set(city.buildings.map((b) => b.id))
    const fromImports = new Set(city.buildings.flatMap((b) => b.imports.map((i) => `${b.id}>${i}`)))
    for (const s of city.streets) {
      assert.ok(ids.has(s.from) && ids.has(s.to), `${city.id}: ${s.from} -> ${s.to}`)
      assert.notEqual(s.from, s.to)
      assert.ok(fromImports.has(`${s.from}>${s.to}`))
    }
    assert.equal(city.streets.length, fromImports.size)
  }
  assert.ok(semver.streets.length > 40)
})

test('repo-city.json (if built) matches the contract and has nothing on fire', () => {
  const p = path.join(ROOT, 'public/cities/repo-city.json')
  if (!fs.existsSync(p)) return
  const c = load('public/cities/repo-city.json')
  assert.deepEqual(validateCity(c), [])
  assert.equal(c.fix, undefined)
  assert.equal(c.run.failed, 0)
  assert.ok(c.buildings.every((b) => b.functions.every((f) => !f.failing)))
})
