// Every painter function that draws one 16x16 atlas tile — extracted
// out of atlas.js (which was pushing 1350+ lines, almost entirely this
// table) per POLISH.md's own file-size-split recommendation. Pure
// canvas-drawing code with zero THREE.js/build-orchestration
// dependency, which is exactly why this was the safe candidate — the
// split is mechanical (a straight code move, no logic changed) and
// verified with a pixel-for-pixel canvas comparison of the built atlas
// before/after, not just npm run smoke (a subtle mistake here would
// corrupt a texture silently, not crash anything).
//
// TILE is intentionally redefined here rather than imported from
// atlas.js — the alternative is a circular import (atlas.js imports
// `painters` from here, this file importing back from atlas.js), and
// this one constant (the fixed 16px tile size the whole atlas layout
// is built around) is about as stable a number as exists in this
// codebase.
const TILE = 16;

// Deterministic PRNG so the atlas looks the same every run.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx, ox, oy, base, variants, density, seed) {
  const rnd = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rnd() < density) {
        const c = variants[Math.floor(rnd() * variants.length)];
        ctx.fillStyle = c;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

export const painters = {
  stone(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a8a8a', ['#7d7d7d', '#959595', '#747474', '#8f8f8f'], 0.45, 11);
  },
  dirt(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a5a35', ['#7c4f2d', '#96633c', '#734a28'], 0.4, 22);
  },
  grass_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#5ea232', ['#559128', '#6bb23c', '#4d8322'], 0.45, 33);
  },
  grass_side(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a5a35', ['#7c4f2d', '#96633c', '#734a28'], 0.4, 22);
    const rnd = mulberry32(44);
    ctx.fillStyle = '#5ea232';
    const grassH = 5;
    ctx.fillRect(ox, oy, TILE, grassH);
    for (let x = 0; x < TILE; x++) {
      const dip = Math.floor(rnd() * 3);
      ctx.clearRect(ox + x, oy + grassH - dip, 1, dip);
      ctx.fillStyle = '#8a5a35';
      ctx.fillRect(ox + x, oy + grassH - dip, 1, dip);
      ctx.fillStyle = '#5ea232';
    }
    for (let x = 0; x < TILE; x++) {
      if (rnd() < 0.35) {
        ctx.fillStyle = rnd() < 0.5 ? '#559128' : '#6bb23c';
        ctx.fillRect(ox + x, oy + grassH - 1 - Math.floor(rnd() * 2), 1, 1);
      }
    }
  },
  sand(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#dbc878', ['#cdb968', '#e6d488', '#c2ac5c'], 0.35, 55);
  },
  sandstone_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#e0d3a0', ['#d4c48c', '#e8dcae'], 0.3, 66);
  },
  sandstone_side(ctx, ox, oy) {
    const rnd = mulberry32(77);
    ctx.fillStyle = '#e0d3a0';
    ctx.fillRect(ox, oy, TILE, TILE);
    for (let band = 0; band < 4; band++) {
      const y = band * 4;
      ctx.fillStyle = band % 2 === 0 ? '#d4c48c' : '#e8dcae';
      ctx.fillRect(ox, oy + y, TILE, 1);
    }
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#cdbd85' : '#e8dcae';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
    }
  },
  bedrock(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#2b2b2e', ['#1c1c1e', '#3a3a3d', '#242426'], 0.5, 88);
  },
  log_top(ctx, ox, oy) {
    const rnd = mulberry32(99);
    ctx.fillStyle = '#a9793f';
    ctx.fillRect(ox, oy, TILE, TILE);
    const cx = ox + TILE / 2;
    const cy = oy + TILE / 2;
    for (let r = TILE / 2; r > 0; r -= 1.6) {
      ctx.strokeStyle = Math.floor(r) % 2 === 0 ? '#8c5f2f' : '#a9793f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#7c5227';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
    }
  },
  log_side(ctx, ox, oy) {
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(ox, oy, TILE, TILE);
    for (let x = 0; x < TILE; x += 2) {
      ctx.fillStyle = x % 4 === 0 ? '#7c5028' : '#5f3c1e';
      ctx.fillRect(ox + x, oy, 2, TILE);
    }
    const rnd = mulberry32(101);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#523419';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
    }
  },
  leaves(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#3d7a26', ['#347018', '#468a2e', '#2c5e14', '#569b38'], 0.55, 121);
  },
  water(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#2a6fd6', ['#2560bd', '#3a80e8', '#1f57a8'], 0.3, 132);
  },
  gravel(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a8580', ['#6f6b67', '#a5a19b', '#59564f', '#9c988f'], 0.55, 143);
  },
  planks(ctx, ox, oy) {
    const rnd = mulberry32(154);
    ctx.fillStyle = '#b98b4e';
    ctx.fillRect(ox, oy, TILE, TILE);
    for (let y = 0; y < TILE; y += 4) {
      ctx.fillStyle = '#a97940';
      ctx.fillRect(ox, oy + y, TILE, 1);
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#9c6c37';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
    }
  },
  tall_grass(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(165);
    for (let x = 0; x < TILE; x++) {
      const h = 8 + Math.floor(rnd() * 8);
      ctx.strokeStyle = rnd() < 0.5 ? '#4d8b28' : '#5ea232';
      ctx.beginPath();
      ctx.moveTo(ox + x + 0.5, oy + TILE);
      ctx.lineTo(ox + x + 0.5 + (rnd() - 0.5) * 2, oy + TILE - h);
      ctx.stroke();
    }
  },

  // --- phase 4: biome set ---------------------------------------------
  birch_log_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#d9cfb8', ['#c9bda0', '#e6ddc8'], 0.35, 201);
    ctx.strokeStyle = '#a89a7a';
    for (let r = TILE / 2; r > 0; r -= 2) {
      ctx.beginPath();
      ctx.arc(ox + TILE / 2, oy + TILE / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  birch_log_side(ctx, ox, oy) {
    ctx.fillStyle = '#ddd3ba';
    ctx.fillRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(203);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#3a3226';
      const x = Math.floor(rnd() * TILE);
      const h = 1 + Math.floor(rnd() * 3);
      ctx.fillRect(ox + x, oy + Math.floor(rnd() * TILE), 1, h);
    }
  },
  birch_leaves(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#7bad3f', ['#6c9c34', '#8bbd52', '#5c8a28'], 0.5, 204);
  },
  spruce_log_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#5a3d22', ['#4c3119', '#67462a'], 0.3, 211);
    ctx.strokeStyle = '#3c2814';
    for (let r = TILE / 2; r > 0; r -= 1.8) {
      ctx.beginPath();
      ctx.arc(ox + TILE / 2, oy + TILE / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  spruce_log_side(ctx, ox, oy) {
    ctx.fillStyle = '#4a3018';
    ctx.fillRect(ox, oy, TILE, TILE);
    for (let x = 0; x < TILE; x += 2) {
      ctx.fillStyle = x % 4 === 0 ? '#573a1f' : '#3e2812';
      ctx.fillRect(ox + x, oy, 2, TILE);
    }
  },
  spruce_leaves(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#264d1e', ['#1e3f17', '#2f5c25', '#173611'], 0.55, 212);
  },
  jungle_log_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#7a5a34', ['#6c4d2a', '#87673e'], 0.3, 221);
    ctx.strokeStyle = '#5c4126';
    for (let r = TILE / 2; r > 0; r -= 1.8) {
      ctx.beginPath();
      ctx.arc(ox + TILE / 2, oy + TILE / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  jungle_log_side(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#6b4a28', ['#5c3f22', '#78552f', '#4f381f'], 0.35, 222);
  },
  jungle_leaves(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#2f7a1e', ['#256215', '#399228', '#1e5711'], 0.55, 223);
  },
  vine(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(224);
    for (let x = 0; x < TILE; x += 2) {
      if (rnd() < 0.6) continue;
      const h = 6 + Math.floor(rnd() * 10);
      ctx.strokeStyle = rnd() < 0.5 ? '#2f6b1c' : '#3d8225';
      ctx.beginPath();
      ctx.moveTo(ox + x + 0.5, oy);
      ctx.lineTo(ox + x + 0.5, oy + h);
      ctx.stroke();
    }
  },

  podzol_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#5b3f24', ['#4d341c', '#684a2c', '#3f2c18'], 0.45, 231);
  },
  podzol_side(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a5a35', ['#7c4f2d', '#96633c'], 0.4, 232);
    ctx.fillStyle = '#5b3f24';
    ctx.fillRect(ox, oy, TILE, 4);
  },
  mycelium_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8579a3', ['#766b96', '#9488b3', '#665c86'], 0.5, 241);
  },
  mycelium_side(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a5a35', ['#7c4f2d', '#96633c'], 0.4, 242);
    ctx.fillStyle = '#8579a3';
    ctx.fillRect(ox, oy, TILE, 4);
  },
  mud(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#3f3a3a', ['#332f2f', '#4a4444', '#292626'], 0.4, 251);
  },
  clay(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#9fa3ad', ['#8f939d', '#aeb2bc', '#7f838d'], 0.35, 252);
  },
  snow(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#f2f6fb', ['#e6ecf5', '#fbfdff', '#d9e1ec'], 0.3, 253);
  },
  ice(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#9fd0e8', ['#8fc3de', '#b0dcef', '#7fb6d4'], 0.3, 254);
  },
  packed_ice(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#a9d5ec', ['#98c8e3', '#bae1f2', '#87bbd9'], 0.4, 255);
  },

  cactus_top(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#3a7d33', ['#326d2c', '#448d3c'], 0.4, 261);
  },
  cactus_side(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#347030', ['#2c6028', '#3d8038'], 0.35, 262);
    const rnd = mulberry32(263);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#dce8d0';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 2);
    }
  },
  dead_bush(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(264);
    ctx.strokeStyle = '#8a6a3c';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + TILE / 2, oy + TILE);
      ctx.lineTo(ox + rnd() * TILE, oy + TILE - rnd() * TILE * 0.9);
      ctx.stroke();
    }
  },
  poppy(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    ctx.strokeStyle = '#3d7a26';
    ctx.beginPath();
    ctx.moveTo(ox + TILE / 2 + 0.5, oy + TILE);
    ctx.lineTo(ox + TILE / 2 + 0.5, oy + TILE * 0.55);
    ctx.stroke();
    ctx.fillStyle = '#d3232e';
    ctx.fillRect(ox + TILE / 2 - 2, oy + TILE * 0.35, 5, 5);
    ctx.fillStyle = '#f0c419';
    ctx.fillRect(ox + TILE / 2 - 1, oy + TILE * 0.35 + 1, 2, 2);
  },
  fern(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(265);
    for (let x = 1; x < TILE; x += 2) {
      const h = 5 + Math.floor(rnd() * 6);
      ctx.strokeStyle = rnd() < 0.5 ? '#2f5c1e' : '#3d7327';
      ctx.beginPath();
      ctx.moveTo(ox + x + 0.5, oy + TILE);
      ctx.lineTo(ox + x + 0.5, oy + TILE - h);
      ctx.stroke();
    }
  },
  brown_mushroom(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    ctx.strokeStyle = '#c9b89a';
    ctx.beginPath();
    ctx.moveTo(ox + TILE / 2 + 0.5, oy + TILE);
    ctx.lineTo(ox + TILE / 2 + 0.5, oy + TILE * 0.6);
    ctx.stroke();
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(ox + TILE / 2 - 3, oy + TILE * 0.45, 7, 4);
  },
  bamboo(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    ctx.strokeStyle = '#6bab3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + TILE / 2, oy + TILE);
    ctx.lineTo(ox + TILE / 2, oy);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#4d8a26';
    for (let y = 2; y < TILE; y += 4) {
      ctx.beginPath();
      ctx.moveTo(ox + TILE / 2 - 2, oy + y);
      ctx.lineTo(ox + TILE / 2 + 2, oy + y);
      ctx.stroke();
    }
  },
  sweet_berry_bush(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(266);
    ctx.strokeStyle = '#3d6b28';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + TILE / 2, oy + TILE);
      ctx.lineTo(ox + rnd() * TILE, oy + TILE - rnd() * TILE * 0.7);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#7a1f3d';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + TILE * 0.3 + Math.floor(rnd() * TILE * 0.5), 2, 2);
    }
  },
  lily_pad(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    ctx.fillStyle = '#3d7a2e';
    ctx.beginPath();
    ctx.arc(ox + TILE / 2, oy + TILE / 2, TILE * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2c5c20';
    ctx.stroke();
  },
  seagrass(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(267);
    for (let x = 1; x < TILE; x += 2) {
      const h = 6 + Math.floor(rnd() * 8);
      ctx.strokeStyle = rnd() < 0.5 ? '#2f8a4e' : '#3ca85e';
      ctx.beginPath();
      ctx.moveTo(ox + x + 0.5, oy + TILE);
      ctx.lineTo(ox + x + 0.5 + (rnd() - 0.5) * 3, oy + TILE - h);
      ctx.stroke();
    }
  },
  kelp(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(268);
    ctx.strokeStyle = '#2c5c2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + TILE / 2, oy + TILE);
    let x = ox + TILE / 2;
    for (let y = TILE; y > 0; y -= 3) {
      x += (rnd() - 0.5) * 3;
      ctx.lineTo(x, oy + y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  },

  mushroom_stem(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#e8ddc4', ['#dccfae', '#f2e8d2'], 0.3, 271);
  },
  red_mushroom_cap(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#b8281f', ['#a41f17', '#c73528'], 0.25, 272);
    const rnd = mulberry32(273);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#f2ece0';
      const r = 1 + Math.floor(rnd() * 2);
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), r, r);
    }
  },
  brown_mushroom_cap(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#7a5c3c', ['#6c4f32', '#886947'], 0.35, 274);
  },

  coal_ore(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a8a8a', ['#7d7d7d', '#959595'], 0.4, 281);
    const rnd = mulberry32(282);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#1c1c1e';
      const r = 1 + Math.floor(rnd() * 2);
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), r, r);
    }
  },
  iron_ore(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a8a8a', ['#7d7d7d', '#959595'], 0.4, 283);
    const rnd = mulberry32(284);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#d8b898';
      const r = 1 + Math.floor(rnd() * 2);
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), r, r);
    }
  },
  gold_ore(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a8a8a', ['#7d7d7d', '#959595'], 0.4, 285);
    const rnd = mulberry32(286);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#f2d543';
      const r = 1 + Math.floor(rnd() * 2);
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), r, r);
    }
  },
  diamond_ore(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8a8a8a', ['#7d7d7d', '#959595'], 0.4, 287);
    const rnd = mulberry32(288);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#6be8e0';
      const r = 1 + Math.floor(rnd() * 2);
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), r, r);
    }
  },

  glowstone(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#e8c15a', ['#f2d060', '#d9a83f', '#fce08a'], 0.5, 291);
  },
  glass(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE, TILE);
    ctx.strokeStyle = 'rgba(220,235,240,0.7)';
    ctx.strokeRect(ox + 0.5, oy + 0.5, TILE - 1, TILE - 1);
    ctx.fillStyle = 'rgba(220,235,240,0.12)';
    ctx.fillRect(ox, oy, TILE, TILE);
    const rnd = mulberry32(292);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
    }
  },
  cobblestone(ctx, ox, oy) {
    speckle(ctx, ox, oy, '#8f8f8f', ['#7a7a7a', '#a0a0a0', '#6d6d6d', '#999999'], 0.5, 293);
    const rnd = mulberry32(294);
    ctx.strokeStyle = '#5c5c5c';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const x = Math.floor(rnd() * TILE);
      const y = Math.floor(rnd() * TILE);
      ctx.arc(ox + x, oy + y, 2 + rnd() * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};

// --- Item icons (phase 6): small centered sprites rather than tileable
// surfaces, but they live in the same atlas/painter system since
// itemIconTile() (items/items.js) just resolves to another tile name.
const TOOL_HEAD_COLOR = { wooden: '#8b5a2b', stone: '#8a8a8a', iron: '#d8d8d8', voidsteel: '#3a3550' };

function drawToolHandle(ctx, ox, oy) {
  ctx.strokeStyle = '#6b4423';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + 14);
  ctx.lineTo(ox + 9, oy + 8);
  ctx.stroke();
}

const TOOL_HEAD_PAINTERS = {
  pickaxe(ctx, ox, oy, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ox + 3, oy + 5);
    ctx.lineTo(ox + 9, oy + 2);
    ctx.lineTo(ox + 14, oy + 6);
    ctx.stroke();
  },
  axe(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ox + 5, oy + 2);
    ctx.lineTo(ox + 14, oy + 3);
    ctx.lineTo(ox + 13, oy + 9);
    ctx.lineTo(ox + 7, oy + 8);
    ctx.closePath();
    ctx.fill();
  },
  shovel(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + 6, oy + 1, 6, 6);
  },
  sword(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + 7, oy + 1, 3, 10);
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(ox + 4, oy + 10, 9, 2);
  },
};

for (const toolType of Object.keys(TOOL_HEAD_PAINTERS)) {
  for (const material of Object.keys(TOOL_HEAD_COLOR)) {
    painters[`${material}_${toolType}`] = (ctx, ox, oy) => {
      TOOL_HEAD_PAINTERS[toolType](ctx, ox, oy, TOOL_HEAD_COLOR[material]);
      if (toolType !== 'sword') drawToolHandle(ctx, ox, oy);
    };
  }
}

painters.stick = (ctx, ox, oy) => {
  ctx.strokeStyle = '#8b5a2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + 13);
  ctx.lineTo(ox + 13, oy + 3);
  ctx.stroke();
};
painters.coal = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#1c1c1e', ['#141416', '#2a2a2c'], 0.3, 401);
};
painters.charcoal = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#2b2320', ['#211a18', '#382d29'], 0.3, 402);
};
painters.iron_ingot = (ctx, ox, oy) => {
  ctx.fillStyle = '#d8d3c8';
  ctx.fillRect(ox + 3, oy + 5, 10, 6);
  ctx.fillStyle = '#b8b2a4';
  ctx.fillRect(ox + 3, oy + 9, 10, 2);
};
painters.gold_ingot = (ctx, ox, oy) => {
  ctx.fillStyle = '#f2d543';
  ctx.fillRect(ox + 3, oy + 5, 10, 6);
  ctx.fillStyle = '#d0ab24';
  ctx.fillRect(ox + 3, oy + 9, 10, 2);
};
painters.crafting_table_top = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#a9793f', ['#9c6c37', '#b98b4e'], 0.35, 411);
  ctx.strokeStyle = '#6b4423';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 2, oy + 2, 5, 5);
  ctx.strokeRect(ox + 9, oy + 2, 5, 5);
  ctx.beginPath();
  ctx.moveTo(ox + 2, oy + 10);
  ctx.lineTo(ox + 14, oy + 10);
  ctx.stroke();
};
painters.crafting_table_side = (ctx, ox, oy) => {
  painters.planks(ctx, ox, oy);
  ctx.strokeStyle = '#4a3018';
  ctx.strokeRect(ox + 2, oy + 2, 12, 12);
};
painters.furnace_top = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#6d6d6d', ['#5f5f5f', '#7a7a7a'], 0.4, 412);
};
painters.furnace_side = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#6d6d6d', ['#5f5f5f', '#7a7a7a'], 0.4, 413);
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(ox + 5, oy + 9, 6, 5);
  ctx.fillStyle = '#e8781e';
  ctx.fillRect(ox + 6, oy + 10, 4, 3);
};
painters.chest_top = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#9c6c37', ['#8b5e2e', '#a97a42'], 0.35, 414);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(ox + 6, oy + 6, 4, 4);
};
painters.chest_side = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#9c6c37', ['#8b5e2e', '#a97a42'], 0.35, 415);
  ctx.strokeStyle = '#5c3d1c';
  ctx.strokeRect(ox + 1, oy + 1, 14, 5);
  ctx.strokeRect(ox + 1, oy + 7, 14, 7);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(ox + 6, oy + 5, 4, 3);
};

painters.diamond = (ctx, ox, oy) => {
  ctx.fillStyle = '#6be8e0';
  ctx.beginPath();
  ctx.moveTo(ox + 8, oy + 2);
  ctx.lineTo(ox + 13, oy + 7);
  ctx.lineTo(ox + 8, oy + 14);
  ctx.lineTo(ox + 3, oy + 7);
  ctx.closePath();
  ctx.fill();
};

// --- phase 7: structures ---
painters.lava = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#e8781e', ['#ff9a33', '#c25a10', '#ffcf6b'], 0.4, 501);
};
painters.mossy_cobblestone = (ctx, ox, oy) => {
  painters.cobblestone(ctx, ox, oy);
  const rnd = mulberry32(503);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rnd() < 0.28) {
        ctx.fillStyle = rnd() < 0.5 ? '#4a7a2e' : '#3d6624';
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
};
painters.monster_spawner = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#1c2b30', ['#16232a', '#243840'], 0.35, 504);
  ctx.strokeStyle = '#3a5a66';
  ctx.strokeRect(ox + 2, oy + 2, 12, 12);
};
painters.rail = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(ox + 2, oy, 2, TILE);
  ctx.fillRect(ox + 12, oy, 2, TILE);
  ctx.fillStyle = '#8b5a2b';
  for (let y = 1; y < TILE; y += 4) ctx.fillRect(ox, oy + y, TILE, 1);
};
painters.cobweb = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.strokeStyle = 'rgba(235,235,235,0.7)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= TILE; i += 4) {
    ctx.beginPath();
    ctx.moveTo(ox + i, oy);
    ctx.lineTo(ox + TILE - i, oy + TILE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, oy + i);
    ctx.lineTo(ox + TILE, oy + TILE - i);
    ctx.stroke();
  }
};
painters.sandstone_chiseled_side = (ctx, ox, oy) => {
  painters.sandstone_top(ctx, ox, oy);
  ctx.strokeStyle = '#c2b27c';
  ctx.strokeRect(ox + 3, oy + 2, 10, 5);
  ctx.strokeRect(ox + 3, oy + 9, 10, 5);
};
painters.tnt_top = (ctx, ox, oy) => {
  ctx.fillStyle = '#c23a2e';
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#e8e0c8';
  ctx.fillRect(ox + 4, oy + 4, 8, 8);
};
painters.tnt_side = (ctx, ox, oy) => {
  ctx.fillStyle = '#dedede';
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#c23a2e';
  ctx.fillRect(ox, oy + 5, TILE, 6);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '6px monospace';
  ctx.fillText('TNT', ox + 1, oy + 9);
};
// Phase 7 follow-up: TNT's armed-fuse flash frame — main.js alternates
// the real block between TNT and this every fraction of a second while
// lit (see TNT_LIT in blocks.js). Same layout as tnt_top/tnt_side, just
// blown out toward white so the swap actually reads as a flash.
painters.tnt_top_lit = (ctx, ox, oy) => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#ffe9b8';
  ctx.fillRect(ox + 4, oy + 4, 8, 8);
};
painters.tnt_side_lit = (ctx, ox, oy) => {
  ctx.fillStyle = '#fff6e6';
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ox, oy + 5, TILE, 6);
  ctx.fillStyle = '#c23a2e';
  ctx.font = '6px monospace';
  ctx.fillText('TNT', ox + 1, oy + 9);
};
painters.stone_bricks = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#8a8a8a', ['#7d7d7d', '#959595'], 0.3, 505);
  ctx.strokeStyle = '#5c5c5c';
  ctx.strokeRect(ox, oy, 8, 8);
  ctx.strokeRect(ox + 8, oy, 8, 8);
  ctx.strokeRect(ox, oy + 8, 8, 8);
  ctx.strokeRect(ox + 8, oy + 8, 8, 8);
};
painters.hay_top = (ctx, ox, oy) => {
  ctx.fillStyle = '#d4b23c';
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.strokeStyle = '#b89428';
  for (let r = 2; r < TILE; r += 5) {
    ctx.beginPath();
    ctx.arc(ox + TILE / 2, oy + TILE / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
};
painters.hay_side = (ctx, ox, oy) => {
  ctx.fillStyle = '#d4b23c';
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.strokeStyle = '#b89428';
  ctx.lineWidth = 1;
  for (let x = 1; x < TILE; x += 3) {
    ctx.beginPath();
    ctx.moveTo(ox + x, oy);
    ctx.lineTo(ox + x, oy + TILE);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8f7420';
  ctx.strokeRect(ox, oy, TILE, TILE);
};
painters.wheat_crop = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  const rnd = mulberry32(506);
  for (let x = 1; x < TILE; x += 2) {
    const h = 10 + Math.floor(rnd() * 5);
    ctx.strokeStyle = rnd() < 0.5 ? '#d4c23c' : '#a8c93c';
    ctx.beginPath();
    ctx.moveTo(ox + x, oy + TILE);
    ctx.lineTo(ox + x, oy + TILE - h);
    ctx.stroke();
  }
};
painters.farmland_top = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#5a3d24', ['#4d3320', '#664228'], 0.35, 507);
  ctx.strokeStyle = '#3d2818';
  for (let y = 2; y < TILE; y += 4) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + y);
    ctx.lineTo(ox + TILE, oy + y);
    ctx.stroke();
  }
};

// --- phase 8: mob drop item icons ---
// These are only ever used as item icons (hotbar/inventory slots, the
// small cube dropped-item mesh in itemDrop.js) — never a block face — so
// each clears its tile to transparent first and draws a small centered
// icon, the same convention wheat_crop/cobweb/rail already use above for
// non-block-texture tiles.
painters.rotten_flesh = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#7a6b3a';
  ctx.fillRect(ox + 3, oy + 4, 10, 8);
  const rnd = mulberry32(601);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#5c8f3a' : '#4a3018';
    ctx.fillRect(ox + 3 + Math.floor(rnd() * 10), oy + 4 + Math.floor(rnd() * 8), 1, 1);
  }
};
painters.bone = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#e8e2d0';
  ctx.fillRect(ox + 4, oy + 6, 8, 3);
  ctx.beginPath();
  ctx.arc(ox + 4, oy + 5, 2, 0, Math.PI * 2);
  ctx.arc(ox + 4, oy + 10, 2, 0, Math.PI * 2);
  ctx.arc(ox + 12, oy + 5, 2, 0, Math.PI * 2);
  ctx.arc(ox + 12, oy + 10, 2, 0, Math.PI * 2);
  ctx.fill();
};
painters.string = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.strokeStyle = '#e8e6dc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + 2, oy + 2);
  for (let x = 2; x <= 14; x += 3) ctx.lineTo(ox + x, oy + (x % 6 === 2 ? 5 : 11));
  ctx.stroke();
};
painters.arrow = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.strokeStyle = '#8b5a2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + 13);
  ctx.lineTo(ox + 12, oy + 4);
  ctx.stroke();
  ctx.fillStyle = '#9c9c9c';
  ctx.beginPath();
  ctx.moveTo(ox + 12, oy + 4);
  ctx.lineTo(ox + 14, oy + 1);
  ctx.lineTo(ox + 15, oy + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8e0c8';
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + 13);
  ctx.lineTo(ox + 1, oy + 15);
  ctx.lineTo(ox + 5, oy + 14);
  ctx.closePath();
  ctx.fill();
};
painters.feather = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#f2f2ea';
  ctx.beginPath();
  ctx.moveTo(ox + 11, oy + 2);
  ctx.quadraticCurveTo(ox + 4, oy + 5, ox + 4, oy + 13);
  ctx.quadraticCurveTo(ox + 9, oy + 11, ox + 11, oy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9c9bd';
  ctx.beginPath();
  ctx.moveTo(ox + 10, oy + 3);
  ctx.lineTo(ox + 4, oy + 13);
  ctx.stroke();
};
painters.leather = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#a9702f';
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + 4);
  ctx.lineTo(ox + 13, oy + 3);
  ctx.lineTo(ox + 12, oy + 13);
  ctx.lineTo(ox + 4, oy + 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7a4f1f';
  ctx.stroke();
};
painters.raw_beef = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#c2453f';
  ctx.fillRect(ox + 2, oy + 4, 12, 8);
  ctx.fillStyle = '#e8bcb8';
  ctx.fillRect(ox + 2, oy + 4, 12, 2);
  const rnd = mulberry32(602);
  ctx.strokeStyle = '#8f2e28';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const y = oy + 6 + i * 2;
    ctx.moveTo(ox + 3, y);
    ctx.lineTo(ox + 13, y + (rnd() < 0.5 ? -1 : 1));
    ctx.stroke();
  }
};
painters.porkchop = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#e0a0a0';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 9, 6, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8e2d0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + 12, oy + 5);
  ctx.lineTo(ox + 15, oy + 2);
  ctx.stroke();
};
painters.raw_chicken = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#e8c9c2';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 9, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9a89a';
  ctx.beginPath();
  ctx.arc(ox + 11, oy + 6, 2, 0, Math.PI * 2);
  ctx.fill();
};

painters.obsidian = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#0a0612', ['#1b0f33', '#2a1854', '#050308'], 0.4, 703);
};

// --- The Cinderdeep (dimension 2) ---------------------------------------

function ringTop(ctx, ox, oy, base, ring, speck, seed) {
  const rnd = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, TILE, TILE);
  const cx = ox + TILE / 2;
  const cy = oy + TILE / 2;
  for (let r = TILE / 2; r > 0; r -= 1.6) {
    ctx.strokeStyle = Math.floor(r) % 2 === 0 ? ring : base;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = speck;
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
}

function stripeSide(ctx, ox, oy, base, stripe, speck, seed) {
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let x = 0; x < TILE; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? stripe : base;
    ctx.fillRect(ox + x, oy, 2, TILE);
  }
  const rnd = mulberry32(seed);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = speck;
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
}

function brickGrid(ctx, ox, oy, base, mortar, seed, brickW = 8, brickH = 4) {
  speckle(ctx, ox, oy, base, [base], 0, seed);
  ctx.strokeStyle = mortar;
  for (let row = 0; row * brickH < TILE; row++) {
    const y = row * brickH;
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    ctx.beginPath();
    ctx.moveTo(ox, oy + y + 0.5);
    ctx.lineTo(ox + TILE, oy + y + 0.5);
    ctx.stroke();
    for (let x = -brickW; x < TILE + brickW; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(ox + x + offset + 0.5, oy + y);
      ctx.lineTo(ox + x + offset + 0.5, oy + y + brickH);
      ctx.stroke();
    }
  }
}

function glowBlob(ctx, ox, oy, core, mid, outer, seed) {
  ctx.fillStyle = outer;
  ctx.fillRect(ox, oy, TILE, TILE);
  ctx.fillStyle = mid;
  ctx.fillRect(ox + 2, oy + 2, TILE - 4, TILE - 4);
  ctx.fillStyle = core;
  ctx.fillRect(ox + 5, oy + 5, TILE - 10, TILE - 10);
  const rnd = mulberry32(seed);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = core;
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
}

function thinCross(ctx, ox, oy, variants, seed, count = 5) {
  ctx.clearRect(ox, oy, TILE, TILE);
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = 2 + Math.floor(rnd() * (TILE - 4));
    const h = 5 + Math.floor(rnd() * 8);
    ctx.strokeStyle = variants[Math.floor(rnd() * variants.length)];
    ctx.beginPath();
    ctx.moveTo(ox + x + 0.5, oy + TILE);
    ctx.lineTo(ox + x + 0.5 + (rnd() - 0.5) * 3, oy + TILE - h);
    ctx.stroke();
  }
}

painters.cinderstone = (ctx, ox, oy) => speckle(ctx, ox, oy, '#5a2020', ['#4a1818', '#6e2a26', '#3d1414', '#7a3428'], 0.55, 801);
painters.soul_sand = (ctx, ox, oy) => speckle(ctx, ox, oy, '#4a3f38', ['#3c332d', '#584c43', '#2e2723'], 0.5, 802);
painters.soul_soil = (ctx, ox, oy) => speckle(ctx, ox, oy, '#3a2f2a', ['#2e2622', '#463a33'], 0.4, 803);
painters.quartz_ore = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#5a2020', ['#4a1818', '#6e2a26'], 0.45, 804);
  const rnd = mulberry32(805);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = '#e8e2d8';
    const x = ox + Math.floor(rnd() * (TILE - 3));
    const y = oy + Math.floor(rnd() * (TILE - 3));
    ctx.fillRect(x, y, 2, 2);
  }
};
painters.cinderbrick = (ctx, ox, oy) => brickGrid(ctx, ox, oy, '#3d1a1a', '#241010', 806);
painters.blackstone = (ctx, ox, oy) => speckle(ctx, ox, oy, '#2b262c', ['#211d22', '#363037', '#1a1719'], 0.5, 807);
painters.polished_blackstone = (ctx, ox, oy) => speckle(ctx, ox, oy, '#302a31', ['#282329', '#39333a'], 0.2, 808);
painters.blackstone_bricks = (ctx, ox, oy) => brickGrid(ctx, ox, oy, '#2b262c', '#18151a', 809);
painters.blackstone_tiles = (ctx, ox, oy) => brickGrid(ctx, ox, oy, '#302a31', '#1e1a20', 810, 4, 4);
painters.basalt_top = (ctx, ox, oy) => ringTop(ctx, ox, oy, '#4a494c', '#38373a', '#2c2b2d', 811);
painters.basalt_side = (ctx, ox, oy) => stripeSide(ctx, ox, oy, '#3f3e41', '#333235', '#2a292b', 812);
painters.polished_basalt_top = (ctx, ox, oy) => speckle(ctx, ox, oy, '#48474a', ['#403f42', '#4f4e51'], 0.15, 813);
painters.polished_basalt_side = (ctx, ox, oy) => speckle(ctx, ox, oy, '#403f42', ['#39383b', '#48474a'], 0.15, 814);
painters.magma_block = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#1c1414', ['#140f0f', '#241818'], 0.4, 815);
  const rnd = mulberry32(816);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#e8621f' : '#f2a83a';
    const x = ox + Math.floor(rnd() * (TILE - 2));
    const y = oy + Math.floor(rnd() * (TILE - 2));
    ctx.fillRect(x, y, 2, 1);
  }
};
painters.bone_block_top = (ctx, ox, oy) => ringTop(ctx, ox, oy, '#e3dcc3', '#cfc6a5', '#b8ad8c', 817);
painters.bone_block_side = (ctx, ox, oy) => stripeSide(ctx, ox, oy, '#d8d0b4', '#c4bb9c', '#aca283', 818);
painters.gate_anchor = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#120a1e', ['#1e1030', '#0a0614'], 0.45, 819);
  ctx.fillStyle = '#7a3ff2';
  ctx.fillRect(ox + 6, oy + 6, 4, 4);
  ctx.fillStyle = '#b98cff';
  ctx.fillRect(ox + 7, oy + 7, 2, 2);
};
painters.fire = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#ff8a1e', '#ffcf4d', '#ff5c1e'], 820, 7);
painters.voidiron_ore = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#241f26', ['#1a1720', '#2e2833'], 0.5, 821);
  const rnd = mulberry32(822);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = '#9a86c9';
    const x = ox + Math.floor(rnd() * (TILE - 2));
    const y = oy + Math.floor(rnd() * (TILE - 2));
    ctx.fillRect(x, y, 2, 2);
  }
};
painters.emberwart = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#8a1e2b', '#6e1622', '#a8303f'], 823, 6);

painters.bloodcap_stem_top = (ctx, ox, oy) => ringTop(ctx, ox, oy, '#7a1f2e', '#5e1622', '#93283a', 824);
painters.bloodcap_stem_side = (ctx, ox, oy) => stripeSide(ctx, ox, oy, '#6e1c29', '#581520', '#822233', 825);
painters.bloodcap_planks = (ctx, ox, oy) => {
  ctx.fillStyle = '#7a2b38';
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let y = 0; y < TILE; y += 4) {
    ctx.fillStyle = '#6b2430';
    ctx.fillRect(ox, oy + y, TILE, 1);
  }
  const rnd = mulberry32(826);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = '#5c1e28';
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
};
painters.bloodcap_cap = (ctx, ox, oy) => speckle(ctx, ox, oy, '#c62b46', ['#b02039', '#d94a63', '#8f1c30'], 0.5, 827);
painters.bloodcap_fungus = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#c62b46', '#8f1c30', '#d94a63'], 828, 4);
painters.bloodcap_roots = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#8a5a52', '#6e453f', '#a06d63'], 829, 5);
painters.bloodcap_vines = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#7a2b38', '#5c1e28', '#93384a'], 830, 4);
painters.shroomlight_red = (ctx, ox, oy) => glowBlob(ctx, ox, oy, '#ffb199', '#f2704d', '#c23f28', 831);

painters.azurecap_stem_top = (ctx, ox, oy) => ringTop(ctx, ox, oy, '#1f6a7a', '#164e5e', '#288394', 832);
painters.azurecap_stem_side = (ctx, ox, oy) => stripeSide(ctx, ox, oy, '#1c5e6e', '#154a58', '#227382', 833);
painters.azurecap_planks = (ctx, ox, oy) => {
  ctx.fillStyle = '#245e6b';
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let y = 0; y < TILE; y += 4) {
    ctx.fillStyle = '#1e505c';
    ctx.fillRect(ox, oy + y, TILE, 1);
  }
  const rnd = mulberry32(834);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = '#173e48';
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
};
painters.azurecap_cap = (ctx, ox, oy) => speckle(ctx, ox, oy, '#2ba3b8', ['#1f8a9c', '#4bc0d4', '#186f7d'], 0.5, 835);
painters.azurecap_fungus = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#2ba3b8', '#186f7d', '#4bc0d4'], 836, 4);
painters.azurecap_roots = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#4a7a7a', '#385e5e', '#5e9494'], 837, 5);
painters.azurecap_vines = (ctx, ox, oy) => thinCross(ctx, ox, oy, ['#245e6b', '#1c4a54', '#317888'], 838, 4);
painters.shroomlight_blue = (ctx, ox, oy) => glowBlob(ctx, ox, oy, '#c2f5ff', '#5cc7db', '#278a9c', 839);

painters.brewing_stand = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#5a5560';
  ctx.fillRect(ox + 2, oy + 12, TILE - 4, 3);
  ctx.fillStyle = '#3a3640';
  ctx.fillRect(ox + 7, oy, 2, 13);
  ctx.fillStyle = '#7a5fd9';
  ctx.fillRect(ox + 6, oy + 3, 4, 2);
};
painters.smithing_table_top = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#3a3a40', ['#2f2f34', '#45454c'], 0.35, 840);
  ctx.strokeStyle = '#1c1c20';
  ctx.strokeRect(ox + 1.5, oy + 1.5, TILE - 3, TILE - 3);
};
painters.smithing_table_side = (ctx, ox, oy) => {
  ctx.fillStyle = '#4a4650';
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let y = 0; y < TILE; y += 4) {
    ctx.fillStyle = '#3a3640';
    ctx.fillRect(ox, oy + y, TILE, 1);
  }
  ctx.fillStyle = '#2f2c34';
  ctx.fillRect(ox + 2, oy, 2, TILE);
  ctx.fillRect(ox + TILE - 4, oy, 2, TILE);
};
painters.beacon = (ctx, ox, oy) => glowBlob(ctx, ox, oy, '#ffffff', '#bdeeff', '#5cc7db', 841);

// Armor icons: didn't exist before this pass (see items.js's ARMOR_MATERIAL
// note) — one small shape per slot, tinted per material, generated the
// same data-driven way as the existing tool-head loop above rather than
// one-off painters per material x slot.
const ARMOR_ICON_COLOR = { gold: '#f2d543', iron: '#d8d3c8', voidsteel: '#3a3550' };
const ARMOR_ICON_PAINTERS = {
  helmet(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ox + 8, oy + 7, 5, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(ox + 3, oy + 7, 10, 2);
  },
  chest(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + 4, oy + 2, 8, 9);
    ctx.fillRect(ox + 2, oy + 3, 2, 5);
    ctx.fillRect(ox + 12, oy + 3, 2, 5);
  },
  legs(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + 4, oy + 2, 3, 12);
    ctx.fillRect(ox + 9, oy + 2, 3, 12);
  },
  boots(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + 4, oy + 9, 3, 5);
    ctx.fillRect(ox + 9, oy + 9, 3, 5);
    ctx.fillRect(ox + 4, oy + 12, 8, 2);
  },
};
for (const slot of Object.keys(ARMOR_ICON_PAINTERS)) {
  for (const material of Object.keys(ARMOR_ICON_COLOR)) {
    painters[`${material}_${slot}`] = (ctx, ox, oy) => ARMOR_ICON_PAINTERS[slot](ctx, ox, oy, ARMOR_ICON_COLOR[material]);
  }
}

painters.cinder_rod = (ctx, ox, oy) => {
  ctx.fillStyle = '#f2c14d';
  ctx.fillRect(ox + 7, oy + 1, 2, 13);
  ctx.fillStyle = '#c98f1e';
  ctx.fillRect(ox + 7, oy + 5, 2, 2);
  ctx.fillRect(ox + 7, oy + 10, 2, 2);
};
painters.cinder_powder = (ctx, ox, oy) => speckle(ctx, ox, oy, 'rgba(0,0,0,0)', ['#f2c14d', '#e8a838'], 0.35, 842);
painters.drifter_tear = (ctx, ox, oy) => {
  ctx.fillStyle = '#b9c9c9';
  ctx.beginPath();
  ctx.moveTo(ox + 8, oy + 2);
  ctx.quadraticCurveTo(ox + 13, oy + 9, ox + 8, oy + 14);
  ctx.quadraticCurveTo(ox + 3, oy + 9, ox + 8, oy + 2);
  ctx.fill();
};
painters.ashbone_skull = (ctx, ox, oy) => {
  ctx.fillStyle = '#e3dcc3';
  ctx.fillRect(ox + 4, oy + 3, 8, 7);
  ctx.fillStyle = '#2b2b2e';
  ctx.fillRect(ox + 5, oy + 5, 2, 2);
  ctx.fillRect(ox + 9, oy + 5, 2, 2);
};
painters.quartz = (ctx, ox, oy) => {
  ctx.fillStyle = '#efe9dd';
  ctx.beginPath();
  ctx.moveTo(ox + 8, oy + 1);
  ctx.lineTo(ox + 12, oy + 8);
  ctx.lineTo(ox + 8, oy + 15);
  ctx.lineTo(ox + 4, oy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9c0a8';
  ctx.stroke();
};
painters.voidiron_scrap = (ctx, ox, oy) => speckle(ctx, ox, oy, 'rgba(0,0,0,0)', ['#4a4356', '#241f26'], 0.5, 843);
painters.voidsteel_ingot = (ctx, ox, oy) => {
  ctx.fillStyle = '#3a3550';
  ctx.fillRect(ox + 3, oy + 5, 10, 6);
  ctx.fillStyle = '#6a5fae';
  ctx.fillRect(ox + 3, oy + 5, 10, 2);
};
painters.voidsteel_upgrade_plate = (ctx, ox, oy) => {
  ctx.fillStyle = '#241f26';
  ctx.fillRect(ox + 2, oy + 4, 12, 8);
  ctx.strokeStyle = '#6a5fae';
  ctx.strokeRect(ox + 2.5, oy + 4.5, 11, 7);
};
painters.riftpearl = (ctx, ox, oy) => {
  const grad = ctx.createRadialGradient(ox + 6, oy + 6, 1, ox + 8, oy + 8, 7);
  grad.addColorStop(0, '#e8f2ff');
  grad.addColorStop(0.5, '#8fc0d8');
  grad.addColorStop(1, '#2a4a5a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ox + 8, oy + 8, 6, 0, Math.PI * 2);
  ctx.fill();
};

painters.rift_shard = (ctx, ox, oy) => {
  ctx.fillStyle = '#c9a7ff';
  ctx.beginPath();
  ctx.moveTo(ox + 8, oy + 1);
  ctx.lineTo(ox + 12, oy + 8);
  ctx.lineTo(ox + 8, oy + 15);
  ctx.lineTo(ox + 4, oy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2e9ff';
  ctx.beginPath();
  ctx.moveTo(ox + 8, oy + 3);
  ctx.lineTo(ox + 9, oy + 8);
  ctx.lineTo(ox + 8, oy + 12);
  ctx.lineTo(ox + 7, oy + 8);
  ctx.closePath();
  ctx.fill();
};

painters.azurecap_lure = (ctx, ox, oy) => {
  ctx.strokeStyle = '#8b5a2b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + 13);
  ctx.lineTo(ox + 12, oy + 3);
  ctx.stroke();
  ctx.fillStyle = '#2ba3b8';
  ctx.beginPath();
  ctx.arc(ox + 12, oy + 3, 2, 0, Math.PI * 2);
  ctx.fill();
};
painters.heartstar = (ctx, ox, oy) => glowBlob(ctx, ox, oy, '#ffe1e8', '#ff5c7a', '#a8203f', 844);
painters.raw_tuskbeast = (ctx, ox, oy) => {
  ctx.fillStyle = '#c99a8a';
  ctx.fillRect(ox + 2, oy + 4, 12, 8);
  ctx.fillStyle = '#e0b8ab';
  ctx.fillRect(ox + 2, oy + 4, 12, 2);
};
painters.cooked_tuskbeast = (ctx, ox, oy) => {
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(ox + 2, oy + 4, 12, 8);
  ctx.fillStyle = '#a97a42';
  ctx.fillRect(ox + 2, oy + 4, 12, 2);
};
painters.saddle = (ctx, ox, oy) => {
  ctx.fillStyle = '#6b4423';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 8, 6, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a2f18';
  ctx.stroke();
};
painters.flint_and_steel = (ctx, ox, oy) => {
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(ox + 3, oy + 8, 8, 3);
  ctx.fillStyle = '#8a8580';
  ctx.fillRect(ox + 9, oy + 3, 4, 3);
};
painters.glass_bottle = (ctx, ox, oy) => {
  ctx.strokeStyle = 'rgba(180,220,230,0.8)';
  ctx.beginPath();
  ctx.moveTo(ox + 6, oy + 2);
  ctx.lineTo(ox + 6, oy + 5);
  ctx.lineTo(ox + 4, oy + 8);
  ctx.lineTo(ox + 4, oy + 13);
  ctx.lineTo(ox + 12, oy + 13);
  ctx.lineTo(ox + 12, oy + 8);
  ctx.lineTo(ox + 10, oy + 5);
  ctx.lineTo(ox + 10, oy + 2);
  ctx.closePath();
  ctx.stroke();
};
painters.water_bottle = (ctx, ox, oy) => {
  painters.glass_bottle(ctx, ox, oy);
  ctx.fillStyle = 'rgba(58,125,214,0.6)';
  ctx.fillRect(ox + 5, oy + 9, 6, 3);
};
painters.awkward_potion = (ctx, ox, oy) => {
  painters.glass_bottle(ctx, ox, oy);
  ctx.fillStyle = 'rgba(180,110,214,0.6)';
  ctx.fillRect(ox + 5, oy + 9, 6, 3);
};

// Phase 6 (alchemy): every named potion reuses the same bottle outline,
// only the fill color differs — mirrors the tool-head/armor-icon
// data-driven painter loops elsewhere in this file, just small enough
// (7 potions) that a literal list reads clearer than another loop.
const POTION_FILL_COLOR = {
  potion_of_fire_resistance: 'rgba(232,98,31,0.7)',
  potion_of_healing: 'rgba(224,70,90,0.7)',
  potion_of_strength: 'rgba(160,40,40,0.7)',
  potion_of_speed: 'rgba(58,142,224,0.7)',
  potion_of_night_vision: 'rgba(46,46,110,0.7)',
  potion_of_slow_falling: 'rgba(217,198,165,0.7)',
  potion_of_regeneration: 'rgba(200,95,192,0.7)',
};
for (const [name, color] of Object.entries(POTION_FILL_COLOR)) {
  painters[name] = (ctx, ox, oy) => {
    painters.glass_bottle(ctx, ox, oy);
    ctx.fillStyle = color;
    ctx.fillRect(ox + 5, oy + 9, 6, 3);
  };
}

painters.magma_cream = (ctx, ox, oy) => {
  const rnd = mulberry32(733);
  ctx.fillStyle = '#e8a24a';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 9, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#c9791f' : '#f2c17a';
    ctx.fillRect(ox + 4 + Math.floor(rnd() * 8), oy + 6 + Math.floor(rnd() * 6), 1, 1);
  }
};

painters.cinder_portal = (ctx, ox, oy) => {
  const rnd = mulberry32(845);
  ctx.fillStyle = '#2a0a3a';
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#7a3ff2' : '#f2a83a';
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
};

// --- The Hollow Reach (dimension 3) -------------------------------------

painters.palestone = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#d9d4c8', ['#cfc9ba', '#e4dfd2', '#c4bfae'], 0.35, 901);
};

painters.mossy_stone_bricks = (ctx, ox, oy) => {
  brickGrid(ctx, ox, oy, '#8a8a8a', '#5c5c5c', 902);
  const rnd = mulberry32(9021);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#4d7a3a' : '#3d6430';
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), 1, 1);
  }
};

painters.cracked_stone_bricks = (ctx, ox, oy) => {
  brickGrid(ctx, ox, oy, '#7d7d7d', '#525252', 903);
  ctx.strokeStyle = '#3f3f3f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + 2, oy + 3);
  ctx.lineTo(ox + 6, oy + 7);
  ctx.lineTo(ox + 4, oy + 11);
  ctx.lineTo(ox + 9, oy + 14);
  ctx.moveTo(ox + 11, oy + 2);
  ctx.lineTo(ox + 13, oy + 8);
  ctx.stroke();
};

// Cross-plane blocks render with alpha cutout — clearRect first so the
// unpainted area is genuinely transparent, same as wheat_crop/cobweb.
painters.iron_bars = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.strokeStyle = '#9aa0a6';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox + 1, oy + 1, TILE - 2, TILE - 2);
  ctx.beginPath();
  ctx.moveTo(ox + TILE / 2, oy);
  ctx.lineTo(ox + TILE / 2, oy + TILE);
  ctx.moveTo(ox, oy + TILE / 2);
  ctx.lineTo(ox + TILE, oy + TILE / 2);
  ctx.strokeStyle = '#6e7378';
  ctx.lineWidth = 1;
  ctx.stroke();
};

painters.torch = (ctx, ox, oy) => {
  ctx.clearRect(ox, oy, TILE, TILE);
  ctx.fillStyle = '#6b4a2d';
  ctx.fillRect(ox + 7, oy + 6, 2, 9);
  ctx.fillStyle = '#f2a83a';
  ctx.fillRect(ox + 6, oy + 3, 4, 4);
  ctx.fillStyle = '#ffe9b0';
  ctx.fillRect(ox + 7, oy + 4, 2, 2);
};

painters.bookshelf_side = (ctx, ox, oy) => {
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(ox, oy, TILE, TILE);
  const rnd = mulberry32(904);
  const colors = ['#a83a3a', '#3a5ea8', '#3a8a5a', '#c2a23a', '#7a3a8a'];
  for (let x = 1; x < TILE - 1; x += 3) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.fillRect(ox + x, oy + 2, 2, TILE - 4);
  }
  ctx.strokeStyle = '#5c3a20';
  ctx.strokeRect(ox, oy, TILE, TILE);
};

// The Rift Gate frame — empty vs filled reads like a vanilla end portal
// frame's empty socket vs a seated eye: a dull hollow ring vs a bright
// inset shard glow. No animated shader (chunkManager.js's portalSwirl
// effect is baked to one hardcoded atlas rect at material-creation time
// — extending it to a second texture is a real shader change, scoped out
// here; a well-drawn static tile still reads as genuinely different from
// the Cinder Gate's).
painters.rift_gate_frame_empty = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#4a4658', ['#403c50', '#544f66'], 0.3, 905);
  ctx.strokeStyle = '#2c2938';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox + 2, oy + 2, TILE - 4, TILE - 4);
};

painters.rift_gate_frame_filled = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#4a4658', ['#403c50', '#544f66'], 0.3, 905);
  ctx.strokeStyle = '#2c2938';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox + 2, oy + 2, TILE - 4, TILE - 4);
  ctx.fillStyle = '#c9a7ff';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 8, 3.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2e9ff';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 8, 1.4, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
};

painters.spire_crystal = (ctx, ox, oy) => {
  speckle(ctx, ox, oy, '#3a2f5e', ['#4a3d72', '#2c2348'], 0.2, 907);
  ctx.fillStyle = '#c9a7ff';
  ctx.beginPath();
  ctx.moveTo(ox + 8, oy + 1);
  ctx.lineTo(ox + 13, oy + 8);
  ctx.lineTo(ox + 8, oy + 15);
  ctx.lineTo(ox + 3, oy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2e9ff';
  ctx.beginPath();
  ctx.arc(ox + 8, oy + 8, 2, 0, Math.PI * 2);
  ctx.fill();
};

painters.rift_portal = (ctx, ox, oy) => {
  const rnd = mulberry32(906);
  ctx.fillStyle = '#0a0814';
  ctx.fillRect(ox, oy, TILE, TILE);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rnd() < 0.6 ? '#c9a7ff' : '#f2e9ff';
    const size = rnd() < 0.2 ? 1 : 1;
    ctx.fillRect(ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), size, size);
  }
};
