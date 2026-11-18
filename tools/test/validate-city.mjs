/** Contract checks for a CityData object (src/city/types.ts). Returns a list of problems. */
export function validateCity (c) {
  const errs = []
  const need = (cond, msg) => { if (!cond) errs.push(msg) }
  const str = (v, max, where, { empty = false } = {}) => {
    need(typeof v === 'string', `${where}: not a string`)
    if (typeof v === 'string') {
      if (!empty) need(v.length > 0, `${where}: empty`)
      if (max) need([...v].length <= max, `${where}: ${[...v].length} > ${max} chars`)
    }
  }
  const num = (v, where) => need(typeof v === 'number' && Number.isFinite(v), `${where}: not a finite number`)
  const run = (r, where) => {
    need(r && typeof r === 'object', `${where}: missing`)
    if (!r) return
    str(r.runner, 0, `${where}.runner`)
    for (const k of ['total', 'passed', 'failed', 'durationMs']) num(r[k], `${where}.${k}`)
    need(r.passed + r.failed === r.total, `${where}: passed+failed != total`)
    need(Array.isArray(r.failures), `${where}.failures not an array`)
    need((r.failures || []).length === r.failed, `${where}: failures.length != failed`)
    for (const [i, f] of (r.failures || []).entries()) {
      const w = `${where}.failures[${i}]`
      need(bIds.has(f.building), `${w}.building ${f.building} is not a building`)
      const b = byId.get(f.building)
      need(b && b.functions.some((fn) => fn.name === f.fn), `${w}.fn ${f.fn} is not a floor of ${f.building}`)
      str(f.testFile, 0, `${w}.testFile`)
      str(f.testName, 0, `${w}.testName`)
      str(f.assertion, 60, `${w}.assertion`, { empty: true })
      str(f.expected, 0, `${w}.expected`, { empty: true })
      str(f.actual, 0, `${w}.actual`, { empty: true })
      str(f.message, 120, `${w}.message`)
    }
  }

  need(c.version === 1, 'version !== 1')
  str(c.id, 0, 'id'); str(c.name, 0, 'name'); str(c.tagline, 0, 'tagline')
  for (const k of ['repo', 'url', 'commit', 'license', 'note']) str(c.source?.[k], 0, `source.${k}`, { empty: true })
  for (const k of ['files', 'lines', 'functions', 'tests', 'failing']) num(c.stats?.[k], `stats.${k}`)
  const dIds = new Set(c.districts.map((d) => d.id))
  const bIds = new Set(c.buildings.map((b) => b.id))
  const byId = new Map(c.buildings.map((b) => [b.id, b]))
  need(dIds.size === c.districts.length, 'duplicate district ids')
  need(bIds.size === c.buildings.length, 'duplicate building ids')
  for (const d of c.districts) {
    const w = `district ${d.id}`
    str(d.path, 0, `${w}.path`, { empty: true }); str(d.name, 0, `${w}.name`); str(d.summary, 220, `${w}.summary`)
    need(Number.isInteger(d.color) && d.color >= 0 && d.color <= 5, `${w}.color out of 0..5`)
    for (const k of ['x', 'z', 'w', 'd']) num(d[k], `${w}.${k}`)
  }
  for (const b of c.buildings) {
    const w = `building ${b.id}`
    str(b.path, 0, `${w}.path`); str(b.name, 0, `${w}.name`); str(b.summary, 140, `${w}.summary`)
    need(dIds.has(b.district), `${w}.district unknown`)
    for (const k of ['lines', 'complexity', 'x', 'z', 'w', 'd', 'h']) num(b[k], `${w}.${k}`)
    need(b.h > 0 && b.h <= 0.3601, `${w}.h out of range`)
    if (b.history) {
      for (const k of ['commits', 'churn', 'hot']) num(b.history[k], `${w}.history.${k}`)
      need(b.history.hot >= 0 && b.history.hot <= 1, `${w}.history.hot out of 0..1`)
    }
    need(Array.isArray(b.functions) && b.functions.length >= 1, `${w}: no floors`)
    for (const fn of b.functions || []) {
      const fw = `${w} fn ${fn.name}`
      str(fn.name, 0, `${fw}.name`)
      for (const k of ['startLine', 'endLine', 'lines', 'complexity']) num(fn[k], `${fw}.${k}`)
      need(fn.startLine >= 1 && fn.endLine >= fn.startLine, `${fw}: bad span`)
      str(fn.code, 0, `${fw}.code`, { empty: true })
      const lines = String(fn.code).split('\n')
      need(lines.length <= 16, `${fw}.code has ${lines.length} lines`)
      need(lines.every((l) => [...l].length <= 60), `${fw}.code has a line > 60 chars`)
      if ('failing' in fn) need(fn.failing === true, `${fw}.failing must be true when present`)
      if ('codeStart' in fn) need(Number.isInteger(fn.codeStart) && fn.codeStart > fn.startLine && fn.codeStart <= fn.endLine, `${fw}.codeStart out of span`)
      if ('bugLine' in fn) {
        need(fn.failing === true, `${fw}.bugLine on a floor that is not failing`)
        const from = fn.codeStart ?? fn.startLine
        need(Number.isInteger(fn.bugLine) && fn.bugLine >= from && fn.bugLine < from + lines.length && fn.bugLine <= fn.endLine, `${fw}.bugLine not inside the excerpt`)
      }
    }
    need(Array.isArray(b.imports) && b.imports.every((i) => bIds.has(i)), `${w}.imports reference unknown buildings`)
    num(b.tests?.passed, `${w}.tests.passed`); num(b.tests?.failed, `${w}.tests.failed`)
  }
  for (const s of c.streets) need(bIds.has(s.from) && bIds.has(s.to), `street ${s.from} -> ${s.to} references unknown building`)
  run(c.run, 'run')
  need(c.stats?.tests === c.run?.total, 'stats.tests != run.total')
  need(c.stats?.failing === c.run?.failed, 'stats.failing != run.failed')
  if (c.fix) {
    const f = c.fix
    need(bIds.has(f.building), 'fix.building unknown')
    need(byId.get(f.building)?.functions.some((fn) => fn.name === f.fn), 'fix.fn is not a floor of fix.building')
    num(f.line, 'fix.line')
    str(f.before, 60, 'fix.before', { empty: true }); str(f.after, 60, 'fix.after'); str(f.explanation, 240, 'fix.explanation')
    run(f.run, 'fix.run')
  }
  str(c.guide?.intro, 200, 'guide.intro'); str(c.guide?.onFire, 200, 'guide.onFire'); str(c.guide?.done, 160, 'guide.done')
  if (c.entry !== undefined) need(c.buildings.some((b) => b.id === c.entry), `entry ${c.entry} is not a building`)
  if (c.light !== undefined) need(typeof c.light === 'string' && /^[\w.-]+\.(ktx2|png)$/.test(c.light), 'light must be a file name (.ktx2 or .png) next to the city JSON')
  return errs
}
