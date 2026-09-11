import * as THREE from 'three';

// Revision-pass section 8's "Antialiasing: FXAA" option. No postprocessing
// library is used anywhere in this project (no bundler, no addons import
// map entry), so this is a minimal, hand-written edge-smoothing pass: the
// scene renders to an offscreen target, then a fullscreen triangle samples
// it with a small luminance-contrast edge blur. It's a simplified relative
// of real FXAA (not the full NVIDIA reference implementation with its
// sub-pixel/directional search), chosen because it's genuinely legible in
// under 40 lines rather than reproducing a much longer published shader
// verbatim — good enough to visibly soften the jaggies this game's flat-
// shaded voxel edges produce, which is what the setting is actually for.
//
// The renderer's own WebGL context is still created with `antialias:
// true` (see renderer.js) — that's fixed MSAA baked in at context
// creation and can't be toggled live without tearing down and rebuilding
// every GPU resource, so "Off" for this setting really means "no *extra*
// post-process AA on top of the context's own MSAA," not "no AA
// whatsoever." Documented in README rather than pretended away.
const FXAA_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 center = texture2D(tDiffuse, vUv).rgb;
    vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
    vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
    vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
    vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;

    float lC = luma(center);
    float lN = luma(n); float lS = luma(s); float lE = luma(e); float lW = luma(w);
    float lMin = min(lC, min(min(lN, lS), min(lE, lW)));
    float lMax = max(lC, max(max(lN, lS), max(lE, lW)));
    float contrast = lMax - lMin;

    // Only blend near a real edge (high local contrast) — otherwise flat
    // interior faces would get needlessly softened.
    float blend = smoothstep(0.05, 0.25, contrast);
    vec3 blurred = (center + n + s + e + w) / 5.0;
    gl_FragColor = vec4(mix(center, blurred, blend * 0.6), 1.0);
  }
`;

const FXAA_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export class FxaaPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;
    this.target = new THREE.WebGLRenderTarget(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FXAA_VERTEX,
      fragmentShader: FXAA_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.Camera();
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.target.setSize(w * pr, h * pr);
    this.material.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
  }

  /** Renders `scene`/`camera` through the FXAA pass to the canvas, instead of directly. */
  render(scene, camera) {
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(prevTarget);

    this.material.uniforms.tDiffuse.value = this.target.texture;
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
