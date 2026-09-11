// Heuristic cave connectivity (revision pass, section 1 — the "heuristic,
// no hard guarantee" option): a region-grid of deterministic "cave
// network nodes", each a cavern chamber, linked to its nearest neighbor
// nodes by bored connector tunnels. Cheese/spaghetti caves (caves.js)
// still carve their own noise-based tunnels independently per column —
// this network is a SEPARATE, always-present layer on top of them, so
// long-distance connectivity doesn't depend on noise thresholds lining
// up by chance. Deep nodes sometimes grow a vertical shaft up toward the
// surface; shallow nodes sometimes punch all the way through as a
// walk-in entrance (sinkhole-style: a cone that widens near the top).
//
// This stays inside the existing per-column, stateless, worker-parallel
// generation model: every node/edge is a pure function of (seed, region
// coords, groundHeightAt) — any worker generating any column recomputes
// the identical network independently, the same deferred-placement
// principle structures/placement.js already uses, just for a much denser
// grid with actual pairwise connections instead of one blueprint per
// region. It does NOT flood-fill-verify every pocket connects (that
// needs region-batched generation — a bigger architecture change, out of
// scope for this pass) — instead it makes long connected crawls and
// structure reachability common by construction, via a real (if not
// exhaustively verified) graph.

const NODE_REGION_SIZE = 3; // chunks (~48 blocks) between nodes — dense enough for a real network
const SEARCH_RADIUS = 2; // regions around a query chunk considered for nodes/edges
// A plain 2-nearest-neighbor digraph (measured directly, see below) left
// roughly a third of surface-entrance nodes stranded in small isolated
// components with no *other* entrance reachable through the tunnel
// network at all — walk in, dead-end, no second way out, contradicting
// the whole point of a walk-in entrance. Measured across a 120x40-chunk
// area (seed 12345): at 2 connections/node, 4/6 entrance nodes shared one
// giant 486-node component (3 other entrances reachable each) while 2/6
// sat in tiny 3-12 node islands with zero other entrances reachable. At 3
// connections/node, all 6 joined a single 629-node component, each with 5
// other entrances reachable and roughly half the hop-distance to the
// nearest one. Bumped for that reason, not for tunnel density/aesthetics.
const CONNECTIONS_PER_NODE = 3;
const CHAMBER_BASE_RADIUS = 5;
const TUNNEL_RADIUS = 2.1;
const SHAFT_RADIUS = 1.8;

function hashCoords(seed, a, b, c) {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ a, 0x85ebca6b);
  h = Math.imul(h ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ c, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Closest distance from point (px,py,pz) to segment a-b. */
function distToSegment(px, py, pz, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 0 ? ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}

export function createCaveNetwork(seed) {
  const nodeCache = new Map();

  function computeNode(regionX, regionZ, groundHeightAt, isOceanAt) {
    const rnd = mulberry32(hashCoords(seed ^ 0x6e0da3f1, regionX, regionZ, 0));
    const originChunkX = regionX * NODE_REGION_SIZE;
    const originChunkZ = regionZ * NODE_REGION_SIZE;
    const span = NODE_REGION_SIZE * 16;
    const x = originChunkX * 16 + 8 + Math.floor(rnd() * (span - 16));
    const z = originChunkZ * 16 + 8 + Math.floor(rnd() * (span - 16));
    const surfaceHeight = groundHeightAt(x, z);

    const shallow = rnd() < 0.3;
    let y = shallow ? surfaceHeight - (10 + Math.floor(rnd() * 12)) : 8 + Math.floor(rnd() * 40);
    y = Math.min(y, surfaceHeight - 8);
    y = Math.max(y, 5);

    const radius = CHAMBER_BASE_RADIUS + rnd() * 4;
    const hasShaft = !shallow && rnd() < 0.45; // deep nodes sometimes grow a shaft toward the surface

    // "Fewer [entrances] on flat plains": sample height a couple dozen
    // blocks off in two directions and use the local variance to scale
    // the entrance chance — flat ground gets a fraction of the base
    // rate, hilly ground gets noticeably more. Base rate (0.06) was
    // tuned by directly measuring entrance nearest-neighbor spacing
    // against the 150-250 block target (an untuned 0.5 landed at a
    // median of just 63 blocks — several times too dense).
    const roughness = Math.abs(surfaceHeight - groundHeightAt(x + 24, z)) + Math.abs(surfaceHeight - groundHeightAt(x, z + 24));
    const roughnessFactor = Math.max(0.3, Math.min(1.8, roughness / 20));
    // Base rate re-derived after adding the roughness bias above: typical
    // terrain in this generator averages a roughnessFactor well under 1
    // (most rolling terrain sits at the 0.3 floor), which — measured —
    // dropped the plain 0.06 base down to a median 394-block spacing,
    // overshooting past the sparse end of the 150-250 target. 0.16
    // brought it back to the target range with the bias still intact.
    // Ocean/lake spots are excluded entirely — an "entrance" opening onto
    // a seafloor isn't a walk-in hillside mouth, it's just a leak (caught
    // by testing: the first entrance checked visually turned out to be
    // underwater).
    const hasEntrance = shallow && !isOceanAt(x, z) && rnd() < 0.16 * roughnessFactor;

    return { x, y, z, surfaceHeight, radius, shallow, hasShaft, hasEntrance };
  }

  function getNode(regionX, regionZ, groundHeightAt, isOceanAt) {
    const key = `${regionX},${regionZ}`;
    let n = nodeCache.get(key);
    if (!n) {
      n = computeNode(regionX, regionZ, groundHeightAt, isOceanAt);
      nodeCache.set(key, n);
    }
    return n;
  }

  function nodesNear(cx, cz, groundHeightAt, isOceanAt = () => false) {
    const rx = Math.floor(cx / NODE_REGION_SIZE);
    const rz = Math.floor(cz / NODE_REGION_SIZE);
    const out = [];
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++) {
        out.push(getNode(rx + dx, rz + dz, groundHeightAt, isOceanAt));
      }
    }
    return out;
  }

  /**
   * Edges are symmetric by construction: looping every nearby node and
   * connecting it to *its own* nearest neighbors naturally captures A-B
   * whichever side "picked" the other, which is closer to a real
   * connected graph than a strict mutual-nearest-neighbor (AND) test
   * would be — a plain 2-nearest-neighbor digraph leaves too many
   * components isolated.
   */
  function edgesNear(cx, cz, groundHeightAt, isOceanAt) {
    const nearby = nodesNear(cx, cz, groundHeightAt, isOceanAt);
    const edges = [];
    const seen = new Set();
    for (const node of nearby) {
      const neighbors = nearby
        .filter((o) => o !== node)
        .sort((a, b) => dist3(node, a) - dist3(node, b))
        .slice(0, CONNECTIONS_PER_NODE);
      for (const other of neighbors) {
        const key =
          node.x < other.x || (node.x === other.x && node.z < other.z)
            ? `${node.x},${node.y},${node.z}-${other.x},${other.y},${other.z}`
            : `${other.x},${other.y},${other.z}-${node.x},${node.y},${node.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([node, other]);
      }
    }
    return { nodes: nearby, edges };
  }

  // Generous but bounded margins so the per-block hot path (isNetworkCave)
  // never has to touch a node/edge that geometrically can't reach this
  // chunk — this is the difference between ~25 nodes/50 edges checked on
  // every single block query (which measured out to generation grinding
  // to a halt — tens of seconds for a dozen chunks) and the typical case
  // being an empty list checked in O(1). Node margin covers the widest
  // possible feature (entrance cone at the top of a shaft); edge margin
  // covers tunnel radius + wobble.
  const NODE_MARGIN = CHAMBER_BASE_RADIUS + 4 + 4 + 2; // chamber + shaft/entrance widening + wobble
  const EDGE_MARGIN = TUNNEL_RADIUS + 2;

  function chunkBoundsXZ(cx, cz) {
    return { x0: cx * 16, x1: cx * 16 + 16, z0: cz * 16, z1: cz * 16 + 16 };
  }

  function nodeNearChunk(node, b, margin) {
    return node.x >= b.x0 - margin && node.x <= b.x1 + margin && node.z >= b.z0 - margin && node.z <= b.z1 + margin;
  }

  function segmentNearChunk(a, o, b, margin) {
    const segMinX = Math.min(a.x, o.x) - margin;
    const segMaxX = Math.max(a.x, o.x) + margin;
    const segMinZ = Math.min(a.z, o.z) - margin;
    const segMaxZ = Math.max(a.z, o.z) + margin;
    return segMinX <= b.x1 && segMaxX >= b.x0 && segMinZ <= b.z1 && segMaxZ >= b.z0;
  }

  /**
   * Precompute everything relevant to one column — call once per chunk,
   * reuse across every (x,y,z) query in it. Filters nodes/edges down to
   * only ones whose bounding footprint can plausibly reach this specific
   * chunk (see the margin comment above) — without this, every block
   * query would redundantly re-check the whole regional node/edge set.
   */
  function columnContext(cx, cz, groundHeightAt, isOceanAt) {
    const { nodes, edges } = edgesNear(cx, cz, groundHeightAt, isOceanAt);
    const bounds = chunkBoundsXZ(cx, cz);
    const relevantNodes = nodes.filter((n) => nodeNearChunk(n, bounds, NODE_MARGIN));
    const relevantEdges = edges.filter(([a, b]) => segmentNearChunk(a, b, bounds, EDGE_MARGIN));
    return { nodes: relevantNodes, edges: relevantEdges };
  }

  /** True if (x,y,z) is inside a network chamber, connector tunnel, vertical shaft, or surface entrance cone. */
  function isNetworkCave(ctx, x, y, z, wobble) {
    if (ctx.nodes.length === 0 && ctx.edges.length === 0) return false;
    const w = wobble(x, z);

    for (const node of ctx.nodes) {
      if (dist3(node, { x, y, z }) < node.radius + w * 2) return true;

      if (node.hasShaft || node.hasEntrance) {
        const topY = node.hasEntrance ? node.surfaceHeight + 2 : node.surfaceHeight - 6;
        if (y >= node.y && y <= topY) {
          const localDxz = Math.hypot(x - (node.x + w * 1.5), z - (node.z + w * 1.5));
          // Sinkhole taper: widen the last ~10 blocks below the surface
          // into a real walk-in mouth. 0.35/block measured out to a
          // ~10-block-diameter crater at the surface, way past "walk-in,
          // not a 1-block hole" into "giant pit" — 0.15 lands a ~6-7
          // block diameter opening, clearly walkable without erasing the
          // hillside around it.
          const nearSurface = Math.max(0, y - (node.surfaceHeight - 10));
          const radius = SHAFT_RADIUS + (node.hasEntrance ? nearSurface * 0.15 : 0);
          if (localDxz < radius + w * 0.5) return true;
        }
      }
    }
    for (const [a, b] of ctx.edges) {
      if (distToSegment(x, y, z, a, b) < TUNNEL_RADIUS + w * 1.2) return true;
    }
    return false;
  }

  return { columnContext, isNetworkCave, nodesNear };
}
