import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSource, excerpt, bugExcerpt } from '../repo-to-city/parser.mjs'

const SRC = `'use strict'
const dep = require('./dep')
import other from '../other.js'

/** top-level arrow */
const pick = (a, b) => {
  if (a && b) {
    return a ?? b
  }
  return a > b ? a : b
}

function loop (xs) {
  for (const x of xs) {
    try { x() } catch (e) { continue }
  }
  while (false) {}
}

class Thing {
  constructor (n) {
    this.n = n || 0
  }

  get size () { return this.n }

  grow (k) {
    switch (k) {
      case 1: return 1
      case 2: return 2
      default: return 0
    }
  }
}

module.exports = { pick, loop, Thing, cb: [1].map((x) => x + 1) }
`

const r = parseSource(SRC, 'sample.js')
const byName = Object.fromEntries(r.functions.map((f) => [f.name, f]))

test('finds named functions, class methods and arrows assigned to const', () => {
  assert.deepEqual(r.functions.map((f) => f.name),
    ['pick', 'loop', 'Thing.constructor', 'Thing.get size', 'Thing.grow'])
})

test('spans are 1-based and cover the declaration', () => {
  assert.deepEqual([byName.pick.startLine, byName.pick.endLine], [6, 11])
  assert.deepEqual([byName.loop.startLine, byName.loop.endLine], [13, 18])
  assert.deepEqual([byName['Thing.grow'].startLine, byName['Thing.grow'].endLine], [27, 33])
  assert.equal(byName.pick.lines, 6)
})

test('cyclomatic proxy counts if/for/while/case/catch/&&/||/??/?:', () => {
  assert.equal(byName.pick.complexity, 1 + 1 /* if */ + 1 /* && */ + 1 /* ?? */ + 1 /* ?: */)
  assert.equal(byName.loop.complexity, 1 + 1 /* for */ + 1 /* catch */ + 1 /* while */)
  assert.equal(byName['Thing.constructor'].complexity, 2) // ||
  assert.equal(byName['Thing.grow'].complexity, 3) // two cases (default is not a branch)
  assert.equal(byName['Thing.get size'].complexity, 1)
})

test('collects require() and import specifiers', () => {
  assert.deepEqual(r.imports.sort(), ['../other.js', './dep'])
})

test('TypeScript: methods, typed arrows and type-only imports', () => {
  const ts = parseSource(`import type { A } from './a.js'
export const f = (x: number): number => (x > 1 ? x : 1)
export class K { private m(): void { if (this) return } }
`, 'k.ts')
  assert.deepEqual(ts.functions.map((f) => [f.name, f.complexity]), [['f', 2], ['K.m', 2]])
  assert.deepEqual(ts.imports, ['./a.js'])
})

test('a file without functions has module complexity and no floors', () => {
  const m = parseSource(`module.exports = { a: require('./a'), b: 1 }\n`, 'm.js')
  assert.equal(m.functions.length, 0)
  assert.equal(m.complexity, 1)
})

test('excerpt: ≤16 lines, ≤60 chars, dedented', () => {
  const long = Array.from({ length: 30 }, (_, i) => `    line ${i} ${'x'.repeat(i * 4)}`).join('\n')
  const e = excerpt(long, 1, 30).split('\n')
  assert.equal(e.length, 16)
  assert.ok(e.every((l) => [...l].length <= 60))
  assert.ok(e[0].startsWith('line 0'))
  assert.ok(e[15].endsWith('…'))
})

test('bugExcerpt: window contains the bug line, codeStart only when shifted', () => {
  const text = Array.from({ length: 60 }, (_, i) => `  line ${i + 1}`).join('\n')
  const near = bugExcerpt(text, 10, 50, 14)
  assert.equal(near.codeStart, undefined)
  assert.ok(near.code.split('\n')[4] === 'line 14')
  const far = bugExcerpt(text, 10, 50, 40)
  assert.equal(far.codeStart, 35)
  const lines = far.code.split('\n')
  assert.ok(lines.length <= 16)
  assert.equal(lines[40 - far.codeStart], 'line 40')
  const end = bugExcerpt(text, 10, 50, 50)
  assert.equal(end.code.split('\n').length, 16)
  assert.equal(end.code.split('\n').at(-1), 'line 50')
})
