/**
 * The package's entry file (the city's town hall), resolved in this order:
 *   package.json exports["."] (a string, or its .import / .require / .default)
 *   → main → index.{js,mjs,cjs,ts} at the root of the included folder → none.
 * Pure: `pkg` is the parsed package.json (or null), `ids` the building ids,
 * `base` the included folder ('' for the repo root).
 */
import path from 'node:path'

const clean = (p) => path.posix.normalize(String(p).replace(/^\.\//, ''))

function exportsDot (ex) {
  if (typeof ex === 'string') return ex
  if (!ex || typeof ex !== 'object') return undefined
  const dot = '.' in ex ? ex['.'] : ex // conditions directly on exports
  if (typeof dot === 'string') return dot
  if (!dot || typeof dot !== 'object') return undefined
  for (const k of ['import', 'require', 'default']) {
    const v = dot[k]
    if (typeof v === 'string') return v
    if (v && typeof v === 'object' && typeof v.default === 'string') return v.default
  }
  return undefined
}

export function resolveEntry (pkg, ids, base = '') {
  const has = new Set(ids)
  for (const cand of [pkg && exportsDot(pkg.exports), pkg?.main]) {
    if (cand && has.has(clean(cand))) return clean(cand)
  }
  for (const ext of ['js', 'mjs', 'cjs', 'ts']) {
    const id = base ? `${base}/index.${ext}` : `index.${ext}`
    if (has.has(id)) return id
  }
  return undefined
}
