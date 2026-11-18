/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { readFileSync } from 'node:fs';
import { questDebug } from './tools/quest-debug.mjs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serve the Basis Universal transcoder (KTX2 textures) from this origin at
 * /basis/, copied from @iwsdk/core's vendored build, instead of a CDN.
 */
function basisTranscoder(): Plugin {
  const dir = 'node_modules/@iwsdk/core/dist/vendor/basis/';
  const files: Record<string, string> = { 'basis_transcoder.js': 'text/javascript', 'basis_transcoder.wasm': 'application/wasm' };
  return {
    name: 'repo-city-basis-transcoder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/basis\/(basis_transcoder\.(?:js|wasm))(?:\?|$)/.exec(req.url ?? '');
        if (!m) return next();
        res.setHeader('Content-Type', files[m[1]]);
        res.end(readFileSync(dir + m[1]));
      });
    },
    generateBundle() {
      for (const f of Object.keys(files)) this.emitFile({ type: 'asset', fileName: `basis/${f}`, source: readFileSync(dir + f) });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), questDebug(), basisTranscoder()],
  server: { host: '0.0.0.0', port: 8083, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
