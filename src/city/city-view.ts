import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
  IcosahedronGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShaderMaterial,
  Vector3,
  CylinderGeometry,
  SphereGeometry,
  ConeGeometry,
  type Texture,
} from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building, CityData } from './types.js';
import { createBuildingMaterial, patchGroundMaterial, type BuildingUniforms } from './building-material.js';
import { cityDetails, landmarkSize } from './details.js';
import { MAX_LIT_BUILDINGS } from './light-layout.js';

/** Width of the city square on the table, metres (city units × this). */
export const CITY_SIZE = 0.46;
/** Plinth margin around the city square and its thickness, metres. */
const PLINTH_MARGIN = 0.02;
export const PLINTH_H = 0.018;
const MAX_BUILDINGS = 96;
export const MAX_FLOORS = 24;
const FIXED_GREEN = new Color('#5fe39a');
/** Hotspot score from which a building gets scaffolding (about the top 15%). */
export const HOT_SCAFFOLD = 0.6;
const MAX_SCAFFOLD = 48;
const Y_AXIS = new Vector3(0, 1, 0);

/** Muted model-railway tints, one per district. */
export const DISTRICT_TINTS_HEX = ['#8fb98a', '#e2c27f', '#8fa9cc', '#d98f74', '#ad9bd6', '#7fc0b8'];
const DISTRICT_TINTS = DISTRICT_TINTS_HEX.map((c) => new Color(c));
/** Roof roughness per district tint: glazed tiles, painted metal, gravel… (lower = more sheen). */
const DISTRICT_ROOF_ROUGH = [0.5, 0.64, 0.4, 0.72, 0.52, 0.46];
const BUILDING_BASE = new Color('#f4efe7');
const PLATE_CARD = new Color('#d9d3c8');

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
  /** Rooftop plant (vents, water tanks) and model trees: one instanced draw each. */
  private roofBits: InstancedMesh;
  /** Scaffolding on hot spots: one instance per scaffolded face (building index, face 0 = front, 1 = outer side). */
  private scaffold: InstancedMesh;
  private scaffoldOf: number[] = [];
  private aHot: InstancedBufferAttribute;
  private roofBitOf: Int16Array = new Int16Array(0);
  private roofBitBox: Float32Array = new Float32Array(0);
  private trees: InstancedMesh;
  private treeAt: Float32Array = new Float32Array(0);
  private dust: Mesh;
  private contact: Mesh;
  private districtMesh: InstancedMesh;
  private buildingMesh: InstancedMesh;
  private aInfo: InstancedBufferAttribute;
  private aFail: InstancedBufferAttribute;
  private aRoof: InstancedBufferAttribute;
  private aMat: InstancedBufferAttribute;
  private aTile: InstancedBufferAttribute;
  private fRoof: InstancedBufferAttribute;
  private fMat: InstancedBufferAttribute;
  private stackShadow: Mesh;
  /** The entry building's dome (one merged, vertex-coloured mesh). */
  private landmark: Mesh;
  /** Index of the package's entry building (-1 none). */
  entryIndex = -1;

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
  /** The crane's slab: floor `f` of the open stack moved by (dx, dy, dz) city units and scaled by s (-1 = none). */
  readonly craneSlab = { f: -1, dx: 0, dy: 0, dz: 0, s: 1 };
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
    // card top (reads the baked ground light) and oiled walnut sides (a soft sheen from the environment)
    const plinthTop = new MeshStandardMaterial({ color: '#bdb6aa', roughness: 0.88 });
    patchGroundMaterial(plinthTop, this.uniforms, 1 / CITY_SIZE, 'plinth');
    this.plinth = new Mesh(plinthGeo, [plinthTop, new MeshStandardMaterial({ color: '#4b3427', roughness: 0.42 })]);
    this.plinth.name = 'city-plinth';
    this.root.add(this.plinth);

    // Soft contact shadow on the real table: a black plane whose alpha (a KTX2 mask, setMasks) darkens passthrough.
    this.contact = new Mesh(
      new PlaneGeometry(half * 2 + 0.12, half * 2 + 0.12),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    this.contact.visible = false;
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

    const districtMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    patchGroundMaterial(districtMat, this.uniforms, 1, 'district');
    this.districtMesh = new InstancedMesh(box, districtMat, 8);
    this.districtMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(8 * 3).fill(1), 3);
    this.districtMesh.count = 0;
    this.districtMesh.name = 'city-districts';
    // an InstancedMesh's bounds are computed lazily, once, while count is still 0: never cull it
    this.districtMesh.frustumCulled = false;
    this.units.add(this.districtMesh);

    // Small props carry their own baked AO as vertex colours (darker toward where they meet a surface).
    this.roofBits = new InstancedMesh(withHeightAO(box.clone(), 0, 1, 0.5), new MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.75, vertexColors: true }), 200);
    this.roofBits.count = 0;
    this.roofBits.frustumCulled = false;
    this.units.add(this.roofBits);
    this.trees = new InstancedMesh(
      withHeightAO(new IcosahedronGeometry(1, 1).translate(0, 1, 0), 0, 2, 0.42),
      new MeshStandardMaterial({ color: '#9fb88e', roughness: 0.95, flatShading: true, vertexColors: true }),
      260,
    );
    this.trees.count = 0;
    this.trees.frustumCulled = false;
    this.units.add(this.trees);

    this.aInfo = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS * 4), 4);
    this.aFail = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS).fill(-1), 1);
    this.aInfo.setUsage(DynamicDrawUsage);
    this.aRoof = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS * 3).fill(0.9), 3);
    this.aMat = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS).fill(0.6), 1);
    this.aTile = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS).fill(-1), 1);
    this.aHot = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS), 1);
    const bGeo = box.clone();
    bGeo.setAttribute('aHot', this.aHot);
    bGeo.setAttribute('aRoof', this.aRoof);
    bGeo.setAttribute('aMat', this.aMat);
    bGeo.setAttribute('aTile', this.aTile);
    bGeo.setAttribute('aInfo', this.aInfo);
    bGeo.setAttribute('aFail', this.aFail);
    this.buildingMesh = new InstancedMesh(bGeo, material, MAX_BUILDINGS);
    this.buildingMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS * 3).fill(1), 3);
    this.buildingMesh.count = 0;
    this.buildingMesh.name = 'city-buildings';
    this.buildingMesh.frustumCulled = false;
    this.units.add(this.buildingMesh);

    this.scaffold = new InstancedMesh(makeScaffoldGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }), MAX_SCAFFOLD);
    this.scaffold.count = 0;
    this.scaffold.frustumCulled = false;
    this.scaffold.name = 'city-scaffolding';
    this.units.add(this.scaffold);

    this.landmark = new Mesh(makeLandmarkGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.25 }));
    this.landmark.name = 'city-landmark';
    this.landmark.visible = false;
    this.units.add(this.landmark);

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
    this.fRoof = new InstancedBufferAttribute(new Float32Array(MAX_FLOORS * 3).fill(0.9), 3);
    this.fMat = new InstancedBufferAttribute(new Float32Array(MAX_FLOORS).fill(0.6), 1);
    const fGeo = box.clone();
    fGeo.setAttribute('aRoof', this.fRoof);
    fGeo.setAttribute('aMat', this.fMat);
    // the floors are not in the bake (they move): tile -1
    fGeo.setAttribute('aTile', new InstancedBufferAttribute(new Float32Array(MAX_FLOORS).fill(-1), 1));
    fGeo.setAttribute('aInfo', this.fInfo);
    fGeo.setAttribute('aHot', new InstancedBufferAttribute(new Float32Array(MAX_FLOORS), 1));
    fGeo.setAttribute('aFail', this.fFail);
    this.floorMesh = new InstancedMesh(fGeo, material, MAX_FLOORS);
    this.floorMesh.count = 0;
    this.floorMesh.frustumCulled = false;
    this.floorMesh.name = 'city-floors';
    this.detail.add(this.floorMesh);
    this.roof = new Mesh(box, new MeshStandardMaterial({ color: '#cfc8bc', roughness: 0.5 }));
    this.roof.name = 'city-roof';
    this.detail.add(this.roof);
    // a soft blob shadow where the opened building stands on the desk
    this.stackShadow = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: 0.7 }));
    this.stackShadow.renderOrder = -1;
    this.stackShadow.visible = false;
    this.detail.add(this.stackShadow);
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
      // plates read as tinted card: the tint, muted toward the plinth top
      this.districtMesh.setColorAt(i, this.c.copy(DISTRICT_TINTS[d.color % DISTRICT_TINTS.length]).lerp(PLATE_CARD, 0.35));
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
      this.c.copy(tint).lerp(BUILDING_BASE, 0.15);
      this.aRoof.setXYZ(i, this.c.r, this.c.g, this.c.b);
      this.aMat.setX(i, DISTRICT_ROOF_ROUGH[(data.districts[di]?.color ?? 0) % DISTRICT_ROOF_ROUGH.length]);
      this.aTile.setX(i, i < MAX_LIT_BUILDINGS ? i : -1);
      this.aHot.setX(i, b.history?.hot ?? 0);
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
    this.aHot.needsUpdate = true;
    this.scaffoldOf = [];
    for (let i = 0; i < n && this.scaffoldOf.length < MAX_SCAFFOLD - 1; i++) if ((data.buildings[i].history?.hot ?? 0) >= HOT_SCAFFOLD) this.scaffoldOf.push(i, i);
    this.scaffold.count = this.scaffoldOf.length;
    this.aFail.needsUpdate = true;
    this.aRoof.needsUpdate = true;
    this.aMat.needsUpdate = true;
    this.aTile.needsUpdate = true;
    this.setLight(null); // until this city's bake loads
    this.entryIndex = data.entry ? data.buildings.slice(0, n).findIndex((b) => b.id === data.entry) : -1;
    this.openIndex = -1;
    this.open = 0;
    this.detail.visible = false;
    this.setRoutes(-1);
    this.buildDetails(data, n);
    this.writeBuildings();
  }

  /** Deterministic rooftop plant on bigger buildings, and trees in the open parts of each district (shared with the light bake). */
  private buildDetails(data: CityData, n: number): void {
    const det = cityDetails(data.buildings, data.districts, n, this.entryIndex);
    this.roofBitOf = det.roofBitOf;
    this.roofBitBox = det.roofBitBox;
    this.roofBits.count = det.roofBitOf.length;
    this.treeAt = det.treeAt;
    this.trees.count = det.treeAt.length / 3;
  }

  /** The city's baked light atlas (null: none, plain lighting). */
  setLight(tex: Texture | null): void {
    this.uniforms.uLight.value = tex;
    this.uniforms.uLightOn.value = tex ? 1 : 0;
  }

  /** Shadow masks (KTX2): the plinth's contact shadow and the round blob. */
  setMasks(contact: Texture, blob: Texture): void {
    const c = this.contact.material as MeshBasicMaterial;
    c.alphaMap = contact;
    c.needsUpdate = true;
    this.contact.visible = true;
    const b = this.stackShadow.material as MeshBasicMaterial;
    b.alphaMap = blob;
    b.needsUpdate = true;
    this.blob = blob;
  }

  /** The blob mask, for other props' contact shadows (plaques). */
  blob: Texture | null = null;

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
    for (let k = 0; k < this.roofBits.count; k++) {
      const i = this.roofBitOf[k];
      const b = data.buildings[i];
      const r = this.rise[i];
      const o = k * 5;
      const vis = r > 0.95 && !(i === this.openIndex && this.open > 0.001) ? 1 : 0.0001;
      this.m.compose(this.p.set(b.x + this.roofBitBox[o], b.h * r, b.z + this.roofBitBox[o + 1]), this.q.identity(), this.s.set(this.roofBitBox[o + 2] * vis, this.roofBitBox[o + 4] * vis, this.roofBitBox[o + 3] * vis));
      this.roofBits.setMatrixAt(k, this.m);
    }
    this.roofBits.instanceMatrix.needsUpdate = true;
    // scaffolding on the front face and the outer side, from the ground to 60% of the height
    for (let k = 0; k < this.scaffold.count; k++) {
      const i = this.scaffoldOf[k];
      const b = data.buildings[i];
      const r = this.rise[i];
      const fp = 0.4 + 0.6 * Math.min(1, r * 1.5);
      const vis = r > 0.3 && !(i === this.openIndex && this.open > 0.001) ? 1 : 0.0001;
      const h = Math.max(0.0001, b.h * r * 0.6) * vis;
      if (k % 2 === 0) {
        this.m.compose(this.p.set(b.x, 0, b.z + (b.d * fp) / 2), this.q.identity(), this.s.set(b.w * fp * vis, h, 0.012 * vis));
      } else {
        const sx = b.x < 0 ? -1 : 1;
        this.q.setFromAxisAngle(Y_AXIS, (sx * Math.PI) / 2);
        this.m.compose(this.p.set(b.x + (sx * b.w * fp) / 2, 0, b.z), this.q, this.s.set(b.d * fp * vis, h, 0.012 * vis));
        this.q.identity();
      }
      this.scaffold.setMatrixAt(k, this.m);
    }
    this.scaffold.instanceMatrix.needsUpdate = true;
    const e = this.entryIndex;
    if (e >= 0) {
      const b = data.buildings[e];
      const r = this.rise[e];
      const { r: lr } = landmarkSize(b);
      // the dome grows in as its building finishes rising; it leaves with the building when that one is opened
      const k = Math.max(0, Math.min(1, (r - 0.85) / 0.15));
      this.landmark.visible = k > 0.001 && !(e === this.openIndex && this.open > 0.001);
      this.landmark.position.set(b.x, b.h * r, b.z);
      this.landmark.scale.set(lr * k, lr * k, lr * k);
    } else this.landmark.visible = false;
    let avg = 0;
    for (let i = 0; i < this.buildingMesh.count; i++) avg += this.rise[i];
    avg = this.buildingMesh.count ? Math.min(1, avg / this.buildingMesh.count) : 1;
    // baked shadows and AO grow in with the city
    this.uniforms.uRise.value = avg * avg;
    for (let k = 0; k < this.trees.count; k++) {
      const r = this.treeAt[k * 3 + 2] * Math.max(0.0001, avg);
      this.m.compose(this.p.set(this.treeAt[k * 3], 0.01, this.treeAt[k * 3 + 1]), this.q.identity(), this.s.set(r, r * 1.15, r));
      this.trees.setMatrixAt(k, this.m);
    }
    this.trees.instanceMatrix.needsUpdate = true;
    this.shadowDirty = true;
  }

  /** Open a building (or -1 to close). The open amount animates from the director. */
  setOpen(i: number): void {
    if (i === this.openIndex) return;
    this.openIndex = i;
    this.craneSlab.f = -1;
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
    const di = this.data.districts.find((x) => x.id === b.district);
    this.c.copy(DISTRICT_TINTS[(di?.color ?? 0) % DISTRICT_TINTS.length]).lerp(BUILDING_BASE, 0.15);
    for (let f = 0; f < nf; f++) {
      this.fRoof.setXYZ(f, this.c.r, this.c.g, this.c.b);
      this.fMat.setX(f, DISTRICT_ROOF_ROUGH[(di?.color ?? 0) % DISTRICT_ROOF_ROUGH.length]);
      this.fInfo.setXYZW(f, 1, 0, 0, (i * 0.618 + f * 0.13) % 1);
      this.fFail.setX(f, b.functions[f].failing ? 0 : -1);
    }
    this.fInfo.needsUpdate = true;
    this.fFail.needsUpdate = true;
    this.fRoof.needsUpdate = true;
    this.fMat.needsUpdate = true;
    this.detail.visible = true;
    this.writeBuildings();
  }

  /** The crane swapped in a new floor: it no longer fails, and it is tinted the district colour with a green edge. */
  markFloorFixed(f: number): void {
    if (f < 0 || f >= this.floorCount) return;
    this.fFail.setX(f, -1);
    this.fFail.needsUpdate = true;
    this.c.setRGB(this.fRoof.getX(f), this.fRoof.getY(f), this.fRoof.getZ(f)).lerp(FIXED_GREEN, 0.35);
    this.fRoof.setXYZ(f, this.c.r, this.c.g, this.c.b);
    this.fRoof.needsUpdate = true;
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
      const cs = this.craneSlab;
      if (f === cs.f) this.m.compose(this.p.set(ox + cs.dx, y + cs.dy + (t * (1 - cs.s)) / 2, oz + slide + cs.dz), this.q.identity(), this.s.set(w * cs.s, t * cs.s, d * cs.s));
      else this.m.compose(this.p.set(ox, y, oz + slide), this.q.identity(), this.s.set(w, t, d));
      this.floorMesh.setMatrixAt(f, this.m);
      const o = f * 6;
      const moved = f === this.craneSlab.f;
      this.floorBoxes[o] = ox + (moved ? this.craneSlab.dx : 0);
      this.floorBoxes[o + 1] = y + t / 2 + (moved ? this.craneSlab.dy : 0);
      this.floorBoxes[o + 2] = oz + slide + (moved ? this.craneSlab.dz : 0);
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
    // the blob sits on the desk under the stack once it has slid out (it fades in as it lands)
    this.stackShadow.visible = !!this.blob && p > 0.05;
    this.stackShadow.position.set(ox, (-PLINTH_H / CITY_SIZE) * p + 0.002, oz);
    this.stackShadow.scale.set(w * 1.9, 1, d * 1.9);
    (this.stackShadow.material as MeshBasicMaterial).opacity = 0.75 * p * p;
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

/**
 * Scaffolding for one face, unit scale: x across the face (-0.5..0.5), y up
 * (0..1), z outward from the wall (0..1). Grey poles and timber planks with
 * vertex colours, merged (the InstancedMesh draws every scaffolded face in one call).
 */
function makeScaffoldGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string, rz = 0) => {
    const g = new BoxGeometry(w, h, d).toNonIndexed();
    g.rotateZ(rz);
    g.translate(x, y, z);
    g.deleteAttribute('uv');
    const c = new Color(hex);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ao = 0.75 + 0.25 * Math.min(1, pos.getY(i) / 0.3);
      col.set([c.r * ao, c.g * ao, c.b * ao], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    parts.push(g);
  };
  for (const x of [-0.47, -0.16, 0.16, 0.47]) add(0.035, 1, 0.22, x, 0.5, 0.72, '#8f969c'); // poles
  for (const y of [0.34, 0.67, 0.985]) {
    add(1, 0.03, 0.9, 0, y, 0.5, '#b88a55'); // plank deck
    add(1, 0.022, 0.1, 0, y + 0.1, 0.92, '#8f969c'); // guard rail
  }
  add(1.15, 0.025, 0.08, 0, 0.5, 0.94, '#8f969c', 0.5); // a diagonal brace
  return mergeGeometries(parts)!;
}

/**
 * A civic roof for the entry building, unit scale (drum radius 1, base at
 * y = 0): a cornice, a drum ringed with dark windows, a stone dome, a gilt
 * lantern and finial. One merged geometry with vertex colours (one draw call),
 * darker toward its foot (baked AO).
 */
function makeLandmarkGeometry(): BufferGeometry {
  const paint = (g: BufferGeometry, hex: string, dy: number, aoFoot = 0.75): BufferGeometry => {
    g.translate(0, dy, 0);
    const c = new Color(hex);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ao = aoFoot + (1 - aoFoot) * Math.min(1, Math.max(0, pos.getY(i) / 0.6));
      col[i * 3] = c.r * ao;
      col[i * 3 + 1] = c.g * ao;
      col[i * 3 + 2] = c.b * ao;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [
    paint(new BoxGeometry(2.3, 0.14, 2.3), '#d6cebf', 0.07, 0.6), // cornice
    paint(new CylinderGeometry(1, 1.04, 0.62, 16), '#c9c0b1', 0.14 + 0.31), // drum, the plinth's warm stone
  ];
  // dark window slits around the drum
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const w = paint(new BoxGeometry(0.16, 0.36, 0.06), '#2c3a45', 0.47, 1);
    w.rotateY(-a);
    w.translate(Math.sin(a) * 1.0, 0, Math.cos(a) * 1.0);
    parts.push(w);
  }
  parts.push(
    paint(new SphereGeometry(0.98, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#d3cabb', 0.76, 1), // dome, warm stone
    paint(new CylinderGeometry(0.2, 0.22, 0.3, 10), '#d9b25c', 1.86, 1), // lantern
    paint(new ConeGeometry(0.12, 0.5, 10), '#e4c36e', 2.26, 1), // gold finial
  );
  return mergeGeometries(parts)!;
}

/**
 * Per-vertex ambient occlusion by height, baked into a colour attribute:
 * `floor` at y = y0 rising to 1 at y = y1 (a prop is darkest where it meets
 * the surface it stands on).
 */
function withHeightAO(geo: BufferGeometry, y0: number, y1: number, floor: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    const v = floor + (1 - floor) * Math.sqrt(t);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
}
