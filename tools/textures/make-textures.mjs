#!/usr/bin/env node
/**
 * Static shadow masks as KTX2 (UASTC, linear, mipmapped), made in code:
 *   public/textures/contact.ktx2  soft rounded-square shadow under the plinth
 *   public/textures/blob.ktx2     soft radial shadow (the opened building, plaques)
 * Grey in RGB, read as `alphaMap` (green channel) on black MeshBasicMaterials.
 *   node tools/textures/make-textures.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { encodePng, findKtx } from '../repo-to-city/light-bake.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/textures')
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

function image (size, f) {
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.round(255 * Math.max(0, Math.min(1, f((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1))))
    const i = (y * size + x) * 4
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v
    rgba[i + 3] = 255
  }
  return rgba
}

// Plinth: the plane is (plinth + 12 cm) wide; the plinth covers ±0.81 of it.
const contact = image(256, (u, v) => {
  const h = 0.8, r = 0.06
  const qx = Math.abs(u) - h + r, qy = Math.abs(v) - h + r
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  // dense right at the edge, a long soft penumbra outside
  return 0.9 * (1 - smooth(-0.04, 0.03, d)) + 0.55 * (1 - smooth(-0.02, 0.19, d)) * smooth(-0.04, 0.03, d)
})
const blob = image(128, (u, v) => {
  const d = Math.hypot(u, v)
  return Math.pow(1 - smooth(0.0, 1.0, d), 1.6)
})

const ktx = findKtx()
if (!ktx) { console.error('KTX-Software (ktx) not found; set KTX=/path/to/ktx'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
for (const [name, size, rgba] of [['contact', 256, contact], ['blob', 128, blob]]) {
  const tmp = path.join(os.tmpdir(), `repo-city-${name}.png`)
  fs.writeFileSync(tmp, encodePng(size, size, rgba))
  const out = path.join(OUT, `${name}.ktx2`)
  execFileSync(ktx, ['create', '--format', 'R8G8B8A8_UNORM', '--encode', 'uastc', '--uastc-quality', '3', '--zstd', '19',
    '--assign-tf', 'linear', '--assign-primaries', 'none', '--generate-mipmap', '--mipmap-filter', 'box', tmp, out], { stdio: 'inherit' })
  fs.rmSync(tmp)
  console.log(`${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`)
}
