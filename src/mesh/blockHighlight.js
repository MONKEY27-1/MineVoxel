import * as THREE from 'three';

// Target-block wireframe outline + a darkening overlay for break progress.
// A simplification worth flagging: real crack-stage textures (the
// spec asks for "a progress overlay with crack stages") would need their
// own atlas tiles and UV swapping per stage; this darkens the whole block
// instead, which reads fine but isn't stage-accurate cracked geometry.
export class BlockHighlight {
  constructor(scene) {
    this.scene = scene;

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.wireframe = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x0a0a0a, depthTest: true, transparent: true, opacity: 0.6 })
    );
    this.wireframe.scale.setScalar(1.002);
    this.wireframe.visible = false;
    scene.add(this.wireframe);

    this.crackMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), this.crackMaterial);
    this.crackMesh.visible = false;
    scene.add(this.crackMesh);
  }

  update(target, breakProgress) {
    if (!target) {
      this.wireframe.visible = false;
      this.crackMesh.visible = false;
      return;
    }
    const [x, y, z] = target.blockPos;
    this.wireframe.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.wireframe.visible = true;

    if (breakProgress > 0) {
      this.crackMesh.position.copy(this.wireframe.position);
      this.crackMaterial.opacity = Math.min(0.65, breakProgress * 0.7);
      this.crackMesh.visible = true;
    } else {
      this.crackMesh.visible = false;
    }
  }

  dispose() {
    this.scene.remove(this.wireframe, this.crackMesh);
    this.wireframe.geometry.dispose();
    this.wireframe.material.dispose();
    this.crackMesh.geometry.dispose();
    this.crackMaterial.dispose();
  }
}
