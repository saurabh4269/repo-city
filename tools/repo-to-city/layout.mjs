/**
 * City layout: a pure function from districts/buildings (with weights and
 * complexity) to rectangles in city units (x, z ∈ [-0.5, 0.5]).
 *
 * Districts are laid out with a squarified treemap, then each district's
 * buildings are laid out the same way inside it. Streets are the gaps left
 * between rectangles. Buildings are kept square-ish (aspect ≤ maxAspect) and
 * centred in their cell.
 */

export const DEFAULTS = {
  margin: 0.03, // empty border around the city
  districtGap: 0.025, // street between districts
  buildingGap: 0.012, // street between buildings
  districtPad: 0.008, // extra inner padding of a district before buildings
  minSide: 0.05, // wanted minimum building footprint side
  maxAspect: 2,
  minHeight: 0.05,
  heightRange: 0.31,
  weightExponent: 0.7,
}

/** Bruls/Huizing/van Wijk squarified treemap. items: [{weight,...}] → [{item,x0,z0,x1,z1}] */
export function squarify (items, rect, sort = true) {
  const out = []
  const total = items.reduce((s, it) => s + it.weight, 0)
  if (!items.length || total <= 0) return out
  const area = (rect.x1 - rect.x0) * (rect.z1 - rect.z0)
  const scale = area / total
  const queue = (sort ? [...items].sort((a, b) => b.weight - a.weight) : [...items]).map((item) => ({ item, a: item.weight * scale }))
  let r = { ...rect }

  const worst = (row, side) => {
    const s = row.reduce((t, e) => t + e.a, 0)
    let max = 0
    for (const e of row) {
      const ratio = Math.max((side * side * e.a) / (s * s), (s * s) / (side * side * e.a))
      if (ratio > max) max = ratio
    }
    return max
  }
  const layoutRow = (row) => {
    const w = r.x1 - r.x0
    const d = r.z1 - r.z0
    const s = row.reduce((t, e) => t + e.a, 0)
    if (w >= d) {
      // column on the left, stacked along z
      const cw = s / d
      let z = r.z0
      for (const e of row) {
        const h = e.a / cw
        out.push({ item: e.item, x0: r.x0, z0: z, x1: r.x0 + cw, z1: z + h })
        z += h
      }
      r = { ...r, x0: r.x0 + cw }
    } else {
      const ch = s / w
      let x = r.x0
      for (const e of row) {
        const ww = e.a / ch
        out.push({ item: e.item, x0: x, z0: r.z0, x1: x + ww, z1: r.z0 + ch })
        x += ww
      }
      r = { ...r, z0: r.z0 + ch }
    }
  }

  let row = []
  while (queue.length) {
    const side = Math.min(r.x1 - r.x0, r.z1 - r.z0)
    const next = queue[0]
    if (!row.length || worst([...row, next], side) <= worst(row, side)) {
      row.push(queue.shift())
    } else {
      layoutRow(row)
      row = []
    }
  }
  if (row.length) layoutRow(row)
  // snap the last rects to the outer edge to absorb float drift
  for (const o of out) {
    o.x1 = Math.min(o.x1, rect.x1)
    o.z1 = Math.min(o.z1, rect.z1)
  }
  return out
}

/**
 * Binary split treemap: split the (weight-sorted) list where the two halves are
 * closest to equal and cut the rectangle across its longer side. Tends to give
 * small items squarer cells than squarify does when they come last.
 */
export function binarySplit (items, rect, sort = true) {
  const out = []
  const rec = (list, r) => {
    if (!list.length) return
    if (list.length === 1) { out.push({ item: list[0], ...r }); return }
    const total = list.reduce((s, it) => s + it.weight, 0)
    let acc = 0
    let k = 1
    let best = Infinity
    for (let i = 1; i < list.length; i++) {
      acc += list[i - 1].weight
      const diff = Math.abs(total / 2 - acc)
      if (diff < best) { best = diff; k = i }
    }
    const a = list.slice(0, k)
    const b = list.slice(k)
    const fa = a.reduce((s, it) => s + it.weight, 0) / total
    if (r.x1 - r.x0 >= r.z1 - r.z0) {
      const xm = r.x0 + (r.x1 - r.x0) * fa
      rec(a, { x0: r.x0, z0: r.z0, x1: xm, z1: r.z1 })
      rec(b, { x0: xm, z0: r.z0, x1: r.x1, z1: r.z1 })
    } else {
      const zm = r.z0 + (r.z1 - r.z0) * fa
      rec(a, { x0: r.x0, z0: r.z0, x1: r.x1, z1: zm })
      rec(b, { x0: r.x0, z0: zm, x1: r.x1, z1: r.z1 })
    }
  }
  rec(sort ? [...items].sort((x, y) => y.weight - x.weight) : [...items], rect)
  return out
}

const ALGOS = [squarify, binarySplit]

/** Deterministic PRNG (mulberry32) so the layout stays a pure function of its input. */
function rng (seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function permutations (list) {
  if (list.length <= 1) return [list]
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]))
}
/** Candidate orders: weight-sorted first, then every permutation (small lists) or seeded shuffles. */
export function orderings (items, maxPerms = 5, shuffles = 24, seed = 1) {
  const sorted = [...items].sort((a, b) => b.weight - a.weight)
  if (items.length <= maxPerms) return [sorted, ...permutations(sorted).slice(1)]
  const r = rng(seed)
  const out = [sorted]
  for (let k = 0; k < shuffles; k++) {
    const a = [...sorted]
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    out.push(a)
  }
  return out
}
const better = (a, b) => !b || a.minSide > b.minSide + 1e-6 || (Math.abs(a.minSide - b.minSide) <= 1e-6 && a.area > b.area + 1e-9)

const inset = (r, g) => ({ x0: r.x0 + g, z0: r.z0 + g, x1: r.x1 - g, z1: r.z1 - g })
const round = (v) => Math.round(v * 10000) / 10000

/**
 * Raise small weights so that the smallest cell is likely to fit a building of
 * minSide (plus gaps). `share` is the fraction of the total area the smallest
 * item must get.
 */
export function floorWeights (raw, share) {
  let m = Math.min(...raw)
  for (let i = 0; i < 50; i++) {
    const w = raw.map((v) => Math.max(v, m))
    const total = w.reduce((s, v) => s + v, 0)
    const need = share * total
    if (m >= need - 1e-9) return w
    m = need
  }
  return raw.map((v) => Math.max(v, m))
}

/**
 * Affinity between districts: import edges between them, either direction.
 * `edges` are building-id pairs; `districtOf` maps a building id to its district.
 * Returns a symmetric Map<string, Map<string, number>>.
 */
export function districtAffinity (edges, districtOf) {
  const A = new Map()
  const add = (a, b) => {
    if (!A.has(a)) A.set(a, new Map())
    A.get(a).set(b, (A.get(a).get(b) || 0) + 1)
  }
  for (const e of edges) {
    const a = districtOf.get(e.from), b = districtOf.get(e.to)
    if (!a || !b || a === b) continue
    add(a, b)
    add(b, a)
  }
  return A
}
const aff = (A, a, b) => A.get(a)?.get(b) || 0

/**
 * Chain order (docs/SPEC-city-life.md §5): the heaviest district first, then
 * repeatedly the unplaced one with the most affinity to those already placed
 * (ties: heavier, then id). Squarify fills rows in this order, so neighbours
 * in the chain end up side by side.
 */
export function affinityOrder (items, A) {
  const left = [...items].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))
  const out = left.length ? [left.shift()] : []
  while (left.length) {
    let best = 0, bestS = -1
    left.forEach((it, i) => {
      const sc = out.reduce((t, p) => t + aff(A, p.id, it.id), 0)
      if (sc > bestS) { bestS = sc; best = i } // `left` is already in tie-break order
    })
    out.push(left.splice(best, 1)[0])
  }
  return out
}

/** Σ A[a][b] × distance between district centres (each pair once), and the worst district aspect ratio. */
export function layoutScore (rects, A) {
  const c = rects.map((r) => ({ id: r.id, x: (r.rect.x0 + r.rect.x1) / 2, z: (r.rect.z0 + r.rect.z1) / 2 }))
  let cost = 0
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) cost += aff(A, c[i].id, c[j].id) * Math.hypot(c[i].x - c[j].x, c[i].z - c[j].z)
  const worstAspect = Math.max(1, ...rects.map((r) => {
    const w = r.rect.x1 - r.rect.x0, d = r.rect.z1 - r.rect.z0
    return Math.max(w / d, d / w)
  }))
  return { cost: Math.round(cost * 10000) / 10000, worstAspect: Math.round(worstAspect * 1000) / 1000 }
}

/**
 * @param {{id:string, buildings:{id:string, lines:number, complexity:number}[]}[]} districts
 * opts.mode 'size' (default) or 'affinity'; opts.edges [{from, to}] building ids (imports).
 * Affinity is used only if it cuts the coupling cost by ≥10% and keeps district
 * aspect ≤ maxAspect × 1.25; otherwise size, with the reason in `stats`.
 * @returns {{districts: Record<string,{x,z,w,d}>, buildings: Record<string,{x,z,w,d,h}>}}
 */
export function layoutCity (districts, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const all = districts.flatMap((d) => d.buildings)
  const half = 0.5 - o.margin
  const city = { x0: -half, z0: -half, x1: half, z1: half }
  const cityArea = (2 * half) ** 2

  // building weights, with a floor so the smallest building can reach minSide
  const raw = all.map((b) => Math.max(1, b.lines) ** o.weightExponent)
  const cell = o.minSide + o.buildingGap
  // slack factor: street gaps + treemap cells are not perfect squares
  const share = Math.min(0.5, (cell * cell * 2.2) / cityArea)
  const weights = floorWeights(raw, share)
  const weightOf = new Map(all.map((b, i) => [b.id, weights[i]]))

  const dItems = districts
    .filter((d) => d.buildings.length)
    .map((d) => ({ id: d.id, d, weight: d.buildings.reduce((s, b) => s + weightOf.get(b.id), 0) }))

  const fl = (v) => Math.floor(v * 10000) / 10000 // round sizes inward so a building never leaves its cell
  const placeDistrict = (dr) => {
    const r = inset(dr, o.districtGap / 2)
    const inner = inset(r, o.districtPad)
    const bItems = dr.item.d.buildings.map((b) => ({ id: b.id, weight: weightOf.get(b.id) }))
    let best = null
    for (const algo of ALGOS) for (const order of orderings(bItems, 4, 20, bItems.length)) {
      const placed = {}
      let minSide = Infinity
      let area = 0
      for (const br of algo(order, inner, false)) {
        const c = inset(br, o.buildingGap / 2)
        let w = Math.max(0.001, c.x1 - c.x0)
        let d = Math.max(0.001, c.z1 - c.z0)
        if (w > d * o.maxAspect) w = d * o.maxAspect
        if (d > w * o.maxAspect) d = w * o.maxAspect
        minSide = Math.min(minSide, w, d)
        area += w * d
        w = fl(w)
        d = fl(d)
        if (w > d * o.maxAspect) w = fl(d * o.maxAspect)
        if (d > w * o.maxAspect) d = fl(w * o.maxAspect)
        placed[br.item.id] = { x: round((c.x0 + c.x1) / 2), z: round((c.z0 + c.z1) / 2), w, d, h: 0 }
      }
      const cand = { placed, minSide, area }
      if (better(cand, best)) best = cand
    }
    return { rect: r, ...best }
  }

  let bestCity = null
  for (const algo of ALGOS) for (const order of orderings(dItems, 5, 40, 7)) {
    const placed = algo(order, city, false).map((dr) => ({ id: dr.item.id, ...placeDistrict(dr) }))
    const cand = { placed, minSide: Math.min(...placed.map((p) => p.minSide)), area: placed.reduce((s, p) => s + p.area, 0) }
    if (better(cand, bestCity)) bestCity = cand
  }

  // affinity: districts that import each other a lot sit side by side (behind a gate)
  const districtOf = new Map(districts.flatMap((d) => d.buildings.map((b) => [b.id, d.id])))
  const A = districtAffinity(o.edges || [], districtOf)
  const sizeScore = layoutScore(bestCity.placed, A)
  const stats = { mode: 'size', requested: o.mode || 'size', costSize: sizeScore.cost, aspectSize: sizeScore.worstAspect }
  if (o.mode === 'affinity') {
    const placed = squarify(affinityOrder(dItems, A), city, false).map((dr) => ({ id: dr.item.id, ...placeDistrict(dr) }))
    const affScore = layoutScore(placed, A)
    Object.assign(stats, { costAffinity: affScore.cost, aspectAffinity: affScore.worstAspect })
    if (sizeScore.cost <= 0) stats.reason = 'no imports between districts'
    else if (affScore.cost > 0.9 * sizeScore.cost) stats.reason = `affinity cost ${affScore.cost} is not 10% under size ${sizeScore.cost}`
    else if (affScore.worstAspect > o.maxAspect * 1.25) stats.reason = `affinity district aspect ${affScore.worstAspect} > ${o.maxAspect * 1.25}`
    else {
      stats.mode = 'affinity'
      bestCity = { placed }
    }
  }

  const outD = {}
  const outB = {}
  for (const p of bestCity.placed) {
    const r = p.rect
    outD[p.id] = { x: round((r.x0 + r.x1) / 2), z: round((r.z0 + r.z1) / 2), w: fl(r.x1 - r.x0), d: fl(r.z1 - r.z0) }
    Object.assign(outB, p.placed)
  }

  // heights from complexity (log scaled)
  const cs = all.map((b) => Math.max(1, b.complexity))
  const lo = Math.log(Math.min(...cs))
  const hi = Math.log(Math.max(...cs))
  for (const b of all) {
    const t = hi > lo ? (Math.log(Math.max(1, b.complexity)) - lo) / (hi - lo) : 0.5
    if (outB[b.id]) outB[b.id].h = round(o.minHeight + o.heightRange * t)
  }
  return { districts: outD, buildings: outB, stats }
}
