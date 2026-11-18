import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';

/**
 * A small, convincing fire for a building on a desk: additive flames with
 * rising embers, plus a soft smoke column, both as point sprites updated on
 * the CPU (no allocation per frame). Sizes are in metres. `level` (0..1)
 * scales emission; at 0 the remaining particles burn out. `burst()` throws a
 * steam puff when the fire goes out.
 */
const FLAMES = 110;
const SMOKE = 46;

interface Pool {
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  max: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  heat: Float32Array;
  geo: BufferGeometry;
}

function makePool(n: number): Pool {
  const geo = new BufferGeometry();
  const pool: Pool = {
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    life: new Float32Array(n).fill(0),
    max: new Float32Array(n).fill(1),
    size: new Float32Array(n),
    alpha: new Float32Array(n),
    heat: new Float32Array(n),
    geo,
  };
  geo.setAttribute('position', new BufferAttribute(pool.pos, 3));
  geo.setAttribute('aSize', new BufferAttribute(pool.size, 1));
  geo.setAttribute('aAlpha', new BufferAttribute(pool.alpha, 1));
  geo.setAttribute('aHeat', new BufferAttribute(pool.heat, 1));
  return pool;
}

function spriteTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

const VERT = `
attribute float aSize; attribute float aAlpha; attribute float aHeat;
varying float vAlpha; varying float vHeat;
uniform float uScale;
void main() {
  vAlpha = aAlpha; vHeat = aHeat;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

export class Fire {
  readonly group = new Group();
  /** Emitter position in the group's parent space (set by the director). */
  readonly origin = new Vector3();
  /** Footprint half-size of the burning thing (metres), flames spawn across it. */
  spread = 0.012;
  level = 0;
  /** 0..1 smouldering (embers + smoke only, few flames): used on an opened floor. */
  smoulder = 0;
  private flames = makePool(FLAMES);
  private smoke = makePool(SMOKE);
  private flameMat: ShaderMaterial;
  private smokeMat: ShaderMaterial;
  private acc = 0;
  private accS = 0;
  private steamT = 0;
  private ember = new Uint8Array(FLAMES);

  constructor() {
    const tex = spriteTexture();
    this.flameMat = new ShaderMaterial({
      uniforms: { uMap: { value: tex }, uScale: { value: 900 } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D uMap; varying float vAlpha; varying float vHeat;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a;
          vec3 hot = vec3(1.0, 0.92, 0.65); vec3 mid = vec3(1.0, 0.5, 0.12); vec3 cool = vec3(0.75, 0.12, 0.03);
          vec3 col = vHeat > 0.5 ? mix(mid, hot, (vHeat - 0.5) * 2.0) : mix(cool, mid, vHeat * 2.0);
          gl_FragColor = vec4(col * 1.15, a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.smokeMat = new ShaderMaterial({
      uniforms: { uMap: { value: tex }, uScale: { value: 900 } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D uMap; varying float vAlpha; varying float vHeat;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a;
          vec3 col = mix(vec3(0.16, 0.15, 0.15), vec3(0.92, 0.94, 0.97), vHeat);
          gl_FragColor = vec4(col, a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    const f = new Points(this.flames.geo, this.flameMat);
    const s = new Points(this.smoke.geo, this.smokeMat);
    f.frustumCulled = s.frustumCulled = false;
    f.renderOrder = 8;
    s.renderOrder = 7;
    f.name = 'fire-flames';
    s.name = 'fire-smoke';
    this.group.add(s, f);
  }

  /** Projection scale for point sizes: pixels per metre at 1 m (call when the viewport changes). */
  setViewport(heightPx: number, fovYDeg: number): void {
    const k = heightPx / (2 * Math.tan((fovYDeg * Math.PI) / 360));
    this.flameMat.uniforms.uScale.value = k;
    this.smokeMat.uniforms.uScale.value = k;
  }

  /** A white steam column for ~1.5 s (the fire is put out). */
  steam(): void {
    this.steamT = 1.6;
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    const lvl = this.level;
    const flameRate = lvl * (1 - this.smoulder * 0.8) * 140;
    const smokeRate = lvl * 14 + (this.steamT > 0 ? 40 : 0);
    this.acc += flameRate * dt;
    this.accS += smokeRate * dt;
    if (this.steamT > 0) this.steamT -= dt;
    const F = this.flames;
    for (let i = 0; i < FLAMES; i++) {
      if (F.life[i] <= 0 && this.acc >= 1) {
        this.acc -= 1;
        const ember = Math.random() < 0.12 + this.smoulder * 0.4;
        F.life[i] = F.max[i] = ember ? 1.1 + Math.random() * 0.8 : 0.45 + Math.random() * 0.35;
        const r = this.spread;
        F.pos[i * 3] = this.origin.x + (Math.random() - 0.5) * 2 * r;
        F.pos[i * 3 + 1] = this.origin.y + Math.random() * 0.004;
        F.pos[i * 3 + 2] = this.origin.z + (Math.random() - 0.5) * 2 * r;
        F.vel[i * 3] = (Math.random() - 0.5) * (ember ? 0.03 : 0.01);
        F.vel[i * 3 + 1] = ember ? 0.07 + Math.random() * 0.06 : 0.06 + Math.random() * 0.05;
        F.vel[i * 3 + 2] = (Math.random() - 0.5) * (ember ? 0.03 : 0.01);
        this.ember[i] = ember ? 1 : 0;
        F.heat[i] = ember ? 0.55 : 1;
      }
      if (F.life[i] > 0) {
        F.life[i] -= dt;
        const u = 1 - F.life[i] / F.max[i];
        const ember = this.ember[i] === 1;
        // flames pull toward the centre line as they rise (a tapering tongue)
        const cx = this.origin.x - F.pos[i * 3];
        const cz = this.origin.z - F.pos[i * 3 + 2];
        F.vel[i * 3] += cx * dt * (ember ? 0.5 : 6) + (Math.random() - 0.5) * dt * 0.06;
        F.vel[i * 3 + 2] += cz * dt * (ember ? 0.5 : 6) + (Math.random() - 0.5) * dt * 0.06;
        F.vel[i * 3 + 1] += dt * (ember ? 0.01 : 0.05);
        F.pos[i * 3] += F.vel[i * 3] * dt;
        F.pos[i * 3 + 1] += F.vel[i * 3 + 1] * dt;
        F.pos[i * 3 + 2] += F.vel[i * 3 + 2] * dt;
        if (ember) {
          F.size[i] = 0.0022;
          F.alpha[i] = (1 - u) * (0.6 + 0.4 * Math.random());
          F.heat[i] = 0.55;
        } else {
          F.size[i] = (0.012 + this.spread * 0.5) * (1 - u * 0.75) * (u < 0.15 ? u / 0.15 : 1);
          F.alpha[i] = 0.42 * (1 - u) * (1 - u);
          F.heat[i] = 1 - u;
        }
      } else {
        F.alpha[i] = 0;
        F.size[i] = 0;
      }
    }
    const S = this.smoke;
    const steam = this.steamT > 0;
    for (let i = 0; i < SMOKE; i++) {
      if (S.life[i] <= 0 && this.accS >= 1) {
        this.accS -= 1;
        S.life[i] = S.max[i] = 1.6 + Math.random() * 1.2;
        const r = this.spread;
        S.pos[i * 3] = this.origin.x + (Math.random() - 0.5) * r;
        S.pos[i * 3 + 1] = this.origin.y + 0.025 * (steam ? 0.2 : 1);
        S.pos[i * 3 + 2] = this.origin.z + (Math.random() - 0.5) * r;
        S.vel[i * 3] = (Math.random() - 0.5) * 0.01 + 0.004;
        S.vel[i * 3 + 1] = (steam ? 0.07 : 0.035) + Math.random() * 0.02;
        S.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
        S.heat[i] = steam ? 1 : 0;
      }
      if (S.life[i] > 0) {
        S.life[i] -= dt;
        const u = 1 - S.life[i] / S.max[i];
        S.pos[i * 3] += S.vel[i * 3] * dt;
        S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt;
        S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
        S.size[i] = 0.02 + u * 0.06;
        S.alpha[i] = (S.heat[i] > 0.5 ? 0.35 : 0.22) * Math.sin(Math.PI * u);
      } else {
        S.alpha[i] = 0;
        S.size[i] = 0;
      }
    }
    for (const p of [F, S]) {
      p.geo.attributes.position.needsUpdate = true;
      p.geo.attributes.aSize.needsUpdate = true;
      p.geo.attributes.aAlpha.needsUpdate = true;
      p.geo.attributes.aHeat.needsUpdate = true;
    }
  }

  /** Any particle still alive? */
  get active(): boolean {
    return this.level > 0 || this.steamT > 0 || this.flames.life.some((l) => l > 0) || this.smoke.life.some((l) => l > 0);
  }
}
