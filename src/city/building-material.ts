import { Color, MeshStandardMaterial, type Texture } from '@iwsdk/core';
import { ATLAS, FACES, GROUND_HALF, GROUND_PX, TILE, TILE_COLS } from './light-layout.js';

/**
 * The architectural-model building material: matte warm card with a
 * procedural window grid on the side faces (no textures, one draw call for the
 * whole city through InstancedMesh).
 *
 * Per-instance attributes (InstancedBufferAttribute):
 *   aInfo  vec4: floors (window rows), fire (0..1), hover (0..1), seed
 *   aFail  float: index of the failing floor (-1 = none)
 *   aRoof  vec3: roof tint;  aMat float: roof roughness (per district)
 *   aTile  float: index into the baked light atlas (-1 = not baked, e.g. the open building's floors)
 * Geometry must be a unit box with its base at y = 0 (x, z in [-0.5, 0.5]).
 * `uUnit` converts the instance scale (city units) to metres for the window
 * spacing, so windows keep a real size at any building size.
 */
export interface BuildingUniforms {
  uTime: { value: number };
  uUnit: { value: number };
  uGlow: { value: number };
  uWindow: { value: Color };
  /** Baked light atlas (src/city/light-layout.ts) and whether one is loaded. */
  uLight: { value: Texture | null };
  uLightOn: { value: number };
  /** AO strength 0..1, and how far the city has risen (bakes fade in with it). */
  uAO: { value: number };
  uRise: { value: number };
}

/** GLSL: sample the light atlas and apply it to three.js's accumulated light. */
const LIGHT_GLSL = `
vec2 rcLightAt(vec2 px) { return texture2D(uLight, px / ${ATLAS.toFixed(1)}).rg; }
void rcApplyLight(vec2 L, inout ReflectedLight rl) {
  float ao = mix(1.0, 0.12 + 0.88 * pow(L.r, 1.5), uAO * uRise);
  float sv = mix(1.0, L.g, uRise);
  // the environment's bright window sits where the sun is: in the baked shade it is hidden too
  rl.indirectDiffuse *= ao * mix(1.0, sv, 0.35);
  rl.indirectSpecular *= ao;
  rl.directDiffuse *= sv * mix(1.0, ao, 0.75);
  rl.directSpecular *= sv * ao;
}`;
const LIGHT_UNIFORMS = `
uniform sampler2D uLight;
uniform float uLightOn;
uniform float uAO;
uniform float uRise;`;

/** Shared uniforms for every city surface that reads the baked light. */
export function createLightUniforms(): Pick<BuildingUniforms, 'uLight' | 'uLightOn' | 'uAO' | 'uRise'> {
  return { uLight: { value: null }, uLightOn: { value: 0 }, uAO: { value: 0.9 }, uRise: { value: 1 } };
}

/**
 * Ground surfaces (plinth top, district plates) read the top-down part of the
 * atlas. `scale` converts the mesh's local (instanced) position to city units.
 */
export function patchGroundMaterial(material: MeshStandardMaterial, light: ReturnType<typeof createLightUniforms>, scale: number, key: string): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, light);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGPos;\nvarying float vGUp;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 rcG = vec4(position, 1.0);
#ifdef USE_INSTANCING
rcG = instanceMatrix * rcG;
#endif
vGPos = rcG.xyz * ${scale.toFixed(6)};
vGUp = normal.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGPos;\nvarying float vGUp;${LIGHT_UNIFORMS}${LIGHT_GLSL}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
if (uLightOn > 0.5 && vGUp > 0.5) {
  vec2 g = (vGPos.xz + ${GROUND_HALF.toFixed(4)}) / ${(2 * GROUND_HALF).toFixed(4)};
  if (g.x >= 0.0 && g.x <= 1.0 && g.y >= 0.0 && g.y <= 1.0) rcApplyLight(rcLightAt(0.5 + g * ${(GROUND_PX - 1).toFixed(1)}), reflectedLight);
}`,
      );
  };
  material.customProgramCacheKey = () => `repo-city-ground-${key}`;
}

export function createBuildingMaterial(unit: number): { material: MeshStandardMaterial; uniforms: BuildingUniforms } {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  const uniforms: BuildingUniforms = {
    uTime: { value: 0 },
    uUnit: { value: unit },
    uGlow: { value: 1 },
    uWindow: { value: new Color(1.0, 0.8, 0.52) },
    ...createLightUniforms(),
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aInfo;
attribute float aFail;
attribute vec3 aRoof;
attribute float aMat;
attribute float aTile;
varying vec3 vRoof;
varying float vMat;
varying float vTile;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vScale;
varying vec4 vInfo;
varying float vFail;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vObjPos = position;
vRoof = aRoof;
vMat = aMat;
vTile = aTile;
vObjNormal = normal;
vInfo = aInfo;
vFail = aFail;
#ifdef USE_INSTANCING
vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#else
vScale = vec3(1.0);
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uUnit;
uniform float uGlow;
uniform vec3 uWindow;${LIGHT_UNIFORMS}
varying float vMat;
varying float vTile;
varying vec3 vRoof;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vScale;
varying vec4 vInfo;
varying float vFail;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }${LIGHT_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rcFace = -1.0;
vec2 rcUV = vec2(0.0);
bool rcBaked = uLightOn > 0.5 && vTile >= 0.0;
{
  vec3 n = vObjNormal;
  float fire = vInfo.y;
  float hover = vInfo.z;
  float heightM = vScale.y * uUnit;
  if (abs(n.y) < 0.5) {
    float u = abs(n.x) > 0.5 ? vObjPos.z * sign(n.x) : -vObjPos.x * sign(n.z);
    float faceW = (abs(n.x) > 0.5 ? vScale.z : vScale.x) * uUnit;
    float rows = max(1.0, vInfo.x);
    float fy = vObjPos.y * rows;
    float row = floor(fy);
    float fr = fract(fy);
    float cols = max(1.0, floor(faceW / 0.0075));
    float fu = (u + 0.5) * cols;
    float col = floor(fu);
    float fc = fract(fu);
    // Only draw windows when a row is tall enough to read (>= 4 mm).
    float rowM = heightM / rows;
    float big = step(0.004, rowM);
    float win = big * step(0.2, fc) * step(fc, 0.8) * step(0.3, fr) * step(fr, 0.74);
    // floor slab line between rows
    float slab = big * (1.0 - smoothstep(0.0, 0.07, fr)) * 0.5;
    float rnd = h31(vec3(row, col, vInfo.w * 17.0 + n.x * 3.0 + n.z * 7.0));
    float lit = step(0.3, rnd) * (0.75 + 0.25 * rnd);
    vec3 glass = vec3(0.13, 0.17, 0.22);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, slab);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
    // glass is smooth: it picks up the environment's reflections; the walls stay matte card
    roughnessFactor = mix(roughnessFactor, 0.14, win);
    rcFace = abs(n.x) > 0.5 ? (n.x > 0.0 ? 0.0 : 1.0) : (n.z > 0.0 ? 2.0 : 3.0);
    rcUV = vec2(((abs(n.x) > 0.5 ? vObjPos.z : vObjPos.x) + 0.48) / 0.96, sqrt(clamp(vObjPos.y, 0.0, 1.0)));
    float isFail = (vFail >= 0.0 && abs(row - vFail) < 0.5) ? 1.0 : 0.0;
    float flick = 0.6 + 0.4 * sin(uTime * 13.0 + col * 1.7 + row) * sin(uTime * 7.3 + col);
    vec3 warm = uWindow * lit * uGlow;
    vec3 burn = vec3(1.0, 0.35, 0.08) * (1.4 + flick);
    totalEmissiveRadiance += win * mix(warm, burn, max(isFail, fire * step(rows - 1.5, row)));
    // soft contact darkening at the foot of every wall; baked buildings get it from the atlas instead
    if (!rcBaked) diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.014, vObjPos.y * heightM));
    // a building on fire is scorched near the top
    diffuseColor.rgb *= 1.0 - fire * 0.55 * smoothstep(0.45, 1.0, vObjPos.y);
  } else if (n.y > 0.5) {
    // roof: slightly darker card with a parapet rim
    vec2 e = (0.5 - abs(vObjPos.xz)) * vScale.xz * uUnit;
    float rim = 1.0 - step(0.0016, min(e.x, e.y));
    // roofs carry their district's tint (the seated view sees mostly roofs); the parapet stays card
    diffuseColor.rgb = mix(vRoof, diffuseColor.rgb, rim);
    diffuseColor.rgb *= mix(0.92, 1.0, rim);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.07, 0.06), fire * 0.9);
    // painted/glazed roofs: a little sheen per district; the parapet stays card; a charred roof is matte
    roughnessFactor = mix(mix(vMat, roughnessFactor, rim), 0.95, fire);
    rcFace = 4.0;
    rcUV = (vObjPos.xz + 0.48) / 0.96;
  }
  totalEmissiveRadiance += vec3(0.35, 0.65, 1.0) * hover * 0.35;
}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
if (rcBaked && rcFace >= 0.0) {
  float t = vTile * ${FACES.toFixed(1)} + rcFace;
  vec2 org = vec2(${GROUND_PX.toFixed(1)} + mod(t, ${TILE_COLS.toFixed(1)}) * ${TILE.toFixed(1)}, floor(t / ${TILE_COLS.toFixed(1)}) * ${TILE.toFixed(1)});
  rcApplyLight(rcLightAt(org + 0.5 + clamp(rcUV, 0.0, 1.0) * ${(TILE - 1).toFixed(1)}), reflectedLight);
}`,
      );
  };
  material.customProgramCacheKey = () => 'repo-city-building-v2';
  return { material, uniforms };
}
