import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from '@iwsdk/core';
import { CanvasCard, fitText, FONT_UI, roundRect, UI } from './canvas.js';

/**
 * Buttons as plaques lying on the real table at the near edge of the city,
 * tilted toward the user: the real desk under the fingertip gives the touch
 * that hand tracking lacks. Pressed by poking down through the plaque or by
 * pinching on it. Up to three at once, laid out from the centre.
 */
export const PLAQUE_W = 0.105;
export const PLAQUE_H = 0.045;
const TILT = (38 * Math.PI) / 180;

export interface PlaqueSpec {
  id: string;
  text: string;
  accent?: string;
}

interface Slot {
  card: CanvasCard;
  holder: Group;
  spec: PlaqueSpec | null;
  depth: [number, number];
  glow: number;
  press: number;
}

export class Plaques {
  readonly group = new Group();
  private slots: Slot[] = [];
  private readonly tmp = new Vector3();
  private readonly n = new Vector3();
  private readonly ax = new Vector3();
  private readonly ay = new Vector3();
  private readonly o = new Vector3();
  private lastFire = new Map<string, number>();
  private lastAny = -1e9;
  onPress: (id: string) => void = () => {};

  constructor() {
    this.group.name = 'plaques';
    for (let i = 0; i < 3; i++) {
      const holder = new Group();
      holder.rotation.x = -Math.PI / 2 + TILT;
      const card = new CanvasCard(PLAQUE_W, PLAQUE_H, 3000);
      card.mesh.name = `plaque-${i}`;
      // a thin dark base under the card (a little object on the desk)
      const base = new Mesh(new PlaneGeometry(PLAQUE_W + 0.006, PLAQUE_H + 0.006), new MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0.5, depthWrite: false }));
      base.position.z = -0.002;
      base.renderOrder = 9;
      holder.add(base, card.mesh);
      holder.visible = false;
      this.group.add(holder);
      this.slots.push({ card, holder, spec: null, depth: [1, 1], glow: 0, press: 0 });
    }
  }

  /** Show these plaques (≤ 3) in order, centred. */
  set(specs: PlaqueSpec[]): void {
    const n = Math.min(3, specs.length);
    const gap = 0.018;
    const total = n * PLAQUE_W + (n - 1) * gap;
    this.slots.forEach((s, i) => {
      const spec = i < n ? specs[i] : null;
      s.spec = spec;
      s.holder.visible = !!spec;
      if (!spec) return;
      s.holder.position.set(-total / 2 + PLAQUE_W / 2 + i * (PLAQUE_W + gap), Math.sin(TILT) * (PLAQUE_H / 2) + 0.004, 0);
      this.redraw(s);
    });
  }

  ids(): string[] {
    return this.slots.filter((s) => s.spec).map((s) => s.spec!.id);
  }

  private redraw(s: Slot): void {
    const spec = s.spec!;
    const hot = s.glow > 0.5;
    s.card.draw(`${spec.id}|${spec.text}|${spec.accent}|${hot}`, (ctx, W, H) => {
      roundRect(ctx, 4, 4, W - 8, H - 8, 34);
      ctx.fillStyle = hot ? 'rgba(40, 62, 88, 0.97)' : 'rgba(16, 24, 36, 0.95)';
      ctx.fill();
      ctx.lineWidth = hot ? 10 : 5;
      ctx.strokeStyle = spec.accent ?? UI.blue;
      ctx.stroke();
      fitText(ctx, spec.text, 30, 18, W - 60, H - 36, { size: 52, weight: 700, align: 'center', valign: 'middle', font: FONT_UI, lineHeight: 1.1 });
    });
  }

  /** World position of each visible plaque centre (for tests and hints). */
  centres(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const s of this.slots) {
      if (!s.spec) continue;
      s.card.mesh.getWorldPosition(this.tmp);
      out[s.spec.id] = [+this.tmp.x.toFixed(3), +this.tmp.y.toFixed(3), +this.tmp.z.toFixed(3)];
    }
    return out;
  }

  /**
   * Per frame: poke test for each fingertip (crossing the plaque plane from
   * above, inside its rectangle) and pinch test (pinch start within 3.5 cm).
   * `tips[k]` / `pinchStarts[k]` may be null when that hand is not tracked.
   */
  update(dt: number, tips: (Vector3 | null)[], pinchStarts: (Vector3 | null)[], now: number): void {
    for (const s of this.slots) {
      if (!s.spec || !s.holder.visible) continue;
      const mesh = s.card.mesh;
      mesh.updateWorldMatrix(true, false);
      const e = mesh.matrixWorld.elements;
      this.n.set(e[8], e[9], e[10]).normalize();
      this.ax.set(e[0], e[1], e[2]);
      this.ay.set(e[4], e[5], e[6]);
      const sx = this.ax.length(), sy = this.ay.length();
      this.ax.divideScalar(sx);
      this.ay.divideScalar(sy);
      this.o.set(e[12], e[13], e[14]);
      let hover = false;
      for (let k = 0; k < 2; k++) {
        const tip = tips[k];
        if (!tip) {
          s.depth[k] = 1;
          continue;
        }
        this.tmp.subVectors(tip, this.o);
        const depth = this.tmp.dot(this.n);
        const lx = this.tmp.dot(this.ax) / (sx * PLAQUE_W);
        const ly = this.tmp.dot(this.ay) / (sy * PLAQUE_H);
        const over = Math.abs(lx) <= 0.55 && Math.abs(ly) <= 0.65;
        if (over && depth < 0.04 && depth > -0.03) hover = true;
        if (over && s.depth[k] > 0.004 && depth <= 0.004 && depth > -0.03) this.fire(s, now);
        s.depth[k] = depth;
        const ps = pinchStarts[k];
        if (ps) {
          this.tmp.subVectors(ps, this.o);
          const d = this.tmp.dot(this.n);
          const px = this.tmp.dot(this.ax) / (sx * PLAQUE_W);
          const py = this.tmp.dot(this.ay) / (sy * PLAQUE_H);
          if (Math.abs(px) <= 0.6 && Math.abs(py) <= 0.8 && Math.abs(d) < 0.035) this.fire(s, now);
        }
      }
      const target = hover ? 1 : 0;
      const was = s.glow > 0.5;
      s.glow += (target - s.glow) * Math.min(1, dt * 14);
      if (was !== s.glow > 0.5) this.redraw(s);
      s.press = Math.max(0, s.press - dt * 4);
      s.card.mesh.position.z = -0.003 * s.press;
    }
  }

  /** Also used by the 2D page and dev keys. */
  trigger(id: string, now = performance.now()): void {
    const s = this.slots.find((x) => x.spec?.id === id);
    if (s) this.fire(s, now);
  }

  private fire(s: Slot, now: number): void {
    const id = s.spec!.id;
    if (now - (this.lastFire.get(id) ?? -1e9) < 700 || now - this.lastAny < 450) return;
    this.lastFire.set(id, now);
    this.lastAny = now;
    s.press = 1;
    this.onPress(id);
  }
}
