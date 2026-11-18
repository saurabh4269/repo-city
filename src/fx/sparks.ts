import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from '@iwsdk/core';

/**
 * Celebration sparks: short-lived additive points thrown up from a spot,
 * falling back with gravity. One draw call, fixed pool, no allocation per frame.
 * Sizes and speeds in metres (the object lives in metre space).
 */
const N = 320;

export class Sparks {
  readonly points: Points;
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private max = new Float32Array(N).fill(1);
  private alpha = new Float32Array(N);
  private next = 0;
  private mat: ShaderMaterial;
  private readonly c = new Color();

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.mat = new ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = 0.006 * uScale * projectionMatrix[1][1] / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.01) discard;
          // alpha must fade too: in immersive-ar the framebuffer alpha decides passthrough, so alpha 1 drew black squares
          gl_FragColor = vec4(vC, a); }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }

  setViewport(heightPx: number): void {
    this.mat.uniforms.uScale.value = heightPx * 0.5;
  }

  /** Throw `count` sparks up from `at` (metres, parent space). */
  burst(at: Vector3, count: number, color: string, speed = 0.35): void {
    this.c.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.4 + 0.1;
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      this.vel[i * 3] = Math.cos(a) * r * speed;
      this.vel[i * 3 + 1] = (0.7 + Math.random() * 0.6) * speed;
      this.vel[i * 3 + 2] = Math.sin(a) * r * speed;
      const w = 0.75 + Math.random() * 0.5;
      this.col[i * 3] = this.c.r * w;
      this.col[i * 3 + 1] = this.c.g * w;
      this.col[i * 3 + 2] = this.c.b * w;
      this.life[i] = this.max[i] = 0.7 + Math.random() * 0.7;
    }
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    let any = false;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      any = true;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 0.6 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const u = this.life[i] / this.max[i];
      this.alpha[i] = Math.max(0, u) * (0.7 + 0.3 * Math.sin(this.life[i] * 40));
    }
    this.points.visible = any;
    if (!any) return;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}
