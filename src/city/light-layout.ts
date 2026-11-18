/**
 * Layout of the baked light atlas (one per city, made by
 * tools/repo-to-city/light-bake.mjs; read by the city shaders). Import-free so
 * Node and the app share it. Linear data: R = ambient occlusion, G = soft sun
 * visibility (1 = lit), both 0..1.
 *
 *   x 0..255   ground: a top-down map of the plinth, city units [-GROUND_HALF, GROUND_HALF]
 *   x 256..511 one TILE×TILE tile per building face: building i, face f → tile i*5+f,
 *              16 tiles per row. Faces: 0 +x, 1 -x, 2 +z, 3 -z, 4 roof.
 * Within a tile, texel k sits at face coordinate k/(TILE-1), so bilinear
 * filtering never reads a neighbouring tile. On walls the vertical coordinate
 * is sqrt(height fraction): more texels near the foot, where the contact is.
 */
export const ATLAS = 512;
export const GROUND_PX = 256;
export const GROUND_HALF = 0.55;
export const TILE = 16;
export const TILE_COLS = 16;
export const FACES = 5;
export const MAX_LIT_BUILDINGS = Math.floor(((ATLAS / TILE) * TILE_COLS) / FACES); // 102
/** The key light's direction (toward the light) in the city's frame; the app's sun uses the same. */
export const SUN_DIR = [-0.6, 0.66, 0.2] as const;

/** Texel origin (x, y) of a building face's tile. */
export function tileOrigin(building: number, face: number): [number, number] {
  const t = building * FACES + face;
  return [GROUND_PX + (t % TILE_COLS) * TILE, Math.floor(t / TILE_COLS) * TILE];
}
