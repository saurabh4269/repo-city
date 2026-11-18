import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The fix crane: a toy tower crane that swaps the broken floor for a new one
 * on "Run the tests". One merged geometry, one material = one draw call.
 *
 * Local frame (unit height 1, scaled by the crane's height): the mast stands at
 * the origin, the jib points along +z. The trolley, cable and hook move in the
 * vertex shader (`uTrolley` along the jib, `uDrop` down the cable), so nothing
 * is rebuilt per frame.
 */
export const JIB_TOP = 1.0;
/** Bottom of the hook block below the jib when uDrop = 0 (local units). */
export const HOOK_REST = 0.93;
export const JIB_LEN = 0.75;

export class Crane {
  readonly mesh: Mesh;
  private uniforms = { uTrolley: { value: 0 }, uDrop: { value: 0 } };

  constructor() {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTrolley = this.uniforms.uTrolley;
      shader.uniforms.uDrop = this.uniforms.uDrop;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTrolley;\nattribute float aDrop;\nuniform float uTrolley;\nuniform float uDrop;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += uTrolley * aTrolley;\ntransformed.y -= uDrop * aDrop;');
    };
    this.mesh = new Mesh(makeCraneGeometry(), mat);
    this.mesh.name = 'fix-crane';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** Hook position: `trolley` along the jib and the hook bottom at `hookY`, both local units. */
  setHook(trolley: number, hookY: number): void {
    this.uniforms.uTrolley.value = trolley;
    this.uniforms.uDrop.value = Math.max(0, HOOK_REST - hookY);
  }
}

function makeCraneGeometry(): BufferGeometry {
  const yellow = '#f2b81c', dark = '#3a3d40', grey = '#8a8f94';
  const part = (w: number, h: number, d: number, x: number, y0: number, z: number, hex: string, trolley = 0, drop: 'none' | 'all' | 'bottom' = 'none'): BufferGeometry => {
    const g = new BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y0 + h / 2, z);
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position');
    const c = new Color(hex);
    const col = new Float32Array(pos.count * 3);
    const tr = new Float32Array(pos.count).fill(trolley);
    const dr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      // a little baked shade toward the foot of each part
      const ao = 0.82 + 0.18 * (pos.getY(i) > y0 + h / 2 ? 1 : 0);
      col[i * 3] = c.r * ao;
      col[i * 3 + 1] = c.g * ao;
      col[i * 3 + 2] = c.b * ao;
      dr[i] = drop === 'all' ? 1 : drop === 'bottom' && pos.getY(i) < y0 + h / 2 ? 1 : 0;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('aTrolley', new BufferAttribute(tr, 1));
    g.setAttribute('aDrop', new BufferAttribute(dr, 1));
    return g;
  };
  const parts = [
    part(0.17, 0.03, 0.17, 0, 0, 0, grey), // foot
    part(0.06, JIB_TOP, 0.06, 0, 0, 0, yellow), // mast
  ];
  // lattice rungs on the mast
  for (let k = 1; k < 9; k++) parts.push(part(0.072, 0.012, 0.072, 0, k * 0.11, 0, dark));
  parts.push(
    part(0.09, 0.07, 0.1, 0, JIB_TOP - 0.07, -0.05, '#e9eef2'), // cab
    part(0.03, 0.16, 0.03, 0, JIB_TOP, 0, yellow), // apex
    part(0.04, 0.04, JIB_LEN, 0, JIB_TOP, JIB_LEN / 2, yellow), // jib
    part(0.04, 0.04, 0.28, 0, JIB_TOP, -0.14, yellow), // counter-jib
    part(0.09, 0.08, 0.08, 0, JIB_TOP - 0.05, -0.24, grey), // counterweight
    part(0.06, 0.02, 0.07, 0, JIB_TOP - 0.02, 0, dark, 1), // trolley
    part(0.01, JIB_TOP - 0.02 - HOOK_REST - 0.04, 0.01, 0, HOOK_REST + 0.04, 0, dark, 1, 'bottom'), // cable (stretches)
    part(0.05, 0.04, 0.05, 0, HOOK_REST, 0, yellow, 1, 'all'), // hook block
  );
  return mergeGeometries(parts)!;
}
