import { ITEMS } from '../items/items.js';

// Data-driven mob registry (phase 8) — mirrors world/blocks.js's pattern:
// stats + a `shape` tag (which builder in mob.js assembles the blocky
// body). Textures are procedural (mobTexture.js), keyed by type name, so
// no per-type texture reference lives here.
//
// `drops` entries roll independently (chance each, not a shared weighted
// pool like items/lootTables.js — mob drops in vanilla are simple
// independent per-item rolls, not "pick one of these"). Revision-pass
// section 5 additions: `lootingBoost` (this entry's max count scales
// with a looting/luck multiplier — see mobManager.js's
// getLootingMultiplier, a hook with nothing plugged into it yet since
// there's no enchanting system, always returns 1 today) and
// `playerKillOnly` (only rolls if MobManager.tryPlayerAttack dealt the
// kill, not e.g. fall damage or drowning — mobs can't yet kill each
// other or die any other way, but the flag is real and checked).

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
    particleColor: 0x4c8f4c,
    drops: [
      { itemId: ITEMS.ROTTEN_FLESH.id, min: 0, max: 2, chance: 0.9, lootingBoost: true },
      { itemId: ITEMS.IRON_INGOT.id, min: 1, max: 1, chance: 0.03, playerKillOnly: true }, // rare "zombie dropped its loot" chance, real kills only
    ],
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
    particleColor: 0xd8d3c0,
    drops: [
      { itemId: ITEMS.BONE.id, min: 0, max: 2, chance: 0.9, lootingBoost: true },
      { itemId: ITEMS.ARROW.id, min: 0, max: 2, chance: 0.6, lootingBoost: true, playerKillOnly: true },
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
    particleColor: 0x24242c,
    drops: [{ itemId: ITEMS.STRING.id, min: 0, max: 2, chance: 0.85, lootingBoost: true }],
  }),
  cow: passive({
    name: 'cow',
    shape: 'quadruped',
    size: { width: 0.9, height: 1.4 },
    maxHealth: 10,
    walkSpeed: 1.3,
    babyChance: 0.1,
    particleColor: 0x6b4527,
    drops: [
      { itemId: ITEMS.RAW_BEEF.id, min: 1, max: 3, chance: 1, lootingBoost: true },
      { itemId: ITEMS.LEATHER.id, min: 0, max: 2, chance: 0.7, lootingBoost: true },
    ],
  }),
  pig: passive({
    name: 'pig',
    shape: 'quadruped',
    size: { width: 0.9, height: 0.9 },
    maxHealth: 10,
    walkSpeed: 1.3,
    babyChance: 0.1,
    particleColor: 0xe8a0a8,
    drops: [{ itemId: ITEMS.PORKCHOP.id, min: 1, max: 3, chance: 1, lootingBoost: true }],
  }),
  chicken: passive({
    name: 'chicken',
    shape: 'bird',
    size: { width: 0.4, height: 0.7 },
    maxHealth: 4,
    walkSpeed: 1.5,
    babyChance: 0.1,
    particleColor: 0xf2f2f2,
    drops: [
      { itemId: ITEMS.FEATHER.id, min: 0, max: 2, chance: 0.8, lootingBoost: true },
      { itemId: ITEMS.RAW_CHICKEN.id, min: 1, max: 1, chance: 1 },
    ],
  }),
};

export const HOSTILE_MOB_IDS = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].category === 'hostile');
export const PASSIVE_MOB_IDS = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].category === 'passive');
