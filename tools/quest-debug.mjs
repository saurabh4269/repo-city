// Dev-only remote debugging for testing on a real Quest over Wi-Fi, with no adb.
//
// The dev server injects a tiny classic script at the top of index.html. On the headset it
// forwards console output, page errors and XR frame timing (fps, frame-time p95, long
// frames, draw calls per frame counted at the WebGL call) to the dev server every 2 s.
// The server appends them to artifacts/quest-log.jsonl, so whoever is at the Mac can read
// what the headset is doing:
//   tail -f artifacts/quest-log.jsonl | jq -c 'select(.quest)'
// Only active under `vite` dev (apply: 'serve'); nothing reaches the production build.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = String.raw`(() => {
  if (window.__questDebug) return;
  window.__questDebug = true;
  const page = Math.random().toString(36).slice(2, 8);
  const top = window.top === window;
  let q = [];
  const push = (kind, data) => {
    q.push(Object.assign({ t: Date.now(), page, top, kind }, data));
    if (q.length > 400) q = q.slice(-400);
  };
  const send = () => {
    if (!q.length) return;
    const body = JSON.stringify(q);
    q = [];
    try { fetch('/__quest-log', { method: 'POST', body, keepalive: body.length < 60000, headers: { 'content-type': 'application/json' } }).catch(() => {}); } catch (e) {}
  };
  const fmt = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.stack || String(v);
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  };
  for (const lvl of ['log', 'info', 'warn', 'error']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => {
      try { push('console', { lvl, msg: a.map(fmt).join(' ').slice(0, 4000) }); } catch (e) {}
      orig(...a);
    };
  }
  addEventListener('error', (e) => push('error', { msg: String(e.message), src: (e.filename || '') + ':' + e.lineno + ':' + e.colno, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 3000) : undefined }));
  addEventListener('unhandledrejection', (e) => push('error', { msg: 'unhandled rejection: ' + fmt(e.reason).slice(0, 3000) }));
  document.addEventListener('visibilitychange', () => push('page', { visibility: document.visibilityState }));
  push('hello', { ua: navigator.userAgent, url: location.href, dpr: devicePixelRatio, screen: screen.width + 'x' + screen.height });

  // Draw calls: count at the WebGL entry points; the XR frame loop reads and resets the counter.
  let draws = 0;
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const orig = C.prototype[fn];
      if (!orig) continue;
      C.prototype[fn] = function () { draws++; return orig.apply(this, arguments); };
    }
  }

  // XR session info and frame timing.
  let frames = [], drawSamples = [], lastT = 0, inXR = false;
  // Hook the live navigator.xr object and each session instance (not the prototypes): the
  // IWSDK emulator replaces navigator.xr after this script runs, so poll and re-wrap.
  const hookSession = (s, mode) => {
    inXR = true; frames = []; drawSamples = []; lastT = 0;
    push('xr', { event: 'start', mode, frameRate: s.frameRate, supportedFrameRates: s.supportedFrameRates ? Array.from(s.supportedFrameRates) : null, enabledFeatures: s.enabledFeatures ? Array.from(s.enabledFeatures) : null, blend: s.environmentBlendMode });
    s.addEventListener('end', () => { inXR = false; push('xr', { event: 'end' }); send(); });
    s.addEventListener('visibilitychange', () => push('xr', { event: 'visibility', state: s.visibilityState }));
    s.addEventListener('inputsourceschange', () => push('xr', { event: 'inputs', sources: Array.from(s.inputSources).map((i) => (i.hand ? 'hand-' : 'ctrl-') + i.handedness) }));
    const raf = s.requestAnimationFrame.bind(s);
    s.requestAnimationFrame = (cb) => raf(function (t, frame) {
      if (t !== lastT) {
        if (lastT) { frames.push(t - lastT); drawSamples.push(draws); }
        draws = 0; lastT = t;
      }
      return cb.call(this, t, frame);
    });
  };
  const wrapXR = () => {
    const xr = navigator.xr;
    if (!xr || xr.__questDebug) return;
    xr.__questDebug = true;
    const req = xr.requestSession.bind(xr);
    xr.requestSession = (mode, init) => {
      push('xr', { event: 'request', mode, init: fmt(init).slice(0, 1000) });
      return req(mode, init).then((s) => { try { hookSession(s, mode); } catch (e) { push('error', { msg: 'quest-debug hook: ' + e }); } return s; },
        (err) => { push('xr', { event: 'request-failed', msg: String(err) }); throw err; });
    };
  };
  wrapXR();
  setInterval(wrapXR, 500);
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  setInterval(() => {
    if (inXR && frames.length) {
      const sum = frames.reduce((a, b) => a + b, 0);
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined;
      push('perf', {
        fps: +(1000 * frames.length / sum).toFixed(1),
        p50ms: +pct(frames, 0.5).toFixed(1), p95ms: +pct(frames, 0.95).toFixed(1), maxms: +Math.max.apply(null, frames).toFixed(1),
        long: frames.filter((d) => d > 20).length, n: frames.length,
        draws: Math.round(drawSamples.reduce((a, b) => a + b, 0) / Math.max(1, drawSamples.length)), drawsMax: Math.max.apply(null, drawSamples.concat([0])),
        heapMB: mem,
      });
      frames = []; drawSamples = [];
    }
    send();
  }, 2000);
  addEventListener('pagehide', send);
})();`;

export function questDebug() {
  return {
    name: 'quest-debug',
    apply: 'serve',
    configureServer(server) {
      const dir = join(server.config.root, 'artifacts');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'quest-log.jsonl');
      server.middlewares.use('/__quest-debug.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(CLIENT);
      });
      server.middlewares.use('/__quest-log', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks = [];
        let n = 0;
        req.on('data', (c) => { n += c.length; if (n < 2_000_000) chunks.push(c); });
        req.on('end', () => {
          try {
            const ua = String(req.headers['user-agent'] || '');
            const quest = /OculusBrowser|Quest/i.test(ua);
            const ip = req.socket.remoteAddress;
            const items = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const lines = (Array.isArray(items) ? items : [items]).map((e) => JSON.stringify({ quest, ip, ...e }));
            if (lines.length) appendFileSync(file, lines.join('\n') + '\n');
          } catch { /* malformed batch: drop it */ }
          res.statusCode = 204;
          res.end();
        });
      });
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: '/__quest-debug.js' }, injectTo: 'head-prepend' }];
    },
  };
}
