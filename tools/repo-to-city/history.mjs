/**
 * Git history per file (docs/SPEC-city-life.md §3): how often each file
 * changed (commits) and how much (churn = lines added + deleted), from
 *   git log --no-merges --numstat --format=%H%x09%at
 * limited to 2 years before the newest commit or 2,000 commits. Renames are
 * credited to the new path (no --follow: it is per-file and slow).
 *
 * `hotspot()` turns history plus complexity into the 0..1 hotspot score that
 * draws scaffolding: percentile(commits) × percentile(complexity), scaled so
 * the top file is 1. Files that never changed score 0.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FORMAT = '%H%x09%at'

/** `a/{b => c}/d.js` or `old.js => new.js` → the new path. */
export function renamedPath (p) {
  const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
  if (brace) return (brace[1] + brace[3] + brace[4]).replace(/\/\//g, '/').replace(/^\//, '')
  const plain = p.match(/^(.*) => (.*)$/)
  return plain ? plain[2] : p
}

/** Parse `git log --numstat --format=%H%x09%at` output into { path: { commits, churn } }. */
export function parseNumstat (text) {
  const out = {}
  let seen = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (/^[0-9a-f]{40}\t\d+$/.test(line)) {
      seen = new Set()
      continue
    }
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m || !seen) continue
    const p = renamedPath(m[3])
    const e = (out[p] ||= { commits: 0, churn: 0 })
    if (!seen.has(p)) {
      e.commits++
      seen.add(p)
    }
    e.churn += (m[1] === '-' ? 0 : +m[1]) + (m[2] === '-' ? 0 : +m[2])
  }
  return out
}

/**
 * History of a git checkout. `dir` is the folder the city covers (the repo
 * root or a folder inside it); paths come back relative to it.
 */
export function gitHistory ({ dir, rev = 'HEAD', maxCommits = 2000, years = 2 }) {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 })
  const prefix = git('rev-parse', '--show-prefix').trim()
  const newest = +git('log', '-1', '--format=%at', rev).trim()
  const since = new Date((newest - years * 365.25 * 86400) * 1000).toISOString()
  const text = git('log', '--no-merges', '--numstat', `--format=${FORMAT}`, `--since=${since}`, `--max-count=${maxCommits}`, rev, '--', '.')
  const out = {}
  for (const [p, v] of Object.entries(parseNumstat(text))) {
    if (prefix && !p.startsWith(prefix)) continue
    out[p.slice(prefix.length)] = v
  }
  return out
}

/** semver's history up to its vendored tag, from a blobless clone in a temp folder. Null without network. */
export function cloneHistory (url, tag, years = 2) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-city-history-'))
  try {
    execFileSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', url, tmp], { stdio: 'ignore', timeout: 120000 })
    return gitHistory({ dir: tmp, rev: tag, years })
  } catch (e) {
    console.warn(`history: could not read ${url} at ${tag} (${e.message.split('\n')[0]}); the city ships without history`)
    return null
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** Mid-rank percentile of v in sorted values: ties share one score (stable), and a value every file shares sits mid-way. */
function percentile (sorted, v) {
  const bound = (strict) => {
    let lo = 0, hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (strict ? sorted[mid] < v : sorted[mid] <= v) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  return sorted.length ? (bound(true) + bound(false)) / 2 / sorted.length : 0
}

/**
 * Hotspot score per building, in order: percentile(commits) × percentile(complexity),
 * scaled so the top file is 1; 0 for files with no commits (or an empty history).
 */
export function hotspot (buildings) {
  const commits = buildings.map((b) => b.history?.commits ?? 0)
  const cx = buildings.map((b) => b.complexity ?? 0)
  const sc = [...commits].sort((a, b) => a - b)
  const sx = [...cx].sort((a, b) => a - b)
  const raw = buildings.map((_, i) => (commits[i] > 0 ? percentile(sc, commits[i]) * percentile(sx, cx[i]) : 0))
  const top = Math.max(0, ...raw)
  return raw.map((r) => (top > 0 ? Math.round((r / top) * 1000) / 1000 : 0))
}
