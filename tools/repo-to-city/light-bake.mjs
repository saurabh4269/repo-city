/**
 * Bake a city's lighting at build time: ambient occlusion (R) and soft sun
 * visibility (G) into one 512² linear atlas, laid out as src/city/light-layout.ts
 * describes. A small CPU ray tracer over the city's boxes: buildings, the
 * rooftop plant and trees (the same ones the app draws, from
 * src/city/details.ts), and the plinth top as the ground plane.
 *
 *   bakeLight(city)                 -> { width, height, rgba: Uint8Array, ms }
 *   writeLight(city, jsonFile)      -> writes <id>.light.ktx2 (or .png without toktx)
 *                                      next to the JSON and returns its file name
 *
 * No dependencies: PNG via node:zlib; KTX2 via KTX-Software's `ktx create` (UASTC,
 * box-filtered mipmaps so atlas tiles never bleed into each other).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { cityDetails, TREE_BASE_Y } from '../../src/city/details.ts'
import { ATLAS, GROUND_PX, GROUND_HALF, TILE, FACES, MAX_LIT_BUILDINGS, SUN_DIR, tileOrigin } from '../../src/city/light-layout.ts'

const AO_RAYS = 40
const AO_RADIUS = 0.11 // city units (~5 cm on the table)
const SUN_RAYS = 12
const SUN_CONE = (3.2 * Math.PI) / 180
const GROUND_Y = 0.0105 // top of the district plates
const EPS = 0.0015
/** A ground point under a building (seen only when the building is lifted out) keeps some light. */
const FOOTPRINT_AO = 0.4

/** Boxes as [minX, minY, minZ, maxX, maxY, maxZ]. */
function occluders (city) {
  const b = city.buildings.slice(0, MAX_LIT_BUILDINGS)
  const det = cityDetails(b, city.districts)
  const boxes = []
  for (const x of b) boxes.push([x.x - x.w / 2, 0, x.z - x.d / 2, x.x + x.w / 2, x.h, x.z + x.d / 2])
  for (let k = 0; k < det.roofBitOf.length; k++) {
    const p = b[det.roofBitOf[k]]
    const [ox, oz, sw, sd, sh] = det.roofBitBox.subarray(k * 5, k * 5 + 5)
    boxes.push([p.x + ox - sw / 2, p.h, p.z + oz - sd / 2, p.x + ox + sw / 2, p.h + sh, p.z + oz + sd / 2])
  }
  for (let k = 0; k < det.treeAt.length / 3; k++) {
    const x = det.treeAt[k * 3], z = det.treeAt[k * 3 + 1], r = det.treeAt[k * 3 + 2]
    const cy = TREE_BASE_Y + 1.15 * r
    boxes.push([x - 0.8 * r, cy - r, z - 0.8 * r, x + 0.8 * r, cy + r, z + 0.8 * r])
  }
  return boxes
}

/** Distance along the ray to a box (0 if starting inside), or Infinity. */
function hitBox (bx, ox, oy, oz, dx, dy, dz, tMax) {
  let t0 = 0, t1 = tMax
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz
    const d = a === 0 ? dx : a === 1 ? dy : dz
    const lo = bx[a], hi = bx[a + 3]
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity
      continue
    }
    let ta = (lo - o) / d, tb = (hi - o) / d
    if (ta > tb) { const s = ta; ta = tb; tb = s }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return Infinity
  }
  return t0
}

// Stratified unit-square samples (Hammersley), shared by every texel: smooth, noise-free gradients.
const radicalInverse = (i) => {
  let b = i, r = 0, f = 0.5
  while (b) { if (b & 1) r += f; b >>= 1; f *= 0.5 }
  return r
}
const HAM = (n) => Array.from({ length: n }, (_, i) => [(i + 0.5) / n, radicalInverse(i)])
const AO_SQ = HAM(AO_RAYS)
const SUN_SQ = HAM(SUN_RAYS)

/** Orthonormal basis around n. */
function basis (n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  let t = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]]
  const l = Math.hypot(...t)
  t = t.map((v) => v / l)
  const s = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]
  return [t, s]
}

export function bakeLight (city) {
  const t0 = performance.now()
  const boxes = occluders(city)
  const maxTop = boxes.reduce((m, b) => Math.max(m, b[4]), 0)
  const sl = Math.hypot(...SUN_DIR)
  const sun = SUN_DIR.map((v) => v / sl)
  const [sunT, sunS] = basis(sun)
  const sunDirs = SUN_SQ.map(([u, v]) => {
    const r = Math.tan(SUN_CONE) * Math.sqrt(u), a = 2 * Math.PI * v
    const d = [0, 1, 2].map((k) => sun[k] + sunT[k] * r * Math.cos(a) + sunS[k] * r * Math.sin(a))
    const l = Math.hypot(...d)
    return d.map((x) => x / l)
  })
  const rgba = new Uint8Array(ATLAS * ATLAS * 4)
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = rgba[i + 1] = rgba[i + 2] = 255; rgba[i + 3] = 255 }
  const cand = new Int32Array(boxes.length)

  /** AO and sun visibility at p with normal n (ground plane only for non-up normals). */
  function shade (p, n, withGround) {
    const [ox, oy, oz] = [p[0] + n[0] * EPS, p[1] + n[1] * EPS, p[2] + n[2] * EPS]
    // a sample inside a box (a ground point under a building) is covered
    for (const b of boxes) {
      if (ox > b[0] && ox < b[3] && oy > b[1] && oy < b[4] && oz > b[2] && oz < b[5]) return [FOOTPRINT_AO, 0]
    }
    // ---- ambient occlusion: cosine-weighted hemisphere, hits weighted by distance
    let nc = 0
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k]
      const dx = Math.max(b[0] - ox, 0, ox - b[3]), dy = Math.max(b[1] - oy, 0, oy - b[4]), dz = Math.max(b[2] - oz, 0, oz - b[5])
      if (dx * dx + dy * dy + dz * dz < AO_RADIUS * AO_RADIUS) cand[nc++] = k
    }
    const [t, s] = basis(n)
    let occ = 0
    for (const [u, v] of AO_SQ) {
      const r = Math.sqrt(u), a = 2 * Math.PI * v
      const lx = r * Math.cos(a), ly = r * Math.sin(a), lz = Math.sqrt(Math.max(0, 1 - u))
      const dx = t[0] * lx + s[0] * ly + n[0] * lz
      const dy = t[1] * lx + s[1] * ly + n[1] * lz
      const dz = t[2] * lx + s[2] * ly + n[2] * lz
      let hit = AO_RADIUS
      if (withGround && dy < -1e-6) hit = Math.min(hit, -oy / dy)
      for (let c = 0; c < nc; c++) {
        const h = hitBox(boxes[cand[c]], ox, oy, oz, dx, dy, dz, hit)
        if (h < hit) hit = h
      }
      if (hit < AO_RADIUS) { const f = hit / AO_RADIUS; occ += 1 - f * f }
    }
    const ao = 1 - occ / AO_RAYS
    // ---- sun: a few rays in a small cone (soft edges), only boxes near the sun segment
    if (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2] <= 0.0) return [ao, 1]
    const L = Math.max(0, (maxTop - oy) / sun[1]) + 0.01
    const ex = ox + sun[0] * L, ez = oz + sun[2] * L
    const grow = L * Math.tan(SUN_CONE) + 0.002
    nc = 0
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k]
      if (b[4] < oy) continue
      if (Math.max(ox, ex) < b[0] - grow || Math.min(ox, ex) > b[3] + grow) continue
      if (Math.max(oz, ez) < b[2] - grow || Math.min(oz, ez) > b[5] + grow) continue
      cand[nc++] = k
    }
    let lit = 0
    for (const d of sunDirs) {
      let blocked = false
      for (let c = 0; c < nc && !blocked; c++) if (hitBox(boxes[cand[c]], ox, oy, oz, d[0], d[1], d[2], 4) < 4) blocked = true
      if (!blocked) lit++
    }
    return [ao, lit / SUN_RAYS]
  }

  const put = (x, y, [ao, sv]) => {
    const i = (y * ATLAS + x) * 4
    rgba[i] = Math.round(Math.max(0, Math.min(1, ao)) * 255)
    rgba[i + 1] = Math.round(Math.max(0, Math.min(1, sv)) * 255)
    rgba[i + 2] = rgba[i]
  }

  // ground
  const up = [0, 1, 0]
  for (let gy = 0; gy < GROUND_PX; gy++) {
    for (let gx = 0; gx < GROUND_PX; gx++) {
      const x = -GROUND_HALF + (2 * GROUND_HALF * gx) / (GROUND_PX - 1)
      const z = -GROUND_HALF + (2 * GROUND_HALF * gy) / (GROUND_PX - 1)
      put(gx, gy, shade([x, GROUND_Y, z], up, false))
    }
  }
  // building faces
  const N = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
  city.buildings.slice(0, MAX_LIT_BUILDINGS).forEach((b, i) => {
    for (let f = 0; f < FACES; f++) {
      const [tx, ty] = tileOrigin(i, f)
      for (let l = 0; l < TILE; l++) {
        for (let k = 0; k < TILE; k++) {
          const u = 0.02 + 0.96 * (k / (TILE - 1)), v = l / (TILE - 1)
          let p
          if (f === 4) p = [b.x + (u - 0.5) * b.w, b.h, b.z + (0.02 + 0.96 * v - 0.5) * b.d]
          else {
            const y = Math.max(0.0005, v * v * b.h)
            if (f < 2) p = [b.x + (f === 0 ? 0.5 : -0.5) * b.w, y, b.z + (u - 0.5) * b.d]
            else p = [b.x + (u - 0.5) * b.w, y, b.z + (f === 2 ? 0.5 : -0.5) * b.d]
          }
          put(tx + k, ty + l, shade(p, N[f], f !== 4))
        }
      }
    }
  })
  return { width: ATLAS, height: ATLAS, rgba, ms: Math.round(performance.now() - t0), boxes: boxes.length }
}

// ---------- files

function crc32 (buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function encodePng (width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

export function findKtx () {
  const cands = [process.env.KTX, path.join(os.homedir(), '.local/ktx/bin/ktx'), 'ktx'].filter(Boolean)
  for (const c of cands) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c } catch { /* next */ }
  }
  return null
}

/**
 * Bake and write the light atlas next to the city JSON; returns its file name
 * (for city.light). KTX2 (UASTC, linear, 5 box-filtered mip levels) when
 * KTX-Software is installed, else PNG.
 */
export function writeLight (city, jsonFile, { png = false } = {}) {
  const { width, height, rgba, ms, boxes } = bakeLight(city)
  const dir = path.dirname(path.resolve(jsonFile))
  const pngBuf = encodePng(width, height, rgba)
  const ktx = findKtx()
  let name
  if (ktx && !png) {
    name = `${city.id}.light.ktx2`
    const tmp = path.join(os.tmpdir(), `repo-city-${process.pid}-${city.id}.light.png`)
    fs.writeFileSync(tmp, pngBuf)
    // 5 levels (512 → 32): a 16-px tile stays ≥ 1 px and box filtering keeps every level inside its tile
    execFileSync(ktx, ['create', '--format', 'R8G8B8A8_UNORM', '--encode', 'uastc', '--uastc-quality', '3', '--zstd', '19',
      '--assign-tf', 'linear', '--assign-primaries', 'none', '--generate-mipmap', '--mipmap-filter', 'box', '--levels', '5', tmp, path.join(dir, name)], { stdio: 'inherit' })
    fs.rmSync(tmp)
  } else {
    name = `${city.id}.light.png`
    fs.writeFileSync(path.join(dir, name), pngBuf)
  }
  const kb = fs.statSync(path.join(dir, name)).size / 1024
  console.log(`${city.id}: light baked (${boxes} occluders, ${ms} ms) -> ${name} (${kb.toFixed(0)} KB)`)
  return name
}

// CLI: node light-bake.mjs <city.json> [--png] [--preview out.png]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const file = process.argv[2]
  const city = JSON.parse(fs.readFileSync(file, 'utf8'))
  const prev = process.argv.indexOf('--preview')
  if (prev > 0) {
    const { width, height, rgba, ms } = bakeLight(city)
    fs.writeFileSync(process.argv[prev + 1], encodePng(width, height, rgba))
    console.log(`preview ${ms} ms -> ${process.argv[prev + 1]}`)
  } else {
    city.light = writeLight(city, file, { png: process.argv.includes('--png') })
    fs.writeFileSync(file, JSON.stringify(city) + '\n')
  }
}
