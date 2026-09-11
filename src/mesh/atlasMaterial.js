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
// Revision-pass section 8 adds two more optional, uniform-only shader
// features on top of the same shared material, so neither needs its own
// draw call or a remesh to turn on/off/animate:
//
// - `sway`: a cheap wind-sway vertex displacement, meant only for the
//   `cross` material (tall grass/flowers) — it reuses the *raw* `uv`
//   attribute's v-component as a height factor, no new attribute needed.
//   meshCrossBlocks (mesh/greedy.js) already emits uv.y = 0 at a plant
//   quad's rooted bottom edge and 1 at its free-swaying top edge (that's
//   just what its corner winding produces, not something added for this),
//   so `uv.y` is exactly "how much this vertex should move" for free.
//   Deliberately not wired into the opaque/transparent materials: greedy-
//   meshed quads reuse the same `uv` channel as a 0..w/0..h *tile-repeat*
//   coordinate (see this file's top comment), where large values would
//   make solid terrain shudder instead of sway — cross geometry is the
//   only place uv.y is guaranteed to be a clean 0..1 height.
// - `waterTint`: only meaningful on the `transparent` material (the
//   category water shares with glass/leaves/etc). There's no per-vertex
//   "is this water" flag either — instead the fragment shader compares
//   the already-varying `vAtlasRect` against a `waterRect` uniform (the
//   one atlas tile water always uses), and only tints/re-opacifies the
//   fragments that match.
// `sunShadow`: MeshBasicMaterial has `.lights = false`, so three.js never
// populates its automatic shadow-map/shadow-matrix uniforms for it the
// way it would for a Lambert/Standard material — the `#include
// <shadowmap_...>` chunks aren't even present in MeshBasicMaterial's base
// shader template to patch against. Real terrain shadows on this custom-
// lit material therefore need their own hand-rolled sampling: a manually
// computed shadow-space coordinate (via a `uShadowMatrix` this file's
// caller sets every frame from the light's own camera) and a manual
// single-tap depth compare against `uShadowMap` — no PCF softening,
// unlike three's built-in soft shadow maps, a deliberate scope cut for a
// first, "basic" shadow pass (see main.js's shadow setup for the caveat
// this was flagged to the user before building).
export function createAtlasMaterial(atlasTexture, opts = {}) {
  const { sway, waterTint, sunShadow, ...materialOpts } = opts;
  const material = new THREE.MeshBasicMaterial({
    map: atlasTexture,
    vertexColors: true,
    fog: true,
    ...materialOpts,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.dayFactor = { value: 1.0 };
    shader.uniforms.uTime = { value: 0 };
    if (sway) shader.uniforms.uSwayStrength = { value: 0 };
    if (waterTint) {
      shader.uniforms.waterRect = { value: new THREE.Vector4(-1, -1, -1, -1) };
      shader.uniforms.waterAlpha = { value: 1.0 };
      shader.uniforms.waterTintStrength = { value: 0.0 };
      shader.uniforms.waterTintColor = { value: new THREE.Color(0x2f6fa8) };
    }
    if (sunShadow) {
      shader.uniforms.uShadowMap = { value: null };
      shader.uniforms.uShadowMatrix = { value: new THREE.Matrix4() };
      shader.uniforms.uShadowEnabled = { value: 0 };
    }
    material.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 atlasRect;
        varying vec4 vAtlasRect;
        uniform float uTime;
        ${sway ? 'uniform float uSwayStrength;' : ''}
        ${sunShadow ? 'uniform mat4 uShadowMatrix;\nvarying vec4 vShadowCoord;' : ''}`
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAtlasRect = atlasRect;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${
          sway
            ? `
        float swayPhase = uTime * 1.6 + transformed.x * 0.6 + transformed.z * 0.6;
        transformed.x += sin(swayPhase) * uSwayStrength * uv.y * 0.12;
        transformed.z += cos(swayPhase * 0.8) * uSwayStrength * uv.y * 0.12;
        `
            : ''
        }
        ${sunShadow ? 'vShadowCoord = uShadowMatrix * modelMatrix * vec4( transformed, 1.0 );' : ''}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vAtlasRect;
        uniform float dayFactor;
        uniform float uTime;
        ${
          waterTint
            ? 'uniform vec4 waterRect;\nuniform float waterAlpha;\nuniform float waterTintStrength;\nuniform vec3 waterTintColor;'
            : ''
        }
        ${
          sunShadow
            ? `
        uniform sampler2D uShadowMap;
        uniform float uShadowEnabled;
        varying vec4 vShadowCoord;
        float mvSampleShadow() {
          vec3 coord = vShadowCoord.xyz / vShadowCoord.w * 0.5 + 0.5;
          if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
          // A single hard-edged tap produced visible acne banding on flat
          // ground (verified visually, not just in theory) at a tighter
          // bias — this widens the bias and averages 4 texel-offset taps
          // (a cheap poor-man's PCF, not three's real soft-shadow filter)
          // to soften both the acne and the shadow's own edge.
          float texel = 1.0 / 1024.0;
          float lit = 0.0;
          for (int dx = 0; dx < 2; dx++) {
            for (int dy = 0; dy < 2; dy++) {
              vec2 offset = vec2(float(dx) - 0.5, float(dy) - 0.5) * texel;
              float depth = texture2D( uShadowMap, coord.xy + offset ).r;
              lit += ( coord.z - 0.0035 > depth ) ? 0.35 : 1.0;
            }
          }
          return lit / 4.0;
        }
        `
            : ''
        }`
      )
      .replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
        vec2 mvTiled = fract( vMapUv );
        vec2 mvAtlasUv = mix( vAtlasRect.xy, vAtlasRect.zw, mvTiled );
        vec4 mvTexel = texture2D( map, mvAtlasUv );
        diffuseColor *= mvTexel;
        ${
          waterTint
            ? `
        if ( abs(vAtlasRect.x - waterRect.x) < 0.0005 && abs(vAtlasRect.y - waterRect.y) < 0.0005 ) {
          float ripple = 0.5 + 0.5 * sin(uTime * 1.2 + mvAtlasUv.x * 40.0 + mvAtlasUv.y * 40.0);
          diffuseColor.rgb = mix( diffuseColor.rgb, waterTintColor, waterTintStrength * (0.7 + 0.3 * ripple) );
          diffuseColor.a *= waterAlpha;
        }
        `
            : ''
        }
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
        float mvShadow = 1.0;
        ${sunShadow ? 'if ( uShadowEnabled > 0.5 ) mvShadow = mvSampleShadow();' : ''}
        diffuseColor.rgb *= vColor.r * mvLight * mvShadow;
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

export function setMaterialTime(material, value) {
  const shader = material.userData.shader;
  if (shader) shader.uniforms.uTime.value = value;
}

export function setSwayStrength(material, value) {
  const shader = material.userData.shader;
  if (shader && shader.uniforms.uSwayStrength) shader.uniforms.uSwayStrength.value = value;
}

export function setShadowUniforms(material, { map, matrix, enabled }) {
  const shader = material.userData.shader;
  if (!shader || !shader.uniforms.uShadowMap) return;
  if (map !== undefined) shader.uniforms.uShadowMap.value = map;
  if (matrix) shader.uniforms.uShadowMatrix.value.copy(matrix);
  if (enabled !== undefined) shader.uniforms.uShadowEnabled.value = enabled ? 1 : 0;
}

/** `rect` is the {u0,v0,u1,v1} atlasUV entry for the water tile. */
export function setWaterTint(material, { rect, alpha, tintStrength, tintColor }) {
  const shader = material.userData.shader;
  if (!shader || !shader.uniforms.waterRect) return;
  if (rect) shader.uniforms.waterRect.value.set(rect.u0, rect.v0, rect.u1, rect.v1);
  if (alpha !== undefined) shader.uniforms.waterAlpha.value = alpha;
  if (tintStrength !== undefined) shader.uniforms.waterTintStrength.value = tintStrength;
  if (tintColor !== undefined) shader.uniforms.waterTintColor.value.set(tintColor);
}
