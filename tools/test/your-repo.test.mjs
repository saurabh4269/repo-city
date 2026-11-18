// "Your own repo": real node:test run, failures mapped to buildings and floors through their real stacks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runNodeTests } from '../repo-to-city/your-repo.mjs'
import { buildCity } from '../repo-to-city/index.mjs'

test('a failing test in your repo sets the right building and floor on fire, from its stack', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-city-yours-'))
  try {
    fs.mkdirSync(path.join(root, 'src'))
    fs.mkdirSync(path.join(root, 'test'))
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"tiny","type":"module","main":"src/index.js"}')
    fs.writeFileSync(path.join(root, 'src/index.js'), "export { parse } from './parse.js'\n")
    fs.writeFileSync(path.join(root, 'src/parse.js'), [
      'export function trim (s) {',
      '  return s.trim()',
      '}',
      '',
      'export function parse (text) {',
      '  if (text.includes("+")) throw new TypeError(`Invalid input: ${text}`)',
      '  return trim(text).split(".").map(Number)',
      '}',
      '',
    ].join('\n'))
    fs.writeFileSync(path.join(root, 'test/parse.test.mjs'), [
      "import { test } from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { parse } from '../src/parse.js'",
      "test('parses a version', () => assert.deepEqual(parse('1.2.3'), [1, 2, 3]))",
      "test('ignores build metadata', () => assert.deepEqual(parse('1.2.3+build'), [1, 2, 3]))",
      '',
    ].join('\n'))
    const res = await runNodeTests(root, ['test/parse.test.mjs'])
    assert.equal(res.total, 2)
    assert.equal(res.failed, 1)
    assert.ok(!JSON.stringify(res).includes(root) && !JSON.stringify(res).includes(fs.realpathSync(root)) && !JSON.stringify(res).includes(os.tmpdir()), 'no local paths in the results')
    const resultsFile = path.join(root, 'results.json')
    fs.writeFileSync(resultsFile, JSON.stringify(res))
    const city = buildCity({ root, id: 'tiny', include: 'src', base: 'src', tests: resultsFile })
    assert.equal(city.run.failed, 1)
    assert.equal(city.run.failures[0].building, 'src/parse.js')
    const b = city.buildings.find((x) => x.id === 'src/parse.js')
    const failing = b.functions.filter((f) => f.failing)
    assert.deepEqual(failing.map((f) => f.name), ['parse'])
    assert.equal(failing[0].bugLine, 6)
    assert.equal(city.fix, undefined)
    assert.equal(city.entry, 'src/index.js')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
