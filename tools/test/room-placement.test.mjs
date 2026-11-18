// Synthetic rooms for src/mr/room-placement.ts (Node strips the TypeScript types).
// Includes the Quest 3 case found on a real headset (18 Nov 2026): horizontal planes
// report their local Y axis pointing DOWN, while the IWER emulator reports it up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { findTableSpot, emptyReport, IDEAL_AHEAD } from '../../src/mr/room-placement.ts';

const head = { x: 0, y: 1.2, z: 0 };
const fwd = { x: 0, z: -1 };

/** Column-major 4x4 for a plane at (x, y, z); `down` flips local Y (rotation of 180° about X). */
function matrix(x, y, z, { down = false, tiltDeg = 0 } = {}) {
  const t = (tiltDeg * Math.PI) / 180;
  // local Y = surface normal, tilted about X by t
  let ny = [0, Math.cos(t), Math.sin(t)];
  let nz = [0, -Math.sin(t), Math.cos(t)];
  if (down) {
    ny = ny.map((v) => -v);
    nz = nz.map((v) => -v);
  }
  return [1, 0, 0, 0, ...ny, 0, ...nz, 0, x, y, z, 1];
}

const rect = (w, d) => [
  { x: -w / 2, z: -d / 2 },
  { x: w / 2, z: -d / 2 },
  { x: w / 2, z: d / 2 },
  { x: -w / 2, z: d / 2 },
];
const circle = (r, n = 24) => Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / n) * 2 * Math.PI) * r, z: Math.sin((i / n) * 2 * Math.PI) * r }));
const plane = (over) => ({ orientation: 'horizontal', label: 'table', polygon: rect(1.2, 0.7), matrix: matrix(0, 0.74, -0.6), ...over });

test('emulator table (normal up) is used, about IDEAL_AHEAD in front', () => {
  const spot = findTableSpot([plane()], head, fwd);
  assert.ok(spot);
  assert.equal(spot.kind, 'table');
  assert.ok(Math.abs(spot.y - 0.74) < 1e-6);
  assert.ok(Math.abs(-spot.z - IDEAL_AHEAD) < 0.12, `z=${spot.z}`);
});

test('Quest 3 table (normal DOWN) is used too', () => {
  const spot = findTableSpot([plane({ matrix: matrix(0, 0.74, -0.6, { down: true }) })], head, fwd);
  assert.ok(spot, 'a downward-normal table must not be rejected as slanted');
  assert.equal(spot.kind, 'table');
});

test('slanted surfaces and soft furniture are refused, with reasons', () => {
  const r = emptyReport();
  const spot = findTableSpot(
    [plane({ matrix: matrix(0, 0.74, -0.6, { tiltDeg: 12 }) }), plane({ label: 'couch' }), plane({ label: 'floor', matrix: matrix(0, 0, -0.6) })],
    head,
    fwd,
    r,
  );
  assert.equal(spot, null);
  assert.equal(r.slanted, 1);
  assert.equal(r.softOrNotATable, 1);
  assert.equal(r.floorOrCeiling, 1);
});

test('no table at all → null (the app falls back to hand placement, then a virtual desk)', () => {
  assert.equal(findTableSpot([{ orientation: 'vertical', label: 'wall', polygon: rect(3, 2), matrix: matrix(0, 1.2, -2) }], head, fwd), null);
});

test('round table: the footprint slides inside the polygon', () => {
  const spot = findTableSpot([plane({ polygon: circle(0.5), matrix: matrix(0, 0.74, -0.8) })], head, fwd);
  assert.ok(spot);
  const d = Math.hypot(spot.x - 0, spot.z + 0.8);
  assert.ok(d <= 0.5 - 0.2 + 1e-3, `centre ${d.toFixed(3)} m from the middle`);
});

test('a small table still beats a floating virtual desk; a tiny one is refused', () => {
  const small = findTableSpot([plane({ polygon: rect(0.3, 0.3), matrix: matrix(0, 0.7, -0.5) })], head, fwd);
  assert.equal(small?.kind, 'small-table');
  const r = emptyReport();
  assert.equal(findTableSpot([plane({ polygon: rect(0.12, 0.12), matrix: matrix(0, 0.7, -0.5) })], head, fwd, r), null);
  assert.equal(r.tiny, 1);
});

test('a table across the room is too far', () => {
  const r = emptyReport();
  assert.equal(findTableSpot([plane({ polygon: rect(0.8, 0.6), matrix: matrix(0, 0.74, -2.5) })], head, fwd, r), null);
  assert.equal(r.tooFar, 1);
});
