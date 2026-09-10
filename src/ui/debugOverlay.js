// F3 debug overlay: FPS, frame time, position, triangle/draw-call counts,
// and chunk streaming + occlusion stats. Biome name lands in phase 4.

export class DebugOverlay {
  constructor(el) {
    this.el = el;
    this.visible = false;
    this.frameTimes = [];
  }

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  update(stats) {
    if (!this.visible) return;

    this.frameTimes.push(stats.frameMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avgMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = Math.round(1000 / avgMs);

    const { x, y, z } = stats.position;
    const cs = stats.chunkStats;
    const lines = [
      `MineVoxel`,
      `FPS: ${fps}  frame: ${avgMs.toFixed(2)}ms`,
      `XYZ: ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Chunk: ${stats.chunkCoords.cx}, ${stats.chunkCoords.cz}`,
      `Facing: yaw ${stats.yawDeg.toFixed(0)}° pitch ${stats.pitchDeg.toFixed(0)}°`,
      `Triangles: ${stats.triangles.toLocaleString()}`,
      `Draw calls: ${stats.drawCalls}`,
      `Dimension: ${stats.dimensionName}`,
      `Biome: ${stats.biomeName ?? '—'}`,
      stats.mobCount !== undefined ? `Mobs: ${stats.mobCount}` : null,
    ].filter((l) => l !== null);
    if (cs) {
      lines.push(
        `Columns loaded: ${cs.loadedColumns}`,
        `Sections meshed: ${cs.meshedSections}  visible: ${cs.visibleSections}`,
        `Gen queue: ${cs.pendingGenerate}  Mesh queue: ${cs.pendingMesh}  Upload queue: ${cs.queuedUploads}`
      );
    }
    if (stats.player) {
      const p = stats.player;
      const mode = p.flying ? 'flying' : p.headInWater ? 'swimming' : p.onGround ? 'ground' : 'air';
      lines.push(
        `Mode: ${p.gameMode} (${mode})${p.sprinting ? ' sprint' : ''}${p.sneaking ? ' sneak' : ''}`,
        p.gameMode === 'survival' ? `Health: ${p.health.toFixed(0)}/${p.maxHealth}  Breath: ${p.breath.toFixed(1)}/${p.maxBreath}` : null,
        stats.timeOfDay !== undefined ? `Time of day: ${(stats.timeOfDay * 24).toFixed(1)}h` : null
      );
    }
    this.el.textContent = lines.filter((l) => l !== null).join('\n');
  }
}
