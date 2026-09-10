import { ITEMS } from '../items/items.js';

// Data-driven mob registry (phase 8) — mirrors world/blocks.js's pattern:
// stats + a `shape` tag (which builder in mob.js assembles the blocky
// body) + a small color palette per body part, rather than a real model
// format. `drops` entries roll independently (chance each, not a shared
// weighted pool like items/lootTables.js — mob drops in vanilla are
// simple independent per-item rolls, not "pick one of these").

function hostile(def) {
  return { category: 'hostile', ...def };
}

function passive(def) {
  return { category: 'passive', ...def };
}

export const MOB_TYPES = {
  zombie: hostile({
    name: 'zombie',
    shape: 'biped',
    size: { width: 0.6, height: 1.95 },
    maxHealth: 20,
    walkSpeed: 2.1,
    attackDamage: 3,
    attackRange: 1.3,
    attackCooldown: 1.0,
    aggroRange: 16,
    colors: { head: 0x4c8f4c, body: 0x2a5f5f, limb: 0x2b3b6b, accent: 0x3a6b3a },
    drops: [{ itemId: ITEMS.ROTTEN_FLESH.id, min: 0, max: 2, chance: 0.9 }],
  }),
  skeleton: hostile({
    name: 'skeleton',
    shape: 'biped',
    size: { width: 0.6, height: 1.95 },
    maxHealth: 20,
    walkSpeed: 2.3,
    attackDamage: 2,
    attackRange: 1.3,
    attackCooldown: 0.9,
    aggroRange: 16,
    colors: { head: 0xd8d3c0, body: 0xc2bca8, limb: 0xb8b2a0, accent: 0xd8d3c0 },
    drops: [
      { itemId: ITEMS.BONE.id, min: 0, max: 2, chance: 0.9 },
      { itemId: ITEMS.ARROW.id, min: 0, max: 2, chance: 0.6 },
    ],
  }),
  spider: hostile({
    name: 'spider',
    shape: 'spider',
    size: { width: 1.4, height: 0.9 },
    maxHealth: 16,
    walkSpeed: 2.8,
    attackDamage: 2,
    attackRange: 1.6,
    attackCooldown: 1.0,
    aggroRange: 14,
    colors: { head: 0x1c1c22, body: 0x24242c, limb: 0x15151a, accent: 0xcc2222 },
    drops: [{ itemId: ITEMS.STRING.id, min: 0, max: 2, chance: 0.85 }],
  }),
  cow: passive({
    name: 'cow',
    shape: 'quadruped',
    size: { width: 0.9, height: 1.4 },
    maxHealth: 10,
    walkSpeed: 1.3,
    colors: { head: 0x5b3a22, body: 0x6b4527, limb: 0x4a3018, accent: 0xe8e0d0 },
    drops: [
      { itemId: ITEMS.RAW_BEEF.id, min: 1, max: 3, chance: 1 },
      { itemId: ITEMS.LEATHER.id, min: 0, max: 2, chance: 0.7 },
    ],
  }),
  pig: passive({
    name: 'pig',
    shape: 'quadruped',
    size: { width: 0.9, height: 0.9 },
    maxHealth: 10,
    walkSpeed: 1.3,
    colors: { head: 0xe8a0a8, body: 0xeaa8b0, limb: 0xd6909a, accent: 0xcf7e88 },
    drops: [{ itemId: ITEMS.PORKCHOP.id, min: 1, max: 3, chance: 1 }],
  }),
  chicken: passive({
    name: 'chicken',
    shape: 'bird',
    size: { width: 0.4, height: 0.7 },
    maxHealth: 4,
    walkSpeed: 1.5,
    colors: { head: 0xf2f2f2, body: 0xf5f5f0, limb: 0xe0972e, accent: 0xcc3333 },
    drops: [
      { itemId: ITEMS.FEATHER.id, min: 0, max: 2, chance: 0.8 },
      { itemId: ITEMS.RAW_CHICKEN.id, min: 1, max: 1, chance: 1 },
    ],
  }),
};

export const HOSTILE_MOB_IDS = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].category === 'hostile');
export const PASSIVE_MOB_IDS = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].category === 'passive');
