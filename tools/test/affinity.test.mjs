// Affinity layout (docs/SPEC-city-life.md §5): districts that import each other sit side by side, behind a gate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutCity, squarify, affinityOrder, districtAffinity } from '../repo-to-city/layout.mjs'

const EPS = 1e-4
const mk = (id, ls) => ({ id, buildings: ls.map((l, i) => ({ id: `${id}/${i}`, lines: l, complexity: 3 + i })) })
// two heavily coupled districts (d and e) that size ordering puts apart
const W = { a: 600, b: 200, c: 150, d: 100, e: 80 }
const districts = Object.entries(W).map(([id, w]) => mk(id, [w, w * 0.6]))
const edges = Array.from({ length: 15 }, () => ({ from: 'd/0', to: 'e/0' })).concat([{ from: 'a/0', to: 'b/1' }])
const rect = (o) => ({ x0: o.x - o.w / 2, x1: o.x + o.w / 2, z0: o.z - o.d / 2, z1: o.z + o.d / 2 })
const overlap = (a, b) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS
/** Sharing an edge across a street (gap ≤ 3 cm units) with at least 2 units of overlap along it. */
const adjacent = (p, q, gap = 0.03) => {
  const a = rect(p), b = rect(q)
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)
  return (ox > -gap && oz > 0.02) || (oz > -gap && ox > 0.02)
}

test('affinity order is a chain: heaviest first, then the most coupled', () => {
  const A = districtAffinity(edges, new Map(districts.flatMap((d) => d.buildings.map((b) => [b.id, d.id]))))
  const items = districts.map((d) => ({ id: d.id, weight: W[d.id] }))
  const order = affinityOrder(items, A).map((x) => x.id)
  assert.deepEqual(order.slice(0, 2), ['a', 'b'])
  assert.equal(Math.abs(order.indexOf('d') - order.indexOf('e')), 1)
})

test('unsorted squarify: each district area is proportional to its weight (±1%)', () => {
  const items = Object.entries(W).map(([id, weight]) => ({ id, weight }))
  const r = { x0: -0.47, z0: -0.47, x1: 0.47, z1: 0.47 }
  const total = items.reduce((s, x) => s + x.weight, 0)
  for (const o of squarify(items, r, false)) {
    const want = (o.item.weight / total) * 0.94 * 0.94
    assert.ok(Math.abs((o.x1 - o.x0) * (o.z1 - o.z0) - want) / want < 0.01, o.item.id)
  }
})

const aff = layoutCity(districts, { mode: 'affinity', edges })
const size = layoutCity(districts, { edges })

test('affinity: no overlaps, everything inside the margin', () => {
  const ds = Object.values(aff.districts).map(rect)
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) assert.ok(!overlap(ds[i], ds[j]), `districts ${i}/${j}`)
  const bs = Object.values(aff.buildings).map(rect)
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) assert.ok(!overlap(bs[i], bs[j]), `buildings ${i}/${j}`)
  for (const r of [...ds, ...bs]) assert.ok(r.x0 >= -0.47 - EPS && r.x1 <= 0.47 + EPS && r.z0 >= -0.47 - EPS && r.z1 <= 0.47 + EPS)
})

test('affinity: deterministic (byte-identical output)', () => {
  assert.equal(JSON.stringify(layoutCity(districts, { mode: 'affinity', edges })), JSON.stringify(aff))
})

test('affinity puts the coupled districts side by side and the cost drops', () => {
  assert.ok(!adjacent(size.districts.d, size.districts.e), 'size keeps them apart (fixture check)')
  assert.equal(aff.stats.mode, 'affinity')
  assert.ok(adjacent(aff.districts.d, aff.districts.e))
  assert.ok(aff.stats.costAffinity <= 0.9 * aff.stats.costSize)
})

test('no edges: the same result as size ordering', () => {
  const a = layoutCity(districts, { mode: 'affinity', edges: [] })
  const s = layoutCity(districts, { edges: [] })
  assert.deepEqual(a.districts, s.districts)
  assert.deepEqual(a.buildings, s.buildings)
  assert.equal(a.stats.mode, 'size')
})
