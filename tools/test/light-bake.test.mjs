// The baked light atlas (tools/repo-to-city/light-bake.mjs) on a one-building city.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { bakeLight, encodePng } from '../repo-to-city/light-bake.mjs'
import { ATLAS, GROUND_HALF, GROUND_PX, MAX_LIT_BUILDINGS, SUN_DIR, tileOrigin } from '../../src/city/light-layout.ts'

const city = { buildings: [{ x: 0, z: 0, w: 0.1, d: 0.1, h: 0.3 }], districts: [] }
const { rgba } = bakeLight(city)
const ground = (x, z) => {
  const gx = Math.round(((x + GROUND_HALF) / (2 * GROUND_HALF)) * (GROUND_PX - 1))
  const gy = Math.round(((z + GROUND_HALF) / (2 * GROUND_HALF)) * (GROUND_PX - 1))
  const i = (gy * ATLAS + gx) * 4
  return { ao: rgba[i] / 255, sun: rgba[i + 1] / 255 }
}
const s = Math.hypot(...SUN_DIR)
const away = [-SUN_DIR[0] / s, -SUN_DIR[2] / s]

test('the shadow falls on the side away from the sun, the sun side is lit', () => {
  assert.ok(ground(away[0] * 0.12, away[1] * 0.12).sun < 0.2)
  assert.ok(ground(-away[0] * 0.12, -away[1] * 0.12).sun > 0.95)
})

test('contact AO: ground darkens next to the wall, and is untouched far away', () => {
  const near = ground(-away[0] * 0.058, -away[1] * 0.058).ao
  assert.ok(near < 0.8, `near ${near}`)
  assert.ok(ground(0.45, 0.45).ao > 0.98)
})

test('a wall is darker at its foot than at its top', () => {
  const [tx, ty] = tileOrigin(0, 0)
  const at = (l) => rgba[((ty + l) * ATLAS + tx + 8) * 4] / 255
  assert.ok(at(0) < at(15) - 0.2, `${at(0)} vs ${at(15)}`)
})

test('atlas tiles stay inside the atlas and never overlap the ground or each other', () => {
  const seen = new Set()
  for (let i = 0; i < MAX_LIT_BUILDINGS; i++) {
    for (let f = 0; f < 5; f++) {
      const [x, y] = tileOrigin(i, f)
      assert.ok(x >= GROUND_PX && x + 16 <= ATLAS && y >= 0 && y + 16 <= ATLAS)
      const k = `${x},${y}`
      assert.ok(!seen.has(k))
      seen.add(k)
    }
  }
})

test('PNG encoder writes a valid header', () => {
  const png = encodePng(2, 2, new Uint8Array(16).fill(255))
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.ok(fs.existsSync('public/cities/semver.light.ktx2'))
})
