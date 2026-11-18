import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import type { Building, CityData } from './types.js';
import { createBuildingMaterial, type BuildingUniforms } from './building-material.js';

/** Width of the city square on the table, metres (city units × this). */
export const CITY_SIZE = 0.46;
/** Plinth margin around the city square and its thickness, metres. */
const PLINTH_MARGIN = 0.02;
export const PLINTH_H = 0.018;
const MAX_BUILDINGS = 96;
export const MAX_FLOORS = 24;

/** Muted model-railway tints, one per district. */
const DISTRICT_TINTS = ['#8fb98a', '#e2c27f', '#8fa9cc', '#d98f74', '#ad9bd6', '#7fc0b8'].map((c) => new Color(c));
const BUILDING_BASE = new Color('#f4efe7');

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
const easeBack = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c = 1.70158, c3 = c + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/**
 * The miniature city: plinth, district plates, instanced buildings, the
 * exploded "open building" (floors = functions, a liftable roof) and lit
 * import routes. Everything lives under `root`, whose origin is the centre of
 * the plinth's top surface. `units` is scaled so 1 city unit = CITY_SIZE m.
 */
export class CityView {
  readonly root = new Group();
  readonly units = new Group();
  data: CityData | null = null;
  readonly uniforms: BuildingUniforms;

  private plinth: Mesh;
  private dust: Mesh;
  private contact: Mesh;
  private districtMesh: InstancedMesh;
  private buildingMesh: InstancedMesh;
  private aInfo: InstancedBufferAttribute;
  private aFail: InstancedBufferAttribute;

  /** Detail view: floors of the open building. */
  readonly detail = new Group();
  private floorMesh: InstancedMesh;
  private fInfo: InstancedBufferAttribute;
  private fFail: InstancedBufferAttribute;
  readonly roof: Mesh;
  private routes: Mesh;
  private routeMat: ShaderMaterial;

  /** Per building: rise progress 0..1 (the city growing out of the table). */
  private rise = new Float32Array(MAX_BUILDINGS);
  private riseDelay = new Float32Array(MAX_BUILDINGS);
  riseClock = -1;
  /** Building currently opened (-1 none) and its open amount 0..1. */
  openIndex = -1;
  open = 0;
  /** Roof lift beyond the open stack, 0..1 (the hand can pull it further). */
  roofExtra = 0;
  hoverIndex = -1;
  /** Where the opened building stands, city units: beside the city on the desk (x side set by the director). */
  inspectX = 0.66;
  inspectZ = 0.12;
  hoverFloor = -1;
  selectedFloor = -1;
  /** Fire 0..1 per building (only the failing one burns). */
  readonly fire = new Float32Array(MAX_BUILDINGS);
  /** Test sweep: buildings with index-order < sweep show a green confirmation pulse. */
  sweep = -1;
  private pulse = new Float32Array(MAX_BUILDINGS);
  private pulseMesh: InstancedMesh;

  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly c = new Color();
  /** Floor boxes of the open building in city units: [cx, cy, cz, hw, hh, hd] per floor. */
  readonly floorBoxes = new Float32Array(MAX_FLOORS * 6);
  floorCount = 0;
  /** Top of the open stack (city units, y), for the roof and labels. */
  stackTop = 0;
  shadowDirty = true;

  constructor() {
    this.root.name = 'city-root';
    this.units.scale.setScalar(CITY_SIZE);
    this.root.add(this.units);
    const { material, uniforms } = createBuildingMaterial(CITY_SIZE);
    this.uniforms = uniforms;

    // Plinth: walnut sides with a pale card top, rounded corners.
    const half = CITY_SIZE / 2 + PLINTH_MARGIN;
    const shape = roundedRect(half, 0.012);
    const plinthGeo = new ExtrudeGeometry(shape, { depth: PLINTH_H - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 6 });
    plinthGeo.rotateX(-Math.PI / 2);
    plinthGeo.translate(0, -PLINTH_H + 0.002, 0);
    this.plinth = new Mesh(plinthGeo, [
      new MeshStandardMaterial({ color: '#b9b2a6', roughness: 0.9 }),
      new MeshStandardMaterial({ color: '#4b3427', roughness: 0.55 }),
    ]);
    this.plinth.receiveShadow = true;
    this.plinth.castShadow = false;
    this.plinth.name = 'city-plinth';
    this.root.add(this.plinth);

    // Soft contact shadow on the real table (alpha in a black texture: darkens passthrough).
    this.contact = new Mesh(
      new PlaneGeometry(half * 2 + 0.12, half * 2 + 0.12),
      new MeshBasicMaterial({ map: contactTexture(), color: 0x000000, transparent: true, depthWrite: false, opacity: 0.75 }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = -PLINTH_H + 0.0008;
    this.contact.renderOrder = -1;
    this.root.add(this.contact);

    // Dust ring that rolls out across the table as the city rises.
    this.dust = new Mesh(
      new RingGeometry(0.2, 0.34, 64),
      new MeshBasicMaterial({ color: '#efe6d6', transparent: true, opacity: 0, depthWrite: false }),
    );
    this.dust.rotation.x = -Math.PI / 2;
    this.dust.position.y = -PLINTH_H + 0.002;
    this.dust.renderOrder = 2;
    this.root.add(this.dust);

    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);

    this.districtMesh = new InstancedMesh(box, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), 8);
    this.districtMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(8 * 3).fill(1), 3);
    this.districtMesh.count = 0;
    this.districtMesh.receiveShadow = true;
    this.districtMesh.name = 'city-districts';
    this.units.add(this.districtMesh);

    this.aInfo = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS * 4), 4);
    this.aFail = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS).fill(-1), 1);
    this.aInfo.setUsage(DynamicDrawUsage);
    const bGeo = box.clone();
    bGeo.setAttribute('aInfo', this.aInfo);
    bGeo.setAttribute('aFail', this.aFail);
    this.buildingMesh = new InstancedMesh(bGeo, material, MAX_BUILDINGS);
    this.buildingMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS * 3).fill(1), 3);
    this.buildingMesh.count = 0;
    this.buildingMesh.castShadow = true;
    this.buildingMesh.receiveShadow = true;
    this.buildingMesh.name = 'city-buildings';
    this.buildingMesh.frustumCulled = false;
    this.units.add(this.buildingMesh);

    // Green confirmation pulses during the test run (additive, one draw).
    this.pulseMesh = new InstancedMesh(
      box,
      new MeshBasicMaterial({ color: '#58f0a0', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      MAX_BUILDINGS,
    );
    this.pulseMesh.count = 0;
    this.pulseMesh.frustumCulled = false;
    this.pulseMesh.renderOrder = 5;
    this.units.add(this.pulseMesh);

    // Detail: floors of the open building + its roof.
    this.fInfo = new InstancedBufferAttribute(new Float32Array(MAX_FLOORS * 4), 4);
    this.fFail = new InstancedBufferAttribute(new Float32Array(MAX_FLOORS).fill(-1), 1);
    this.fInfo.setUsage(DynamicDrawUsage);
    this.fFail.setUsage(DynamicDrawUsage);
    const fGeo = box.clone();
    fGeo.setAttribute('aInfo', this.fInfo);
    fGeo.setAttribute('aFail', this.fFail);
    this.floorMesh = new InstancedMesh(fGeo, material, MAX_FLOORS);
    this.floorMesh.count = 0;
    this.floorMesh.castShadow = true;
    this.floorMesh.frustumCulled = false;
    this.floorMesh.name = 'city-floors';
    this.detail.add(this.floorMesh);
    this.roof = new Mesh(box, new MeshStandardMaterial({ color: '#cfc8bc', roughness: 0.7 }));
    this.roof.castShadow = true;
    this.roof.name = 'city-roof';
    this.detail.add(this.roof);
    this.detail.visible = false;
    this.units.add(this.detail);

    // Import routes: glowing arcs with flowing dashes.
    this.routeMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: `attribute float aT; varying float vT; varying float vSide;
        attribute float aSide;
        void main(){ vT = aT; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uOpacity; varying float vT; varying float vSide;
        void main(){
          float dash = 0.55 + 0.45 * smoothstep(0.3, 0.7, fract(vT * 6.0 - uTime * 1.2));
          float edge = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
          float ends = smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.94, vT);
          gl_FragColor = vec4(vec3(0.45, 0.8, 1.0) * 1.6, uOpacity * dash * edge * ends);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.routes = new Mesh(new BufferGeometry(), this.routeMat);
    this.routes.frustumCulled = false;
    this.routes.renderOrder = 6;
    this.units.add(this.routes);
  }

  setData(data: CityData): void {
    this.data = data;
    const n = Math.min(MAX_BUILDINGS, data.buildings.length);
    const dIndex = new Map(data.districts.map((d, i) => [d.id, i]));
    this.districtMesh.count = Math.min(8, data.districts.length);
    data.districts.slice(0, 8).forEach((d, i) => {
      this.m.compose(this.p.set(d.x, 0, d.z), this.q.identity(), this.s.set(d.w, 0.01, d.d));
      this.districtMesh.setMatrixAt(i, this.m);
      this.districtMesh.setColorAt(i, DISTRICT_TINTS[d.color % DISTRICT_TINTS.length]);
    });
    this.districtMesh.instanceMatrix.needsUpdate = true;
    if (this.districtMesh.instanceColor) this.districtMesh.instanceColor.needsUpdate = true;

    this.buildingMesh.count = n;
    for (let i = 0; i < n; i++) {
      const b = data.buildings[i];
      const di = dIndex.get(b.district) ?? 0;
      const tint = DISTRICT_TINTS[data.districts[di]?.color ?? 0];
      this.c.copy(BUILDING_BASE).lerp(tint, 0.2);
      this.buildingMesh.setColorAt(i, this.c);
      const rowsVisual = Math.max(1, Math.min(b.functions.length, Math.floor((b.h * CITY_SIZE) / 0.0075)));
      const failFloor = b.functions.findIndex((f) => f.failing);
      this.aInfo.setXYZW(i, Math.max(1, rowsVisual), 0, 0, (i * 0.618) % 1);
      // the failing function's floor, mapped onto the visual rows
      this.aFail.setX(i, failFloor < 0 ? -1 : Math.floor((failFloor / b.functions.length) * rowsVisual));
      this.fire[i] = failFloor >= 0 ? 1 : 0;
      // Rise order: from the centre outwards, plus a little noise.
      this.riseDelay[i] = Math.hypot(b.x, b.z) * 1.6 + ((i * 0.37) % 1) * 0.25;
      this.rise[i] = 0;
    }
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
    this.aInfo.needsUpdate = true;
    this.aFail.needsUpdate = true;
    this.openIndex = -1;
    this.open = 0;
    this.detail.visible = false;
    this.setRoutes(-1);
    this.writeBuildings();
  }

  /** Start the rise animation (city grows out of the table). */
  startRise(): void {
    this.riseClock = 0;
    this.rise.fill(0);
  }

  /** Skip the rise (presets, 2D page). */
  finishRise(): void {
    this.riseClock = -1;
    this.plinth.scale.set(1, 1, 1);
    (this.dust.material as MeshBasicMaterial).opacity = 0;
    this.rise.fill(1);
    this.writeBuildings();
  }

  get rising(): boolean {
    return this.riseClock >= 0;
  }

  update(dt: number, time: number): void {
    this.uniforms.uTime.value = time;
    this.routeMat.uniforms.uTime.value = time;
    const data = this.data;
    if (!data) return;
    let moved = false;
    if (this.riseClock >= 0) {
      this.riseClock += dt;
      // the plinth grows out of the table first, then dust rolls out
      const pk = ease(Math.min(1, this.riseClock / 0.45));
      this.plinth.scale.set(0.96 + 0.04 * pk, Math.max(0.02, pk), 0.96 + 0.04 * pk);
      const dk = Math.min(1, Math.max(0, (this.riseClock - 0.25) / 1.6));
      this.dust.scale.setScalar(0.8 + dk * 1.1);
      (this.dust.material as MeshBasicMaterial).opacity = dk > 0 && dk < 1 ? 0.45 * Math.sin(Math.PI * dk) : 0;
      let done = true;
      for (let i = 0; i < this.buildingMesh.count; i++) {
        const t = (this.riseClock - 0.3 - this.riseDelay[i]) / 0.9;
        this.rise[i] = easeBack(t);
        if (t < 1) done = false;
      }
      if (done) this.riseClock = -1;
      moved = true;
    }
    // hover glow and fire on the building instances
    const n = this.buildingMesh.count;
    for (let i = 0; i < n; i++) {
      const target = i === this.hoverIndex && i !== this.openIndex ? 1 : 0;
      const cur = this.aInfo.getZ(i);
      const next = cur + (target - cur) * Math.min(1, dt * 12);
      if (Math.abs(next - cur) > 1e-4) {
        this.aInfo.setZ(i, next);
        this.aInfo.needsUpdate = true;
      }
      if (Math.abs(this.aInfo.getY(i) - this.fire[i]) > 1e-4) {
        this.aInfo.setY(i, this.fire[i]);
        this.aInfo.needsUpdate = true;
      }
    }
    // pulses during the test sweep
    let pc = 0;
    for (let i = 0; i < n; i++) {
      if (this.pulse[i] <= 0) continue;
      this.pulse[i] = Math.max(0, this.pulse[i] - dt * 1.4);
      const b = data.buildings[i];
      const k = 1 + (1 - this.pulse[i]) * 0.25;
      this.m.compose(this.p.set(b.x, 0, b.z), this.q.identity(), this.s.set(b.w * k, b.h * this.rise[i] * k + 0.004, b.d * k));
      this.pulseMesh.setMatrixAt(pc++, this.m);
    }
    this.pulseMesh.count = pc;
    (this.pulseMesh.material as MeshBasicMaterial).opacity = 0.45;
    if (pc) this.pulseMesh.instanceMatrix.needsUpdate = true;

    if (moved) this.writeBuildings();
    this.updateDetail();
  }

  pulseBuilding(i: number): void {
    if (i >= 0 && i < MAX_BUILDINGS) this.pulse[i] = 1;
  }

  private writeBuildings(): void {
    const data = this.data;
    if (!data) return;
    for (let i = 0; i < this.buildingMesh.count; i++) {
      const b = data.buildings[i];
      const r = this.rise[i];
      const hidden = i === this.openIndex && this.open > 0.001;
      const h = Math.max(0.0001, b.h * r);
      const fp = 0.4 + 0.6 * Math.min(1, r * 1.5);
      this.m.compose(this.p.set(b.x, 0, b.z), this.q.identity(), this.s.set(hidden ? 0.0001 : b.w * fp, hidden ? 0.0001 : h, hidden ? 0.0001 : b.d * fp));
      this.buildingMesh.setMatrixAt(i, this.m);
    }
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    this.shadowDirty = true;
  }

  /** Open a building (or -1 to close). The open amount animates from the director. */
  setOpen(i: number): void {
    if (i === this.openIndex) return;
    this.openIndex = i;
    this.open = 0;
    this.roofExtra = 0;
    this.selectedFloor = -1;
    this.hoverFloor = -1;
    this.floorCount = 0;
    if (i < 0 || !this.data) {
      this.detail.visible = false;
      this.writeBuildings();
      return;
    }
    const b = this.data.buildings[i];
    const nf = Math.min(MAX_FLOORS, b.functions.length);
    this.floorCount = nf;
    this.floorMesh.count = nf;
    for (let f = 0; f < nf; f++) {
      this.fInfo.setXYZW(f, 1, 0, 0, (i * 0.618 + f * 0.13) % 1);
      this.fFail.setX(f, b.functions[f].failing ? 0 : -1);
    }
    this.fInfo.needsUpdate = true;
    this.fFail.needsUpdate = true;
    this.detail.visible = true;
    this.writeBuildings();
  }

  /** Geometry of the exploded view at the current `open` amount. */
  private updateDetail(): void {
    const data = this.data;
    const i = this.openIndex;
    if (!data || i < 0) return;
    const b = data.buildings[i];
    const nf = this.floorCount;
    const p = ease(Math.min(1, this.open));
    // Footprint grows so a floor is ~11 cm wide; the stack stays under ~0.5 units (23 cm).
    const K = 1 + (Math.max(1, Math.min(3.2, 0.24 / Math.max(b.w, b.d))) - 1) * p;
    const w = b.w * K, d = b.d * K;
    let total = 0;
    for (let f = 0; f < nf; f++) total += Math.max(1, b.functions[f].lines);
    const stackClosed = b.h;
    const gap = 0.034 * p;
    const minT = 0.022;
    const stackOpen = Math.min(0.62, Math.max(b.h * 1.5, nf * (minT + 0.034)));
    const stack = stackClosed + (stackOpen - stackClosed) * p;
    const usable = Math.max(0.01, stack - gap * Math.max(0, nf - 1));
    // The building slides out of the city onto the desk beside it (and down to the table top).
    const ox = b.x + (this.inspectX - b.x) * p;
    const oz = b.z + (this.inspectZ - b.z) * p;
    let y = (-PLINTH_H / CITY_SIZE) * p;
    const thinFloor = minT * p;
    const share = Math.max(0, usable - thinFloor * nf);
    for (let f = 0; f < nf; f++) {
      const t = thinFloor + (share * Math.max(1, b.functions[f].lines)) / total;
      const sel = f === this.selectedFloor ? 1 : 0;
      const hov = f === this.hoverFloor ? 1 : 0;
      // the selected floor slides out toward the viewer a little
      const slide = (sel * 0.05 + hov * 0.015) * p;
      this.m.compose(this.p.set(ox, y, oz + slide), this.q.identity(), this.s.set(w, t, d));
      this.floorMesh.setMatrixAt(f, this.m);
      const o = f * 6;
      this.floorBoxes[o] = ox;
      this.floorBoxes[o + 1] = y + t / 2;
      this.floorBoxes[o + 2] = oz + slide;
      this.floorBoxes[o + 3] = w / 2;
      this.floorBoxes[o + 4] = t / 2;
      this.floorBoxes[o + 5] = d / 2;
      this.fInfo.setY(f, b.functions[f].failing ? this.fire[i] : 0);
      this.fInfo.setZ(f, Math.max(sel * 0.8, hov));
      y += t + gap;
    }
    this.fInfo.needsUpdate = true;
    this.floorMesh.instanceMatrix.needsUpdate = true;
    this.stackTop = y - gap;
    const roofT = 0.008;
    const lift = (0.05 + this.roofExtra * 0.1) * p;
    this.roof.position.set(ox, this.stackTop + lift, oz);
    this.roof.scale.set(w * 1.04, roofT, d * 1.04);
    this.roof.rotation.x = -0.25 * p;
    this.shadowDirty = true;
  }

  /** Index of the building whose volume contains (or is near) a city-unit point, or -1. */
  buildingAt(x: number, y: number, z: number, margin = 0.025): number {
    const data = this.data;
    if (!data) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.buildingMesh.count; i++) {
      const b = data.buildings[i];
      const dx = Math.max(0, Math.abs(x - b.x) - b.w / 2);
      const dz = Math.max(0, Math.abs(z - b.z) - b.d / 2);
      const top = b.h * this.rise[i];
      const dy = y > top ? y - top : y < -0.01 ? -0.01 - y : 0;
      const dist = Math.hypot(dx, dy * 0.7, dz);
      if (dist <= margin && dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    return best;
  }

  /** Floor of the open building at a city-unit point, or -1. */
  floorAt(x: number, y: number, z: number, margin = 0.02): number {
    let best = -1;
    let bestD = Infinity;
    for (let f = 0; f < this.floorCount; f++) {
      const o = f * 6;
      const dx = Math.max(0, Math.abs(x - this.floorBoxes[o]) - this.floorBoxes[o + 3]);
      const dy = Math.max(0, Math.abs(y - this.floorBoxes[o + 1]) - this.floorBoxes[o + 4]);
      const dz = Math.max(0, Math.abs(z - this.floorBoxes[o + 2]) - this.floorBoxes[o + 5]);
      const dist = Math.hypot(dx, dy * 1.5, dz);
      if (dist <= margin && dist < bestD) {
        bestD = dist;
        best = f;
      }
    }
    return best;
  }

  /** World position of a building's roof centre (or of a floor of the open building). */
  roofWorld(i: number, out: Vector3): Vector3 {
    const b = this.data!.buildings[i];
    out.set(b.x, b.h * (this.rise[i] || 1), b.z);
    return this.units.localToWorld(out);
  }

  floorWorld(f: number, out: Vector3, front = false): Vector3 {
    const o = f * 6;
    out.set(this.floorBoxes[o], this.floorBoxes[o + 1], this.floorBoxes[o + 2] + (front ? this.floorBoxes[o + 5] : 0));
    return this.units.localToWorld(out);
  }

  building(i: number): Building | undefined {
    return this.data?.buildings[i];
  }

  indexOf(id: string): number {
    return this.data ? this.data.buildings.findIndex((b) => b.id === id) : -1;
  }

  /** Lit routes from building i to the files it imports (and to its importers). */
  setRoutes(i: number): void {
    const data = this.data;
    const geo = this.routes.geometry;
    if (!data || i < 0) {
      this.routeMat.uniforms.uOpacity.value = 0;
      return;
    }
    const b = data.buildings[i];
    const targets: Building[] = [];
    for (const id of b.imports) {
      const t = data.buildings.find((x) => x.id === id);
      if (t && t !== b) targets.push(t);
    }
    for (const s of data.streets) {
      if (s.to === b.id) {
        const t = data.buildings.find((x) => x.id === s.from);
        if (t && t !== b && !targets.includes(t)) targets.push(t);
      }
    }
    const SEG = 20;
    const pos: number[] = [];
    const tt: number[] = [];
    const side: number[] = [];
    const idx: number[] = [];
    const W = 0.006;
    for (const t of targets.slice(0, 24)) {
      const ax = b.x, az = b.z, bx = t.x, bz = t.z;
      const len = Math.hypot(bx - ax, bz - az);
      const peak = 0.06 + len * 0.35;
      const nx = -(bz - az) / (len || 1), nz = (bx - ax) / (len || 1);
      const base = pos.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG;
        const x = ax + (bx - ax) * u;
        const z = az + (bz - az) * u;
        const y = 0.01 + Math.sin(Math.PI * u) * peak + (1 - u) * 0.002;
        pos.push(x + nx * W, y, z + nz * W, x - nx * W, y, z - nz * W);
        tt.push(u, u);
        side.push(1, -1);
        if (k < SEG) {
          const a = base + k * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aT', new BufferAttribute(new Float32Array(tt), 1));
    geo.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
    geo.setIndex(idx);
    this.routeMat.uniforms.uOpacity.value = targets.length ? 0.8 : 0;
  }

  setRouteOpacity(v: number): void {
    this.routeMat.uniforms.uOpacity.value = v;
  }

  /** For shadow-camera fitting and tests. */
  get object(): Object3D {
    return this.root;
  }
}

function roundedRect(half: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.quadraticCurveTo(half, -half, half, -half + r);
  s.lineTo(half, half - r);
  s.quadraticCurveTo(half, half, half - r, half);
  s.lineTo(-half + r, half);
  s.quadraticCurveTo(-half, half, -half, half - r);
  s.lineTo(-half, -half + r);
  s.quadraticCurveTo(-half, -half, -half + r, -half);
  return s;
}

/** A soft rounded-square shadow, alpha only (drawn black). */
function contactTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(40, 40, 176, 176);
  const t = new CanvasTexture(c);
  // use the canvas as an alpha map via the red channel copy
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let k = 0; k < img.data.length; k += 4) {
    img.data[k + 3] = img.data[k];
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 0;
  }
  ctx.filter = 'none';
  ctx.putImageData(img, 0, 0);
  t.needsUpdate = true;
  return t;
}
