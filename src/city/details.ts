/**
 * Rooftop plant (vents, water tanks) and model trees, generated
 * deterministically from the city layout. Pure and import-free so the light
 * bake (tools/repo-to-city/light-bake.mjs, Node) places exactly the same props
 * the app draws, and can bake their contact shadows.
 */
export const MAX_ROOF_BITS = 200;
export const MAX_TREES = 260;
/** Trees stand on the district plates, this high (city units). */
export const TREE_BASE_Y = 0.01;

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}
interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface CityDetails {
  /** Owning building index per rooftop box. */
  roofBitOf: Int16Array;
  /** Per rooftop box: offset x, offset z (from the building centre), width, depth, height. */
  roofBitBox: Float32Array;
  /** Per tree: x, z, radius (city units); the crown is a sphere of that radius ×(1, 1.15, 1) above TREE_BASE_Y. */
  treeAt: Float32Array;
}

export function cityDetails(buildings: readonly Box[], districts: readonly Rect[], n = buildings.length): CityDetails {
  const bits: number[] = [];
  const of: number[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n && of.length < MAX_ROOF_BITS; i++) {
    const b = buildings[i];
    if (b.w < 0.06 || b.d < 0.06) continue;
    const count = 1 + Math.floor(rnd() * Math.min(3, (b.w * b.d) / 0.004));
    for (let k = 0; k < count && of.length < MAX_ROOF_BITS; k++) {
      const sw = 0.012 + rnd() * 0.02, sd = 0.012 + rnd() * 0.02, sh = 0.008 + rnd() * 0.014;
      const ox = (rnd() - 0.5) * (b.w - sw - 0.012), oz = (rnd() - 0.5) * (b.d - sd - 0.012);
      bits.push(ox, oz, sw, sd, sh);
      of.push(i);
    }
  }
  // trees on a jittered grid inside districts, clear of buildings
  const pts: number[] = [];
  const step = 0.034;
  for (const d of districts) {
    for (let x = d.x - d.w / 2 + 0.014; x < d.x + d.w / 2 - 0.012; x += step) {
      for (let z = d.z - d.d / 2 + 0.014; z < d.z + d.d / 2 - 0.012; z += step) {
        const px = x + (rnd() - 0.5) * 0.012, pz = z + (rnd() - 0.5) * 0.012;
        let clear = true;
        for (let i = 0; i < n && clear; i++) {
          const b = buildings[i];
          if (Math.abs(px - b.x) < b.w / 2 + 0.013 && Math.abs(pz - b.z) < b.d / 2 + 0.013) clear = false;
        }
        if (clear && pts.length / 3 < MAX_TREES) pts.push(px, pz, 0.006 + rnd() * 0.005);
      }
    }
  }
  return { roofBitOf: Int16Array.from(of), roofBitBox: Float32Array.from(bits), treeAt: Float32Array.from(pts) };
}
