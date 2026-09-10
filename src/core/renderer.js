import * as THREE from 'three';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.three = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.three.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.three.setSize(w, h, false);
    this.onResize?.(w, h);
  }

  render(camera) {
    this.three.render(this.scene, camera);
  }

  /**
   * Revision-pass section 3: the held-item view model is a separate
   * scene/camera, drawn after the world with the depth buffer cleared —
   * without that clear, the world's own depth values (often very close
   * to the near plane right in front of the camera) would make the held
   * item clip into nearby blocks instead of always drawing on top.
   */
  renderOverlay(scene, camera) {
    this.three.clearDepth();
    this.three.render(scene, camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.three.dispose();
  }
}
