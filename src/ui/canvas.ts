import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

/**
 * Canvas2D cards for every piece of text in Repo City (panel, plaques, guide
 * caption, building label). Fit-to-card text and wrapping follow
 * chausar/src/game/text.ts (same kit); the look is Repo City's own.
 */

export const FONT_UI = `'Inter', 'Helvetica Neue', Arial, sans-serif`;
export const FONT_CODE = `'JetBrains Mono', Menlo, Consolas, monospace`;

/** One palette for the whole app (architectural model + night-blue glass UI). */
export const UI = {
  glass: 'rgba(14, 22, 34, 0.92)',
  glassEdge: 'rgba(255, 255, 255, 0.16)',
  text: '#f4efe6',
  dim: '#a9b4c2',
  amber: '#ffb347',
  fire: '#ff6a3d',
  green: '#7ee0a6',
  blue: '#8cc8ff',
  codeBg: 'rgba(6, 10, 16, 0.85)',
};

let fontsReady: Promise<void> | null = null;

/** Inter and JetBrains Mono (both SIL OFL) from Google Fonts; resolves offline with fallbacks. */
export function loadFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap';
      document.head.appendChild(link);
      await new Promise((r) => {
        link.onload = r;
        link.onerror = r;
        setTimeout(r, 2500);
      });
      await Promise.race([
        Promise.all([
          document.fonts.load(`600 40px 'Inter'`, 'Repo City'),
          document.fonts.load(`700 40px 'Inter'`, 'Repo City'),
          document.fonts.load(`500 40px 'JetBrains Mono'`, 'const x = 1;'),
        ]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      /* system fonts */
    }
  })();
  return fontsReady;
}

export class CanvasCard {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  readonly widthM: number;
  readonly heightM: number;
  private texture: CanvasTexture;
  readonly material: MeshBasicMaterial;
  private key = '';

  constructor(widthM: number, heightM: number, pxPerM = 2400, mip = false) {
    this.widthM = widthM;
    this.heightM = heightM;
    this.canvas = document.createElement('canvas');
    this.W = this.canvas.width = Math.round(widthM * pxPerM);
    this.H = this.canvas.height = Math.round(heightM * pxPerM);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    if (mip) {
      this.texture.minFilter = LinearMipmapLinearFilter;
      this.texture.generateMipmaps = true;
    } else {
      this.texture.minFilter = LinearFilter;
      this.texture.generateMipmaps = false;
    }
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), this.material);
    this.mesh.renderOrder = 10;
  }

  /** Redraw only when `key` changes. */
  draw(key: string, fn: (ctx: CanvasRenderingContext2D, W: number, H: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.ctx.save();
    fn(this.ctx, this.W, this.H);
    this.ctx.restore();
    this.texture.needsUpdate = true;
  }

  set opacity(v: number) {
    this.material.opacity = v;
    this.mesh.visible = v > 0.01;
  }
  get opacity(): number {
    return this.material.opacity;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The standard glass card background with a hairline edge and an optional accent bar. */
export function glass(ctx: CanvasRenderingContext2D, W: number, H: number, accent?: string, r = 36): void {
  roundRect(ctx, 3, 3, W - 6, H - 6, r);
  ctx.fillStyle = UI.glass;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = UI.glassEdge;
  ctx.stroke();
  if (accent) {
    ctx.save();
    roundRect(ctx, 3, 3, W - 6, H - 6, r);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(3, 3, 14, H - 6);
    ctx.restore();
  }
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > max && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw wrapped text inside a box, shrinking the font until it fits both width
 * and height (wrapping alone only guarantees width). Returns the used size.
 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { size: number; weight?: number; color?: string; font?: string; lineHeight?: number; align?: CanvasTextAlign; valign?: 'top' | 'middle' } ,
): number {
  const font = opts.font ?? FONT_UI;
  const lhK = opts.lineHeight ?? 1.3;
  let size = opts.size;
  let lines: string[] = [];
  for (let i = 0; i < 16; i++) {
    ctx.font = `${opts.weight ?? 500} ${size}px ${font}`;
    lines = wrap(ctx, text, w);
    const tall = (lines.length - 1) * size * lhK + size * 1.1;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (tall <= h && widest <= w) break;
    size *= 0.92;
  }
  ctx.fillStyle = opts.color ?? UI.text;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'top';
  const lh = size * lhK;
  const total = (lines.length - 1) * lh + size * 1.1;
  let yy = opts.valign === 'middle' ? y + (h - total) / 2 : y;
  const xx = opts.align === 'center' ? x + w / 2 : opts.align === 'right' ? x + w : x;
  for (const l of lines) {
    ctx.fillText(l, xx, yy);
    yy += lh;
  }
  return size;
}

const KEYWORDS = new Set(
  'const let var function return if else for while do switch case break continue new class extends this throw try catch finally typeof instanceof in of null undefined true false async await import export from default static get set require module'.split(
    ' ',
  ),
);

/**
 * Draw source lines with light syntax colouring (keywords, strings, numbers,
 * comments). Monospace; `hi` lines get a tinted background.
 */
export function drawCode(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { firstLine: number; hi?: Map<number, string>; maxSize?: number },
): void {
  const gutter = 0.1 * w;
  const maxCols = Math.max(20, ...lines.map((l) => l.length));
  let size = Math.min(opts.maxSize ?? 46, h / (Math.max(lines.length, 6) * 1.32));
  ctx.font = `500 ${size}px ${FONT_CODE}`;
  const cw = ctx.measureText('M').width;
  if (cw * maxCols > w - gutter) size *= (w - gutter) / (cw * maxCols);
  ctx.font = `500 ${size}px ${FONT_CODE}`;
  const charW = ctx.measureText('M').width;
  const lh = size * 1.32;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    const yy = y + i * lh;
    const hiColor = opts.hi?.get(i);
    if (hiColor) {
      ctx.fillStyle = hiColor;
      ctx.fillRect(x - 8, yy - size * 0.14, w + 16, lh);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5c6b7c';
    ctx.fillText(String(opts.firstLine + i), x + gutter - 18, yy);
    ctx.textAlign = 'left';
    let cx = x + gutter;
    for (const tok of tokenize(line)) {
      ctx.fillStyle = tok.c;
      ctx.fillText(tok.t, cx, yy);
      cx += charW * tok.t.length;
    }
  });
}

interface Tok {
  t: string;
  c: string;
}

function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\/\/.*$|\/\*.*?\*\/|'(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const t = m[0];
    let c = '#e6e1d6';
    if (t.startsWith('//') || t.startsWith('/*')) c = '#6f8396';
    else if (/^['"`]/.test(t)) c = '#a8d98a';
    else if (/^\d/.test(t)) c = '#f5b97a';
    else if (KEYWORDS.has(t)) c = '#c99bff';
    else if (/^[A-Z]/.test(t)) c = '#8cc8ff';
    out.push({ t, c });
  }
  return out;
}
