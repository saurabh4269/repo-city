// Entry-point resolution (the town hall): one case per branch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEntry } from '../repo-to-city/entry.mjs'

const ids = ['index.js', 'lib/main.js', 'lib/esm.mjs', 'lib/cjs.cjs', 'lib/def.js', 'src/index.ts']
test('exports["."] as a string', () => assert.equal(resolveEntry({ exports: { '.': './lib/main.js' }, main: 'index.js' }, ids), 'lib/main.js'))
test('exports as a bare string', () => assert.equal(resolveEntry({ exports: './lib/main.js' }, ids), 'lib/main.js'))
test('exports["."].import, then .require, then .default', () => {
  assert.equal(resolveEntry({ exports: { '.': { import: './lib/esm.mjs', require: './lib/cjs.cjs' } } }, ids), 'lib/esm.mjs')
  assert.equal(resolveEntry({ exports: { '.': { require: './lib/cjs.cjs', default: './lib/def.js' } } }, ids), 'lib/cjs.cjs')
  assert.equal(resolveEntry({ exports: { '.': { default: './lib/def.js' } } }, ids), 'lib/def.js')
})
test('main when exports is missing or points outside the city', () => {
  assert.equal(resolveEntry({ main: 'lib/main.js' }, ids), 'lib/main.js')
  assert.equal(resolveEntry({ exports: './dist/x.js', main: './index.js' }, ids), 'index.js')
})
test('index.* at the root of the included folder', () => {
  assert.equal(resolveEntry(null, ids, 'src'), 'src/index.ts')
  assert.equal(resolveEntry({}, ['a.js', 'index.mjs']), 'index.mjs')
})
test('none', () => assert.equal(resolveEntry({ main: 'nope.js' }, ['a.js', 'deep/index.js']), undefined))
