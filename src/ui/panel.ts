import type { Building, CityData, Failure, Fix } from '../city/types.js';
import { CanvasCard, drawCode, fitText, FONT_CODE, FONT_UI, glass, roundRect, UI } from './canvas.js';

/** Main reading panel, standing behind the city: metres. */
export const PANEL_W = 0.6;
export const PANEL_H = 0.38;

export type PanelMode =
  | { kind: 'placing' }
  | { kind: 'welcome' }
  | { kind: 'building'; b: Building; floor: number }
  | { kind: 'fire'; b: Building; f: Failure; fix?: Fix }
  | { kind: 'fix'; b: Building; fix: Fix }
  | { kind: 'testing'; done: number; total: number; passed: number; failed: number; file: string }
  | { kind: 'done'; seconds: number; total: number };

/**
 * One panel, two regions: the guide's line on top (who is talking and what to
 * do next) and the content below (city stats, a file and its code, the
 * failing test, the fix, the test run, the result).
 */
export class MainPanel {
  readonly card = new CanvasCard(PANEL_W, PANEL_H, 2400, true);
  guide = '';
  city: CityData | null = null;

  render(mode: PanelMode): void {
    const key = JSON.stringify([this.guide, modeKey(mode)]);
    this.card.draw(key, (ctx, W, H) => {
      glass(ctx, W, H, undefined, 44);
      const pad = 48;
      // Guide strip
      const gh = 168;
      ctx.save();
      roundRect(ctx, 3, 3, W - 6, gh, 44);
      ctx.clip();
      ctx.fillStyle = 'rgba(140, 200, 255, 0.10)';
      ctx.fillRect(0, 0, W, gh + 3);
      ctx.restore();
      // the guide's lantern icon
      const gx = pad + 34, gy = gh / 2 + 3;
      const grd = ctx.createRadialGradient(gx, gy, 2, gx, gy, 34);
      grd.addColorStop(0, '#fff6d8');
      grd.addColorStop(0.5, '#ffc56b');
      grd.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(gx, gy, 34, 0, Math.PI * 2);
      ctx.fill();
      fitText(ctx, this.guide || ' ', pad + 90, 22, W - pad * 2 - 90, gh - 40, { size: 50, weight: 600, valign: 'middle', lineHeight: 1.22 });
      ctx.fillStyle = UI.glassEdge;
      ctx.fillRect(pad, gh + 3, W - pad * 2, 3);
      const top = gh + 32;
      const area = { x: pad, y: top, w: W - pad * 2, h: H - top - 40 };
      switch (mode.kind) {
        case 'placing':
          drawPlacing(ctx, area);
          break;
        case 'welcome':
          if (this.city) drawWelcome(ctx, area, this.city);
          break;
        case 'building':
          drawBuilding(ctx, area, mode.b, mode.floor, this.city);
          break;
        case 'fire':
          drawFire(ctx, area, mode.b, mode.f, mode.fix);
          break;
        case 'fix':
          drawFix(ctx, area, mode.b, mode.fix);
          break;
        case 'testing':
          drawTesting(ctx, area, mode);
          break;
        case 'done':
          drawDone(ctx, area, mode, this.city);
          break;
      }
    });
  }
}

function modeKey(m: PanelMode): unknown {
  switch (m.kind) {
    case 'building':
      return [m.kind, m.b.id, m.floor];
    case 'fire':
    case 'fix':
      return [m.kind, m.b.id];
    default:
      return m;
  }
}

type Area = { x: number; y: number; w: number; h: number };

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 30): void {
  ctx.font = `700 ${size}px ${FONT_UI}`;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '3px';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text.toUpperCase(), x, y);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string, size = 32): number {
  ctx.font = `700 ${size}px ${FONT_UI}`;
  const w = ctx.measureText(text).width + size * 1.1;
  roundRect(ctx, x, y, w, size * 1.6, size * 0.8);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.55, y + size * 0.82);
  return w;
}

function drawPlacing(ctx: CanvasRenderingContext2D, a: Area): void {
  fitText(ctx, 'Repo City', a.x, a.y, a.w, 120, { size: 96, weight: 800 });
  fitText(ctx, 'A real code repository, built as a city on your desk.', a.x, a.y + 130, a.w, 140, { size: 50, color: UI.dim });
}

function stat(ctx: CanvasRenderingContext2D, value: string, name: string, x: number, y: number, w: number, color = UI.text): void {
  fitText(ctx, value, x, y, w - 20, 90, { size: 80, weight: 800, color });
  fitText(ctx, name, x, y + 92, w - 20, 50, { size: 36, color: UI.dim });
}

function drawWelcome(ctx: CanvasRenderingContext2D, a: Area, c: CityData): void {
  ctx.font = `800 84px ${FONT_UI}`;
  fitText(ctx, c.name, a.x, a.y, a.w * 0.6, 100, { size: 84, weight: 800 });
  fitText(ctx, c.tagline, a.x, a.y + 106, a.w, 110, { size: 44, color: UI.dim });
  const y = a.y + 250;
  const cw = a.w / 4;
  stat(ctx, String(c.stats.files), 'files = buildings', a.x, y, cw);
  stat(ctx, c.stats.lines.toLocaleString('en-US'), 'lines of code', a.x + cw, y, cw);
  stat(ctx, String(c.stats.functions), 'functions = floors', a.x + cw * 2, y, cw);
  if (c.stats.failing > 0) stat(ctx, `${c.stats.failing} failing`, `of ${c.stats.tests.toLocaleString('en-US')} test checks`, a.x + cw * 3, y, cw, UI.fire);
  else stat(ctx, c.stats.tests ? 'all pass' : 'no tests', `${c.stats.tests.toLocaleString('en-US')} test checks`, a.x + cw * 3, y, cw, UI.green);
  fitText(ctx, `Source: ${c.source.repo} (${c.source.license}). ${c.source.note}`, a.x, a.y + a.h - 50, a.w, 50, { size: 30, color: '#7d8a99' });
}

function drawBuilding(ctx: CanvasRenderingContext2D, a: Area, b: Building, floor: number, c: CityData | null): void {
  const district = c?.districts.find((d) => d.id === b.district);
  let x = a.x;
  if (district) x += chip(ctx, district.name, x, a.y, 'rgba(255,255,255,0.12)', UI.text, 30) + 16;
  fitText(ctx, b.path, x, a.y - 4, a.w - (x - a.x), 60, { size: 54, weight: 800 });
  fitText(ctx, b.summary, a.x, a.y + 62, a.w, 66, { size: 36, color: UI.dim });
  const y = a.y + 140;
  const h = a.h - 140;
  // Floor directory (top floor first, like a lobby board)
  const lw = a.w * 0.34;
  label(ctx, `${b.functions.length} floors · ${b.lines} lines`, a.x, y, UI.dim, 26);
  const n = b.functions.length;
  const rows = Math.min(n, 11);
  const start = Math.max(0, Math.min(n - rows, (floor < 0 ? n - 1 : floor) - Math.floor(rows / 2)));
  const rh = Math.min(52, (h - 44) / rows);
  for (let k = 0; k < rows; k++) {
    const fi = start + rows - 1 - k;
    const f = b.functions[fi];
    const yy = y + 42 + k * rh;
    if (fi === floor) {
      roundRect(ctx, a.x - 10, yy - 4, lw, rh - 2, 12);
      ctx.fillStyle = f.failing ? 'rgba(255,106,61,0.28)' : 'rgba(140,200,255,0.22)';
      ctx.fill();
    }
    ctx.font = `${fi === floor ? 700 : 500} ${Math.round(rh * 0.62)}px ${FONT_UI}`;
    ctx.fillStyle = f.failing ? UI.fire : fi === floor ? UI.text : '#c9d1db';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let name = `${fi + 1}  ${f.failing ? '● ' : ''}${f.name}`;
    while (ctx.measureText(name).width > lw - 20 && name.length > 4) name = name.slice(0, -2) + '…';
    ctx.fillText(name, a.x, yy + rh * 0.12);
  }
  // Code
  const cx = a.x + lw + 24;
  const cwid = a.w - lw - 24;
  roundRect(ctx, cx, y, cwid, h, 20);
  ctx.fillStyle = UI.codeBg;
  ctx.fill();
  const f = b.functions[floor < 0 ? 0 : floor];
  if (f) {
    const lines = f.code.split('\n').slice(0, 16);
    const first = f.codeStart ?? f.startLine;
    const hi = new Map<number, string>();
    if (f.failing && f.bugLine) hi.set(f.bugLine - first, 'rgba(255,106,61,0.30)');
    drawCode(ctx, lines, cx + 22, y + 20, cwid - 44, h - 40, { firstLine: first, maxSize: 36, hi });
  }
}

function drawFire(ctx: CanvasRenderingContext2D, a: Area, b: Building, f: Failure, fix?: Fix): void {
  let x = a.x;
  x += chip(ctx, 'TEST FAILING', x, a.y, 'rgba(255,106,61,0.9)', '#1a0a04', 30) + 16;
  fitText(ctx, f.testFile, x, a.y - 2, a.w - (x - a.x), 56, { size: 44, weight: 700 });
  fitText(ctx, f.testName, a.x, a.y + 66, a.w, 60, { size: 40, color: UI.dim });
  const y = a.y + 140;
  // assertion line
  roundRect(ctx, a.x, y, a.w, 76, 16);
  ctx.fillStyle = UI.codeBg;
  ctx.fill();
  fitText(ctx, f.assertion, a.x + 24, y + 14, a.w - 48, 52, { size: 40, font: FONT_CODE, color: '#e6e1d6' });
  // expected vs actual
  const yy = y + 100;
  const half = (a.w - 24) / 2;
  roundRect(ctx, a.x, yy, half, 150, 18);
  ctx.fillStyle = 'rgba(126,224,166,0.12)';
  ctx.fill();
  roundRect(ctx, a.x + half + 24, yy, half, 150, 18);
  ctx.fillStyle = 'rgba(255,106,61,0.14)';
  ctx.fill();
  label(ctx, 'expected', a.x + 24, yy + 18, UI.green, 28);
  label(ctx, 'got', a.x + half + 48, yy + 18, UI.fire, 28);
  fitText(ctx, f.expected, a.x + 24, yy + 56, half - 48, 80, { size: 58, weight: 700, font: `'JetBrains Mono', Menlo, monospace` });
  fitText(ctx, f.actual, a.x + half + 48, yy + 56, half - 48, 80, { size: 58, weight: 700, font: `'JetBrains Mono', Menlo, monospace` });
  const fnLine = fix ? `The bug is on floor "${f.fn}" of ${b.name}, line ${fix.line}.` : `It fails inside "${f.fn}" in ${b.name}.`;
  fitText(ctx, `${fnLine} ${f.message}`, a.x, yy + 176, a.w, a.h - (yy + 176 - a.y), { size: 38, color: UI.text });
}

function drawFix(ctx: CanvasRenderingContext2D, a: Area, b: Building, fix: Fix): void {
  let x = a.x;
  x += chip(ctx, 'THE FIX', x, a.y, 'rgba(126,224,166,0.9)', '#06150c', 30) + 16;
  fitText(ctx, `${b.path} · line ${fix.line} · ${fix.fn}`, x, a.y - 2, a.w - (x - a.x), 56, { size: 42, weight: 700 });
  const y = a.y + 80;
  roundRect(ctx, a.x, y, a.w, 200, 18);
  ctx.fillStyle = UI.codeBg;
  ctx.fill();
  const hi = new Map<number, string>([
    [0, 'rgba(255,106,61,0.25)'],
    [1, 'rgba(126,224,166,0.22)'],
  ]);
  drawCode(ctx, [`- ${fix.before}`, `+ ${fix.after}`], a.x + 16, y + 30, a.w - 40, 150, { firstLine: fix.line, hi, maxSize: 46 });
  fitText(ctx, fix.explanation, a.x, y + 228, a.w, a.h - 228 - 80, { size: 42, lineHeight: 1.3 });
}

function drawTesting(ctx: CanvasRenderingContext2D, a: Area, m: { done: number; total: number; passed: number; failed: number; file: string }): void {
  label(ctx, 'Running the test suite', a.x, a.y, UI.blue, 34);
  fitText(ctx, m.file, a.x, a.y + 56, a.w, 60, { size: 44, color: UI.dim, font: `'JetBrains Mono', Menlo, monospace` });
  const y = a.y + 150;
  roundRect(ctx, a.x, y, a.w, 44, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  const k = m.total ? m.done / m.total : 0;
  roundRect(ctx, a.x, y, Math.max(44, a.w * k), 44, 22);
  ctx.fillStyle = m.failed ? UI.fire : UI.green;
  ctx.fill();
  fitText(ctx, `${m.passed.toLocaleString('en-US')} passed`, a.x, y + 80, a.w / 2, 100, { size: 76, weight: 800, color: UI.green });
  fitText(ctx, `${m.failed} failed`, a.x + a.w / 2, y + 80, a.w / 2, 100, { size: 76, weight: 800, color: m.failed ? UI.fire : '#7d8a99', align: 'right' });
}

function drawDone(ctx: CanvasRenderingContext2D, a: Area, m: { seconds: number; total: number }, c: CityData | null): void {
  fitText(ctx, 'All tests pass', a.x, a.y, a.w, 110, { size: 100, weight: 800, color: UI.green });
  const mm = Math.floor(m.seconds / 60);
  const ss = String(Math.floor(m.seconds % 60)).padStart(2, '0');
  fitText(ctx, `${m.total.toLocaleString('en-US')} of ${m.total.toLocaleString('en-US')} checks green. You found the fire, read the failing check and shipped the fix in ${mm}:${ss}.`, a.x, a.y + 130, a.w, 130, { size: 46 });
  fitText(ctx, c ? `Keep exploring ${c.name}: open any building, follow the lit routes between files, or load the next city.` : '', a.x, a.y + 290, a.w, 100, { size: 38, color: UI.dim });
}
