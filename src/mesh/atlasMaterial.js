import * as THREE from 'three';

// Greedy-meshed quads can span many blocks, but each one must still show
// the atlas tile *repeated*, not stretched. Standard UV wrapping can't do
// that for a sub-rectangle of a shared atlas (repeat would sample past
// the tile into its neighbors), so every vertex carries the tile's atlas
// rect (atlasRect: u0,v0,u1,v1) and the regular `uv` attribute is reused
// as a 0..w / 0..h "repeat space" coordinate; the fragment shader folds
// it back into the tile with fract() before sampling.
//
// The vertex `color` attribute is repurposed too: instead of one baked
// brightness in all three channels, R carries the time-invariant
// shade*AO term, G carries sky light (0-1), B carries block light (0-1)
// — see mesh/greedy.js's emitQuad. That split is what lets day/night
// dim sky light in real time (a `dayFactor` uniform, updated once a
// frame) without touching block light or re-meshing anything: torches
// stay lit at night, only the sky channel scales.
//
// Verified against three@0.169.0's MeshBasicMaterial shader chunks:
// `#include <common>` opens both shaders exactly once, `#include
// <uv_vertex>` sets vMapUv in the vertex main(), `#include
// <map_fragment>` is the single diffuse-map sample site, and `#include
// <color_fragment>` is the single `diffuseColor.rgb *= vColor` site — the
// injection points below target exactly those.
export function createAtlasMaterial(atlasTexture, opts = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: atlasTexture,
    vertexColors: true,
    fog: true,
    ...opts,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.dayFactor = { value: 1.0 };
    material.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 atlasRect;\nvarying vec4 vAtlasRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAtlasRect = atlasRect;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vAtlasRect;\nuniform float dayFactor;')
      .replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
        vec2 mvTiled = fract( vMapUv );
        vec2 mvAtlasUv = mix( vAtlasRect.xy, vAtlasRect.zw, mvTiled );
        vec4 mvTexel = texture2D( map, mvAtlasUv );
        diffuseColor *= mvTexel;
        #endif
        `
      )
      .replace(
        '#include <color_fragment>',
        `
        #ifdef USE_COLOR
        float mvSky = vColor.g * dayFactor;
        float mvLight = max( mvSky, vColor.b );
        mvLight = max( mvLight, 0.06 );
        diffuseColor.rgb *= vColor.r * mvLight;
        #endif
        `
      );
  };

  return material;
}

/** No-op if the material hasn't compiled its shader yet (first frame or two). */
export function setDayFactor(material, value) {
  const shader = material.userData.shader;
  if (shader) shader.uniforms.dayFactor.value = value;
}
