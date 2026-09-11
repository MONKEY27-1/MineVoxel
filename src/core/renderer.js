import * as THREE from 'three';
import { FxaaPass } from './postprocess.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.three = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // needed for the screenshot setting's canvas.toDataURL()
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.fxaa = new FxaaPass(this.three);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.three.setSize(w, h, false);
    this.fxaa.setSize(w, h);
    this.onResize?.(w, h);
  }

  render(camera) {
    if (this.fxaa.enabled) this.fxaa.render(this.scene, camera);
    else this.three.render(this.scene, camera);
  }

  /**
   * `scale` multiplies the *output* resolution only — the render target
   * is sized up, rendered once, downloaded, and the canvas immediately
   * restored to its normal size, so gameplay never actually runs at the
   * higher resolution just to take one screenshot.
   */
  captureScreenshot(camera, scale = 1) {
    // setSize() takes CSS pixels and multiplies by pixelRatio itself —
    // window.innerWidth/innerHeight (what resize() normally passes) is
    // the right "1x" baseline, not canvas.width/height (which is already
    // the post-pixelRatio drawing-buffer size and would double-scale).
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (scale !== 1) {
      this.three.setSize(w * scale, h * scale, false);
      this.three.render(this.scene, camera);
    }
    const dataUrl = this.canvas.toDataURL('image/png');
    if (scale !== 1) this.three.setSize(w, h, false);
    return dataUrl;
  }

  /**
   * Revision-pass section 3: the held-item view model is a separate
   * scene/camera, drawn after the world with the depth buffer cleared —
   * without that clear, the world's own depth values (often very close
   * to the near plane right in front of the camera) would make the held
   * item clip into nearby blocks instead of always drawing on top.
   *
   * Pre-existing bug found and fixed while verifying revision-pass
   * section 8's FXAA pass (which made it trivial to catch by reading the
   * canvas back as pixels instead of eyeballing a screenshot): `render()`
   * defaults to `autoClear: true`, so this second render call was also
   * clearing the *color* buffer — wiping out the just-drawn world —
   * before drawing the view model on top of what was left, which is
   * whatever's visible in the view-model scene (usually just the held
   * item) over a blank frame. `clearDepth()` alone was never enough;
   * autoClear has to be off for this one call, restored right after so
   * the next frame's real world render still gets its own normal clear.
   */
  renderOverlay(scene, camera) {
    this.three.autoClear = false;
    this.three.clearDepth();
    this.three.render(scene, camera);
    this.three.autoClear = true;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.three.dispose();
  }
}
