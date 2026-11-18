import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from '@iwsdk/core';

/**
 * Data flow along import routes (docs/SPEC-city-life.md §4): while a building
 * is open, glowing dots run along its routes, from the open file to the files
 * it uses; fewer, dimmer dots come in from the files that use it.
 *
 * One Points draw. Each dot carries its route (start, end, arc height), a
 * phase and a direction; the GPU places it on the same sine arc the routes
 * use, so the CPU only rebuilds attributes when a building opens or closes.
 * Lives in city units (CityView.units); speeds are converted from metres.
 */
export const MAX_FLOW_ROUTES = 12;
const DOTS_OUT = 6;
const DOTS_IN = 3;
const N = MAX_FLOW_ROUTES * DOTS_OUT;

export interface FlowRoute {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Arc height (city units), as the route mesh draws it. */
  peak: number;
  /** true: the open file uses the target (dots run a → b); false: the target uses it (b → a). */
  out: boolean;
  color: Color;
}

export class Flow {
  readonly points: Points;
  private ab = new Float32Array(N * 4);
  private info = new Float32Array(N * 4);
  private col = new Float32Array(N * 3);
  private mat: ShaderMaterial;

  /** `unit`: metres per city unit (the dot speed is 0.12 m/s on the table). */
  constructor(unit: number) {
    const geo = new BufferGeometry();
    // position is unused (the shader computes it) but three needs it for the draw range
    geo.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aAB', new BufferAttribute(this.ab, 4));
    geo.setAttribute('aInfo', new BufferAttribute(this.info, 4));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uSpeed: { value: 0.12 / unit }, uUnit: { value: unit } },
      vertexShader: `attribute vec4 aAB; attribute vec4 aInfo; attribute vec3 aColor;
        uniform float uTime; uniform float uScale; uniform float uSpeed; uniform float uUnit;
        varying vec3 vC; varying float vA;
        void main(){
          vec2 a = aAB.xy, b = aAB.zw;
          float peak = aInfo.x, phase = aInfo.y, dir = aInfo.z, bright = aInfo.w;
          float len = length(b - a);
          float arc = len + 1.6 * peak; // close enough to the sine arc's length
          float u = fract(uTime * uSpeed / max(arc, 0.01) + phase);
          float s = dir > 0.0 ? u : 1.0 - u;
          vec3 p = vec3(mix(a, b, s), 0.0).xzy;
          p.y = 0.01 + sin(3.14159265 * s) * peak + (1.0 - s) * 0.002 + 0.002;
          vC = aColor * bright;
          vA = smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.88, u) * bright;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // twice a spark: at the spec's 4 px the dots vanished against the bright route arcs
          gl_PointSize = 0.012 * uScale * projectionMatrix[1][1] / max(0.05, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d) * vA; if (a < 0.01) discard;
          // alpha fades with the glow: in immersive-ar framebuffer alpha decides passthrough (no black squares)
          gl_FragColor = vec4(vC * 1.6, a); }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, this.mat);
    this.points.name = 'city-flow';
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.visible = false;
  }

  setViewport(heightPx: number): void {
    this.mat.uniforms.uScale.value = heightPx * 0.5;
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }

  /** Dots for these routes (outgoing first); returns the number of routes shown. */
  set(routes: readonly FlowRoute[]): number {
    let k = 0;
    let shown = 0;
    for (const r of routes) {
      if (shown >= MAX_FLOW_ROUTES) break;
      shown++;
      const dots = r.out ? DOTS_OUT : DOTS_IN;
      for (let j = 0; j < dots && k < N; j++, k++) {
        this.ab.set([r.ax, r.az, r.bx, r.bz], k * 4);
        this.info.set([r.peak, j / dots + shown * 0.137, r.out ? 1 : -1, r.out ? 1 : 0.45], k * 4);
        this.col.set([r.color.r, r.color.g, r.color.b], k * 3);
      }
    }
    const g = this.points.geometry;
    g.setDrawRange(0, k);
    g.attributes.aAB.needsUpdate = true;
    g.attributes.aInfo.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    this.points.visible = k > 0;
    return shown;
  }
}
