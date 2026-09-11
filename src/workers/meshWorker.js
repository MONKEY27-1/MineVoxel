import { greedyMeshSection, meshCrossBlocks } from '../mesh/greedy.js';
import { computeConnectivity } from '../mesh/connectivity.js';

// One atlasUV map per worker, sent once from chunkManager.js right after
// the worker is created (the atlas itself is built with <canvas>, which
// only exists on the main thread).
let atlasUV = null;

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    atlasUV = msg.atlasUV;
    return;
  }

  if (msg.type === 'mesh') {
    const { jobId, cx, cz, sy, blocks, skyLight, blockLight, borders, aoStrength } = msg;
    const { opaque, transparent } = greedyMeshSection(blocks, skyLight, blockLight, borders, atlasUV, aoStrength);
    const cross = meshCrossBlocks(blocks, skyLight, blockLight, atlasUV);
    const connectivity = computeConnectivity(blocks);

    const transfer = [];
    for (const part of [opaque, transparent, cross]) {
      if (!part) continue;
      transfer.push(part.positions.buffer, part.uvs.buffer, part.atlasRect.buffer, part.colors.buffer, part.indices.buffer);
    }

    self.postMessage({ type: 'meshed', jobId, cx, cz, sy, opaque, transparent, cross, connectivity }, transfer);
  }
};
