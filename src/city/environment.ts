import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from '@iwsdk/core';
import { SUN_DIR } from './light-layout.js';

/**
 * Image-based lighting made for the city instead of a generic studio light:
 * a small "room around a desk" rendered once into a 128-px PMREM (~1.5 MB, a
 * quarter of the default 256). A warm window sits exactly where the key light
 * comes from (SUN_DIR, the same direction the light bake uses), so glass and
 * glazed roofs reflect the light that casts the baked shadows; a cool fill
 * opposite, a wood floor and a pale ceiling give the bounce. In the city's
 * frame: rotate it with the city's yaw (scene.environmentRotation).
 */
export function createDeskEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const room = new Mesh(new BoxGeometry(8, 4, 8), [
    new MeshBasicMaterial({ color: new Color(0.42, 0.39, 0.36), side: BackSide }), // +x wall
    new MeshBasicMaterial({ color: new Color(0.36, 0.34, 0.32), side: BackSide }), // -x wall
    new MeshBasicMaterial({ color: new Color(0.95, 0.94, 0.92), side: BackSide }), // ceiling
    new MeshBasicMaterial({ color: new Color(0.3, 0.21, 0.15), side: BackSide }), // wood floor
    new MeshBasicMaterial({ color: new Color(0.4, 0.38, 0.35), side: BackSide }), // +z wall
    new MeshBasicMaterial({ color: new Color(0.38, 0.36, 0.34), side: BackSide }), // -z wall
  ]);
  room.position.y = 1;
  scene.add(room);
  const s = Math.hypot(...SUN_DIR);
  const dir = SUN_DIR.map((v) => v / s);
  const panel = (w: number, h: number, color: Color, dist: number, d: number[]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color }));
    m.position.set(d[0] * dist, d[1] * dist, d[2] * dist);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(2.0, 1.4, new Color(3.2, 2.9, 2.4), 3.2, dir); // the warm window the key light comes through
  panel(3.0, 1.2, new Color(0.8, 0.9, 1.05), 3.4, [-dir[0] * 0.9, 0.35, -dir[2] * 0.9]); // cool fill
  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.03, 0.1, 20, { size: 128 });
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    for (const x of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) x.dispose();
  });
  rt.texture.name = 'repo-city-desk-env';
  return rt.texture;
}
