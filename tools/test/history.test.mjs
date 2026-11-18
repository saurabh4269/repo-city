// Git history parsing and the hotspot score (docs/SPEC-city-life.md §3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseNumstat, renamedPath, hotspot } from '../repo-to-city/history.mjs'

const text = fs.readFileSync(new URL('../../fixtures/history/numstat.txt', import.meta.url), 'utf8')

test('numstat: commits and churn per file, binary files count commits only', () => {
  const h = parseNumstat(text)
  assert.deepEqual(h['lib/a.js'], { commits: 3, churn: 8 })
  assert.deepEqual(h['lib/b.js'], { commits: 1, churn: 10 })
  assert.deepEqual(h['img/logo.png'], { commits: 1, churn: 0 })
})
test('numstat: renames go to the new path', () => {
  const h = parseNumstat(text)
  assert.deepEqual(h['lib/new/c.js'], { commits: 1, churn: 4 })
  assert.deepEqual(h['docs/README.md'], { commits: 1, churn: 10 })
  assert.equal(renamedPath('a/{b => c}/d.js'), 'a/c/d.js')
  assert.equal(renamedPath('{x => }/y.js'), 'y.js')
})

const B = (commits, complexity) => ({ complexity, history: commits === null ? undefined : { commits, churn: 0, hot: 0 } })
test('hotspot: an empty history gives every file 0', () => {
  assert.deepEqual(hotspot([B(null, 5), B(null, 9)]), [0, 0])
  assert.deepEqual(hotspot([B(0, 5), B(0, 9)]), [0, 0])
  assert.deepEqual(hotspot([]), [])
})
test('hotspot: the top file is 1, and often-changed complex files beat the rest', () => {
  const h = hotspot([B(1, 1), B(9, 20), B(3, 4), B(9, 2), B(0, 50)])
  assert.equal(Math.max(...h), 1)
  assert.equal(h[1], 1)
  assert.ok(h[1] > h[3] && h[3] > h[0])
  assert.equal(h[4], 0) // never changed
  assert.ok(h.every((v) => v >= 0 && v <= 1))
})
test('hotspot: ties are stable (equal inputs, equal scores, independent of order)', () => {
  const a = hotspot([B(2, 3), B(2, 3), B(5, 1)])
  assert.equal(a[0], a[1])
  const b = hotspot([B(5, 1), B(2, 3), B(2, 3)])
  assert.deepEqual([b[1], b[2], b[0]], a)
})
