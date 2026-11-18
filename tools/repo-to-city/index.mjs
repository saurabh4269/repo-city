#!/usr/bin/env node
/**
 * repo-to-city: turn a code repo (+ a real test run) into a CityData JSON file
 * (contract: src/city/types.ts).
 *
 *   node tools/repo-to-city/index.mjs --root fixtures/semver \
 *     --include classes,functions,ranges,internal,index.js \
 *     --tests fixtures/semver-results/bugged.json --fixed fixtures/semver-results/fixed.json \
 *     --fix tools/repo-to-city/semver-fix.json --summaries tools/repo-to-city/semver-summaries.json \
 *     --out public/cities/semver.json
 *
 * Options:
 *   --id / --name        city id and display name (default: basename of root)
 *   --base <dir>         folder whose children become districts (default: root)
 *   --exclude a,b        path prefixes to skip (relative to root)
 *   --max-buildings N    default 70 (smallest files dropped first)
 *   --max-floors N       default 20 functions per building
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSource, excerpt, bugExcerpt } from './parser.mjs'
import { layoutCity } from './layout.mjs'
import { parseArgs } from './run-tests.mjs'
import { resolveEntry } from './entry.mjs'
import { gitHistory, hotspot } from './history.mjs'

const SRC_EXT = /\.(c?js|mjs|ts|tsx|jsx|mts|cts)$/
const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  return [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s
}
const titleCase = (s) => s.length <= 2 ? s.toUpperCase() : s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const toPosix = (p) => p.split(path.sep).join('/')

function listFiles (root, include, exclude) {
  const out = []
  const skip = (rel) => exclude.some((e) => rel === e || rel.startsWith(e.replace(/\/?$/, '/'))) || /(^|\/)(node_modules|\.git)(\/|$)/.test(rel) || /\.d\.ts$/.test(rel)
  const walk = (abs) => {
    const rel = toPosix(path.relative(root, abs))
    if (skip(rel)) return
    const st = fs.statSync(abs)
    if (st.isDirectory()) for (const e of fs.readdirSync(abs).sort()) walk(path.join(abs, e))
    else if (SRC_EXT.test(abs)) out.push(rel)
  }
  for (const inc of include) if (fs.existsSync(path.join(root, inc))) walk(path.join(root, inc))
  return [...new Set(out)].sort()
}

function resolveImport (fromRel, spec, known) {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  const stem = base.replace(/\.(m|c)?js$/, '')
  const candidates = [base, `${base}.js`, `${base}.ts`, `${base}.mjs`, `${base}.cjs`, `${base}.tsx`,
    `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${base}/index.js`, `${base}/index.ts`]
  return candidates.find((c) => known.has(c)) || null
}

/** test/X → X (exact path, or same stem with another extension). */
function testFileFor (rel, testFiles) {
  const stem = rel.replace(SRC_EXT, '')
  return testFiles.find((t) => t === `test/${rel}`) || testFiles.find((t) => t.replace(SRC_EXT, '') === `test/${stem}`) || null
}

function toRun (r, failures) {
  return {
    runner: r.runner,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    durationMs: r.durationMs,
    failures,
  }
}

export function buildCity (args) {
  const root = path.resolve(args.root)
  const include = String(args.include || '.').split(',').map((s) => s.trim()).filter(Boolean)
  const exclude = String(args.exclude || '').split(',').map((s) => s.trim()).filter(Boolean)
  const base = args.base ? toPosix(args.base).replace(/\/$/, '') : ''
  const id = args.id || path.basename(root)
  const name = args.name || id
  const maxBuildings = Number(args['max-buildings'] || 70)
  const maxFloors = Number(args['max-floors'] || 20)
  const readJson = (p) => (p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null)
  const results = readJson(args.tests) || { runner: 'none', total: 0, passed: 0, failed: 0, durationMs: 0, files: {}, failures: [] }
  const fixedResults = readJson(args.fixed)
  const fixSpec = readJson(args.fix)
  const sm = readJson(args.summaries) || {}

  // ---- parse files
  let files = listFiles(root, include, exclude).map((rel) => {
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    return { rel, text, ...parseSource(text, rel) }
  })
  if (files.length > maxBuildings) {
    const keep = new Set([...files].sort((a, b) => b.lines - a.lines).slice(0, maxBuildings).map((f) => f.rel))
    if (fixSpec) keep.add(fixSpec.file)
    files = files.filter((f) => keep.has(f.rel))
  }
  const known = new Set(files.map((f) => f.rel))

  // ---- districts: first path segment below base; files directly in base → root district
  const rootDistrictId = args['root-district'] || 'root'
  const districtOf = (rel) => {
    const r = base ? rel.slice(base.length + 1) : rel
    const seg = r.split('/')
    return seg.length > 1 ? seg[0] : rootDistrictId
  }
  const districtIds = [...new Set(files.map((f) => districtOf(f.rel)))].sort((a, b) => (a === rootDistrictId) - (b === rootDistrictId) || a.localeCompare(b))
  const testFiles = Object.keys(results.files || {})

  // ---- buildings
  const buildings = files.map((f) => {
    let fns = f.functions.map((fn) => ({ ...fn }))
    const failingFn = fixSpec && fixSpec.file === f.rel
      ? fns.filter((fn) => fn.startLine <= fixSpec.line && fixSpec.line <= fn.endLine).sort((a, b) => a.lines - b.lines)[0]
      : null
    if (fns.length > maxFloors) {
      const keep = new Set([...fns].sort((a, b) => b.lines - a.lines).slice(0, maxFloors))
      if (failingFn) keep.add(failingFn)
      fns = fns.filter((fn) => keep.has(fn))
    }
    if (!fns.length) {
      const n = f.text.split('\n').length
      fns = [{ name: '(module)', startLine: 1, endLine: n, lines: f.lines, complexity: f.complexity }]
    }
    const tf = testFileFor(f.rel, testFiles)
    const t = tf ? results.files[tf] : null
    return {
      id: f.rel,
      path: f.rel,
      name: path.posix.basename(f.rel),
      district: districtOf(f.rel),
      lines: f.lines,
      complexity: f.complexity,
      summary: clip(sm.buildings?.[f.rel] || f.docComment.split(/(?<=[.!?])\s|:\s+-\s/)[0].replace(/[^.!?]$/, '$&.') || `${/\.tsx?$/.test(f.rel) ? 'TypeScript' : 'JavaScript'} module, ${f.lines} lines.`, 140),
      x: 0, z: 0, w: 0, d: 0, h: 0,
      functions: fns.map((fn) => {
        const out = {
          name: fn.name,
          startLine: fn.startLine,
          endLine: fn.endLine,
          lines: fn.lines,
          complexity: fn.complexity,
          code: excerpt(f.text, fn.startLine, fn.endLine),
        }
        if (failingFn && fn.name === failingFn.name) {
          out.failing = true
          const ex = bugExcerpt(f.text, fn.startLine, fn.endLine, fixSpec.line)
          out.code = ex.code
          if (ex.codeStart && ex.codeStart !== fn.startLine) out.codeStart = ex.codeStart
          out.bugLine = fixSpec.line
        }
        return out
      }),
      imports: [...new Set(f.imports.map((s) => resolveImport(f.rel, s, known)).filter((x) => x && x !== f.rel))].sort(),
      tests: t ? { passed: t.passed, failed: t.failed } : { passed: 0, failed: 0 },
      _testFile: tf,
    }
  })
  const byId = new Map(buildings.map((b) => [b.id, b]))

  // ---- history (scaffolding on hot spots): an object, a JSON file, or 'git' to read the root's own log
  let hist = null
  if (args.history && typeof args.history === 'object') hist = args.history
  else if (args.history === 'git') {
    try { hist = gitHistory({ dir: root }) } catch (e) { console.warn(`history: ${e.message.split('\n')[0]}`) }
  } else if (args.history) hist = readJson(args.history)
  if (hist) {
    for (const b of buildings) {
      const h = hist[b.id]
      b.history = { commits: h?.commits ?? 0, churn: h?.churn ?? 0, hot: 0 }
    }
    hotspot(buildings).forEach((hot, i) => { buildings[i].history.hot = hot })
  }

  // ---- layout
  // --layout size|affinity (affinity only where it passes its gate; see layout.mjs), or an options object
  const layoutOpts = args.layout && typeof args.layout === 'object' ? args.layout : { mode: args.layout || 'size' }
  const edges = buildings.flatMap((b) => b.imports.map((to) => ({ from: b.id, to })))
  const layout = layoutCity(districtIds.map((did) => ({ id: did, buildings: buildings.filter((b) => b.district === did) })), { ...layoutOpts, edges })
  if (layout.stats.requested === 'affinity') console.log(`${id}: layout ${layout.stats.mode}${layout.stats.reason ? ` (${layout.stats.reason})` : ''}, coupling cost size ${layout.stats.costSize} / affinity ${layout.stats.costAffinity}`)
  for (const b of buildings) Object.assign(b, layout.buildings[b.id])

  const districts = districtIds.map((did, i) => ({
    id: did,
    path: did === rootDistrictId ? (base ? `${base}/` : '') : `${base ? base + '/' : ''}${did}/`,
    name: did === rootDistrictId ? (sm.rootDistrictName || name) : titleCase(did),
    summary: clip(sm.districts?.[did] || `${buildings.filter((b) => b.district === did).length} files in ${did === rootDistrictId ? 'the top folder' : did + '/'}.`, 220),
    color: i % 6,
    ...layout.districts[did],
  }))

  // ---- streets
  const streets = []
  for (const b of buildings) for (const to of b.imports) streets.push({ from: b.id, to })

  // ---- failures
  const failingBuilding = fixSpec ? byId.get(fixSpec.file) : null
  const failingFnName = failingBuilding?.functions.find((fn) => fn.failing)?.name
  const mapFailure = (f) => {
    const src = buildings.find((b) => b._testFile === f.testFile)
    // a failure whose stack runs through the file with the bug belongs to that building, whichever test caught it
    // or that the fix turns green (the fixed run of that test file has no failures)
    const viaStack = failingBuilding && (`${f.actual}\n${f.message}`.includes(`${failingBuilding.id}:`) || (fixedResults?.files?.[f.testFile] && fixedResults.files[f.testFile].failed === 0))
    const building = viaStack ? failingBuilding.id : src ? src.id : (failingBuilding ? failingBuilding.id : buildings[0].id)
    const bld = byId.get(building)
    const fn = building === failingBuilding?.id ? failingFnName : (bld.functions[0]?.name || '(module)')
    return {
      building,
      fn,
      testFile: f.testFile,
      testName: clip(f.testName, 120),
      assertion: clip(f.assertion || '', 60),
      expected: clip(f.expected, 200),
      actual: clip(f.actual, 400),
      message: clip(f.message, 120),
    }
  }
  const run = toRun(results, (results.failures || []).map(mapFailure))

  // ---- fix
  let fix
  if (fixSpec && failingBuilding) {
    fix = {
      building: failingBuilding.id,
      fn: failingFnName,
      line: fixSpec.line,
      before: fixSpec.before === null ? '' : clip(fixSpec.before, 60),
      after: clip(fixSpec.after.trim(), 60),
      ...(fixSpec.commit ? { commit: { hash: fixSpec.commit.slice(0, 7), subject: clip(fixSpec.subject || '', 80), date: fixSpec.date || '', repo: sm.source?.repo || '' } } : {}),
      explanation: clip(sm.fix?.explanation || `Line ${fixSpec.line} was changed back to its original form.`, 240),
      run: toRun(fixedResults || results, (fixedResults?.failures || []).map(mapFailure)),
    }
  }
  for (const b of buildings) delete b._testFile

  // guide/fix text may use {total} {passed} {failed} {file} {fn} placeholders
  const vars = { total: run.total.toLocaleString('en-US'), passed: run.passed.toLocaleString('en-US'), failed: String(run.failed), file: failingBuilding?.name || '', fn: failingFnName || '' }
  const fill = (str) => str && str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
  if (fix) fix.explanation = fill(fix.explanation)

  // ---- entry point (the town hall)
  let pkg = null
  try { pkg = JSON.parse(fs.readFileSync(path.join(args.root, 'package.json'), 'utf8')) } catch { /* none */ }
  const entry = resolveEntry(pkg, buildings.map((b) => b.id), base)

  const city = {
    version: 1,
    id,
    name,
    tagline: clip(sm.tagline || `${name}: ${files.length} source files.`, 160),
    source: {
      repo: sm.source?.repo || name,
      url: sm.source?.url || '',
      commit: sm.source?.commit || '',
      license: sm.source?.license || '',
      note: sm.source?.note || '',
    },
    stats: {
      files: buildings.length,
      lines: buildings.reduce((s, b) => s + b.lines, 0),
      functions: buildings.reduce((s, b) => s + b.functions.filter((fn) => fn.name !== '(module)').length, 0),
      tests: run.total,
      failing: run.failed,
      layout: layout.stats,
    },
    districts,
    buildings,
    streets,
    run,
    ...(fix ? { fix } : {}),
    ...(entry ? { entry } : {}),
    guide: {
      intro: clip(fill(sm.guide?.intro) || `This is ${name}. Each building is a file; taller means more branching logic.`, 200),
      onFire: clip(fill(sm.guide?.onFire) || 'This building is on fire because a test that exercises it is failing.', 200),
      done: clip(fill(sm.guide?.done) || 'All tests pass again.', 160),
    },
  }
  return city
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.root || !args.out) {
    console.error('usage: index.mjs --root <repo> --out <city.json> [--include a,b] [--exclude a,b] [--base dir] [--tests r.json --fixed r.json --fix fix.json] [--summaries s.json] [--id x --name y] [--history git|h.json] [--layout size|affinity] [--no-light]')
    process.exit(2)
  }
  const city = buildCity(args)
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
  // baked AO + sun shadows next to the JSON (KTX2 with KTX-Software, else PNG); --no-light skips it
  if (!args['no-light']) city.light = (await import('./light-bake.mjs')).writeLight(city, args.out)
  const json = JSON.stringify(city)
  fs.writeFileSync(args.out, json + '\n')
  console.log(`${city.id}: ${city.buildings.length} buildings, ${city.districts.length} districts, ${city.stats.functions} functions, ${city.streets.length} streets, ${city.run.total} tests (${city.run.failed} failing) -> ${args.out} (${(json.length / 1024).toFixed(1)} KB)`)
}
