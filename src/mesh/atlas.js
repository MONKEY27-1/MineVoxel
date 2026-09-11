import * as THREE from 'three';

// Procedurally-drawn 16x16 texture atlas. Every tile is packed with a
// 1px padding gutter whose border pixels are extruded copies of the tile's
// own edge pixels, so nearest-filtering + mip sampling never bleeds a
// neighboring tile's color into a face.

const TILE = 16;
const PAD = 1;
const CELL = TILE + PAD * 2;

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

const painters = {
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
const TOOL_HEAD_COLOR = { wooden: '#8b5a2b', stone: '#8a8a8a', iron: '#d8d8d8' };

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

const TILE_NAMES = Object.keys(painters);

export function buildAtlas() {
  const cols = Math.ceil(Math.sqrt(TILE_NAMES.length));
  const rows = Math.ceil(TILE_NAMES.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;

  const uv = new Map();

  TILE_NAMES.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * CELL;
    const cellY = row * CELL;
    const tileX = cellX + PAD;
    const tileY = cellY + PAD;

    painters[name](ctx, tileX, tileY);

    // Extrude edges into the padding gutter so mip/nearest sampling at
    // tile borders never picks up the neighboring tile's pixels.
    const img = ctx.getImageData(tileX, tileY, TILE, TILE);
    const top = ctx.getImageData(tileX, tileY, TILE, 1);
    const bottom = ctx.getImageData(tileX, tileY + TILE - 1, TILE, 1);
    ctx.putImageData(top, tileX, tileY - PAD);
    ctx.putImageData(bottom, tileX, tileY + TILE);
    for (let p = 1; p <= PAD; p++) {
      ctx.putImageData(top, tileX, tileY - p);
      ctx.putImageData(bottom, tileX, tileY + TILE - 1 + p);
    }
    const left = ctx.getImageData(tileX, tileY - PAD, 1, TILE + PAD * 2);
    const right = ctx.getImageData(tileX + TILE - 1, tileY - PAD, 1, TILE + PAD * 2);
    for (let p = 1; p <= PAD; p++) {
      ctx.putImageData(left, tileX - p, tileY - PAD);
      ctx.putImageData(right, tileX + TILE - 1 + p, tileY - PAD);
    }

    const u0 = tileX / canvas.width;
    const v0 = tileY / canvas.height;
    const u1 = (tileX + TILE) / canvas.width;
    const v1 = (tileY + TILE) / canvas.height;
    // v is flipped because canvas Y grows downward but UV origin is bottom-left.
    uv.set(name, { u0, v0: 1 - v1, u1, v1: 1 - v0 });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  // Mipmapping a shared atlas would blend neighboring tiles together at
  // coarser levels (the padding gutter only protects the top level) —
  // and our greedy-merged quads sample the atlas manually per-tile via
  // fract() in a custom shader (see atlasMaterial.js), which defeats the
  // GPU's automatic per-tile LOD selection anyway. Off by default for
  // exactly that reason; revision-pass section 8 exposes it as an opt-in
  // Graphics setting anyway (applyMipmapping(), below) since the bleeding
  // is usually minor at normal view distances and some players will
  // prefer smoother far terrain over perfectly crisp tiles.
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return { texture, uv, canvas };
}

/** Shared by main.js's initial apply and menus.js's live toggle — see buildAtlas()'s comment on the tradeoff. */
export function applyMipmapping(texture, renderer, enabled) {
  if (enabled) {
    texture.generateMipmaps = true;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  } else {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.NearestFilter;
    texture.anisotropy = 1;
  }
  texture.needsUpdate = true;
}

