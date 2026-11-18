import { Color, MeshStandardMaterial } from '@iwsdk/core';

/**
 * The architectural-model building material: matte warm card with a
 * procedural window grid on the side faces (no textures, one draw call for the
 * whole city through InstancedMesh).
 *
 * Per-instance attributes (InstancedBufferAttribute):
 *   aInfo  vec4: floors (window rows), fire (0..1), hover (0..1), seed
 *   aFail  float: index of the failing floor (-1 = none)
 * Geometry must be a unit box with its base at y = 0 (x, z in [-0.5, 0.5]).
 * `uUnit` converts the instance scale (city units) to metres for the window
 * spacing, so windows keep a real size at any building size.
 */
export interface BuildingUniforms {
  uTime: { value: number };
  uUnit: { value: number };
  uGlow: { value: number };
  uWindow: { value: Color };
}

export function createBuildingMaterial(unit: number): { material: MeshStandardMaterial; uniforms: BuildingUniforms } {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  const uniforms: BuildingUniforms = {
    uTime: { value: 0 },
    uUnit: { value: unit },
    uGlow: { value: 1 },
    uWindow: { value: new Color(1.0, 0.8, 0.52) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aInfo;
attribute float aFail;
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
uniform vec3 uWindow;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vScale;
varying vec4 vInfo;
varying float vFail;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
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
    float isFail = (vFail >= 0.0 && abs(row - vFail) < 0.5) ? 1.0 : 0.0;
    float flick = 0.6 + 0.4 * sin(uTime * 13.0 + col * 1.7 + row) * sin(uTime * 7.3 + col);
    vec3 warm = uWindow * lit * uGlow;
    vec3 burn = vec3(1.0, 0.35, 0.08) * (1.4 + flick);
    totalEmissiveRadiance += win * mix(warm, burn, max(isFail, fire * step(rows - 1.5, row)));
    // soft contact darkening at the foot of every wall (cheap baked-AO look)
    diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.014, vObjPos.y * heightM));
    // a building on fire is scorched near the top
    diffuseColor.rgb *= 1.0 - fire * 0.55 * smoothstep(0.45, 1.0, vObjPos.y);
  } else if (n.y > 0.5) {
    // roof: slightly darker card with a parapet rim
    vec2 e = (0.5 - abs(vObjPos.xz)) * vScale.xz * uUnit;
    float rim = 1.0 - step(0.0016, min(e.x, e.y));
    diffuseColor.rgb *= mix(0.86, 1.0, rim);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.07, 0.06), fire * 0.9);
  }
  totalEmissiveRadiance += vec3(0.35, 0.65, 1.0) * hover * 0.35;
}`,
      );
  };
  material.customProgramCacheKey = () => 'repo-city-building-v1';
  return { material, uniforms };
}
