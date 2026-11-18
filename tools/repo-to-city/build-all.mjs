#!/usr/bin/env node
/**
 * `npm run city`: run the real semver test suite twice (bugged snapshot, then
 * with the one-line fix applied to a temp copy) and build both cities:
 *   public/cities/semver.json     from fixtures/semver
 *   public/cities/repo-city.json  from this project's src/**\/*.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from 'node:test'
import { runTests } from './run-tests.mjs'
import { buildCity } from './index.mjs'
import { writeLight } from './light-bake.mjs'
import { cloneHistory } from './history.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(HERE, '..', '..')
const p = (...a) => path.join(PROJECT, ...a)
const rel = (a) => path.relative(PROJECT, a)

const writeJson = (file, data, pretty = false) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const json = JSON.stringify(data, null, pretty ? 2 : 0) + '\n'
  fs.writeFileSync(file, json)
  return json.length
}
const report = (city, file, bytes) => console.log(
  `${city.id}: ${city.buildings.length} buildings, ${city.districts.length} districts, ${city.stats.functions} functions, ` +
  `${city.streets.length} streets, ${city.run.total} tests (${city.run.failed} failing) -> ${rel(file)} (${(bytes / 1024).toFixed(1)} KB)`)

// ---------- semver ----------
const fixFile = p('tools/repo-to-city/semver-fix.json')
const fix = JSON.parse(fs.readFileSync(fixFile, 'utf8'))
const semverRoot = p('fixtures/semver')
for (const variant of ['bugged', 'fixed']) {
  const res = await runTests({ root: semverRoot, fix, variant })
  const out = p('fixtures/semver-results', `${variant}.json`)
  writeJson(out, res, true)
  console.log(`semver tests (${variant}): ${res.passed}/${res.total} passed, ${res.failed} failed (${res.durationMs} ms) -> ${rel(out)}`)
}
// semver's git history up to the vendored tag (the snapshot has no .git): a blobless clone,
// cached in fixtures so later builds work offline; `npm run city -- --refresh-history` re-reads it.
// 4 years, not 2: semver is quiet, and in its last 2 years one reformat commit touched nearly every file once.
const historyFile = p('fixtures/semver-results/history.json')
if (!fs.existsSync(historyFile) || process.argv.includes('--refresh-history')) {
  const h = cloneHistory('https://github.com/npm/node-semver', 'v7.7.3', 4)
  if (h) {
    writeJson(historyFile, h, true)
    console.log(`semver history: ${Object.keys(h).length} paths -> ${rel(historyFile)}`)
  }
}
const semverOut = p('public/cities/semver.json')
const semver = buildCity({
  root: semverRoot,
  id: 'semver',
  name: 'semver',
  include: 'classes,functions,ranges,internal,index.js',
  tests: p('fixtures/semver-results/bugged.json'),
  fixed: p('fixtures/semver-results/fixed.json'),
  fix: fixFile,
  summaries: p('tools/repo-to-city/semver-summaries.json'),
  ...(fs.existsSync(historyFile) ? { history: historyFile } : {}),
})
semver.light = writeLight(semver, semverOut)
report(semver, semverOut, writeJson(semverOut, semver))

// ---------- repo-city (this app) ----------
// Tool tests are the only tests this project has; they do not map to src files.
const testDir = p('tools/test')
const testFiles = fs.existsSync(testDir) ? fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(testDir, f)) : []
const unit = { runner: `node:test (node ${process.versions.node})`, total: 0, passed: 0, failed: 0, durationMs: 0, files: {}, failures: [] }
if (testFiles.length) {
  const t0 = performance.now()
  await new Promise((resolve) => {
    const stream = run({ files: testFiles, concurrency: true })
    stream.on('test:pass', (d) => { if (d.details?.type !== 'suite') { unit.total++; unit.passed++ } })
    stream.on('test:fail', (d) => {
      if (d.details?.type === 'suite') return
      unit.total++
      unit.failed++
      unit.failures.push({ testFile: rel(d.file || ''), testName: d.name, assertion: '', expected: '', actual: '', message: String(d.details?.error?.cause?.message || d.details?.error?.message || 'failed') })
    })
    stream.on('end', resolve)
    stream.on('data', () => {})
  })
  unit.durationMs = Math.round(performance.now() - t0)
  console.log(`repo-city tool tests: ${unit.passed}/${unit.total} passed`)
}
const unitFile = p('fixtures/repo-city-results/run.json')
writeJson(unitFile, unit, true)
const exclude = ['src/scene-assets', 'src/robot.ts', 'src/robot-component.ts', 'src/panel.ts']
  .filter((e) => fs.existsSync(p(e)))
const repoOut = p('public/cities/repo-city.json')
const repoCity = buildCity({
  root: PROJECT,
  id: 'repo-city',
  name: 'Repo City',
  include: 'src',
  exclude: exclude.join(','),
  base: 'src',
  tests: unitFile,
  summaries: p('tools/repo-to-city/repo-city-summaries.json'),
  history: 'git',
})
repoCity.light = writeLight(repoCity, repoOut)
report(repoCity, repoOut, writeJson(repoOut, repoCity))
if (unit.failed) {
  console.error(`warning: ${unit.failed} tool test(s) failed; see ${rel(unitFile)}`)
  process.exitCode = 1
}
