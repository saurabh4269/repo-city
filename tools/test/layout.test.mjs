import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutCity, squarify, binarySplit } from '../repo-to-city/layout.mjs'

const EPS = 1e-4
const rect = (o) => ({ x0: o.x - o.w / 2, x1: o.x + o.w / 2, z0: o.z - o.d / 2, z1: o.z + o.d / 2 })
const overlap = (a, b) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS
const inside = (a, b) => a.x0 >= b.x0 - EPS && a.x1 <= b.x1 + EPS && a.z0 >= b.z0 - EPS && a.z1 <= b.z1 + EPS

// a deterministic, semver-like input: a few big files and many tiny ones
const sizes = {
  classes: [500, 300, 140, 6],
  functions: [47, 40, 30, 20, 13, 12, 11, 10, 9, 8, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3],
  ranges: [250, 90, 70, 40, 30, 25, 25, 8, 7, 5, 5],
  internal: [170, 35, 30, 20, 15, 9],
  root: [90],
}
const districts = Object.entries(sizes).map(([id, ls]) => ({
  id,
  buildings: ls.map((lines, i) => ({ id: `${id}/f${i}.js`, lines, complexity: 1 + (lines % 37) })),
}))
const out = layoutCity(districts)
const city = { x0: -0.5, x1: 0.5, z0: -0.5, z1: 0.5 }

test('every district and building is placed', () => {
  assert.equal(Object.keys(out.districts).length, districts.length)
  assert.equal(Object.keys(out.buildings).length, districts.reduce((s, d) => s + d.buildings.length, 0))
})

test('districts stay inside the city margin and do not overlap', () => {
  const ds = Object.values(out.districts).map(rect)
  for (const d of ds) assert.ok(inside(d, { x0: -0.47, x1: 0.47, z0: -0.47, z1: 0.47 }), 'inside margin')
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) assert.ok(!overlap(ds[i], ds[j]), 'district overlap')
})

test('buildings sit inside their district and never overlap', () => {
  for (const d of districts) {
    const dr = rect(out.districts[d.id])
    for (const b of d.buildings) {
      const br = rect(out.buildings[b.id])
      assert.ok(inside(br, dr), `${b.id} leaves ${d.id}`)
      assert.ok(inside(br, city), `${b.id} leaves the city`)
    }
  }
  const all = Object.entries(out.buildings).map(([id, b]) => [id, rect(b)])
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i][1], all[j][1]), `${all[i][0]} overlaps ${all[j][0]}`)
  }
})

test('footprints are pinchable and square-ish; heights in range', () => {
  for (const [id, b] of Object.entries(out.buildings)) {
    assert.ok(Math.min(b.w, b.d) >= 0.045, `${id} min side ${Math.min(b.w, b.d)}`)
    assert.ok(Math.max(b.w, b.d) / Math.min(b.w, b.d) <= 2.001, `${id} aspect`)
    assert.ok(b.h >= 0.05 - EPS && b.h <= 0.36 + EPS, `${id} height ${b.h}`)
  }
  assert.ok(Math.max(...Object.values(out.buildings).map((b) => b.h)) > 0.35, 'tallest ~0.36')
})

test('layout is deterministic', () => {
  assert.deepEqual(layoutCity(districts), out)
})

test('treemaps tile their rectangle exactly', () => {
  const items = [5, 3, 2, 1, 1, 0.5].map((weight, i) => ({ id: i, weight }))
  const r = { x0: 0, z0: 0, x1: 2, z1: 1 }
  for (const algo of [squarify, binarySplit]) {
    const cells = algo(items, r)
    const area = cells.reduce((s, c) => s + (c.x1 - c.x0) * (c.z1 - c.z0), 0)
    assert.ok(Math.abs(area - 2) < 1e-6, `${algo.name} area ${area}`)
    for (const c of cells) assert.ok(Math.abs((c.x1 - c.x0) * (c.z1 - c.z0) - 2 * c.item.weight / 12.5) < 1e-6, `${algo.name} proportional`)
  }
})
