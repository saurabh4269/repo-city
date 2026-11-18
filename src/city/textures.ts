import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, TextureLoader, type Texture, type WebGLRenderer } from '@iwsdk/core';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * Compressed textures (KTX2: Basis UASTC/ETC1S, transcoded on the device to
 * ASTC on Quest, BC7 on desktop). The Basis transcoder is served from this
 * app's own origin (vite.config.ts copies it from @iwsdk/core's vendor folder
 * to /basis/), never from a CDN. PNG/JPG load as a fallback.
 */
let ktx2: KTX2Loader | null = null;
const png = new TextureLoader();

function loader(renderer: WebGLRenderer): KTX2Loader {
  if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
  return ktx2;
}

/** Load linear data (light atlas, shadow masks): no colour conversion, no flip, trilinear. */
export async function loadDataTexture(url: string, renderer: WebGLRenderer): Promise<Texture> {
  const t = url.endsWith('.ktx2') ? await loader(renderer).loadAsync(url) : await png.loadAsync(url);
  t.colorSpace = NoColorSpace;
  t.flipY = false;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
