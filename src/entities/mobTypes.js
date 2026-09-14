import { ITEMS } from '../items/items.js';

// The Cinderdeep pass: mobs carry `dimension` ('overworld' by default,
// see hostile()/passive()) so mobManager.js's natural-spawn roll can
// filter HOSTILE_MOB_IDS/PASSIVE_MOB_IDS by whichever dimension is
// currently active, instead of every mob spawning everywhere.

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
  return { category: 'hostile', dimension: 'overworld', ...def };
}

function passive(def) {
  return { category: 'passive', dimension: 'overworld', ...def };
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

  // --- The Cinderdeep (dimension 2) ------------------------------------
  // Shapes reused from the overworld roster above rather than new bespoke
  // geometry (floating rod-segments/tendrils would need new BUILDERS
  // entries in mob.js) — see CINDERDEEP.md for the scope call. Every
  // hostile here is gold-neutral-exempt (only ashkin itself checks
  // neutralUnlessGoldWorn) and, since this codebase has no fire/lava
  // damage-over-time mechanic for mobs at all yet, "fire-immune" is
  // already true by omission rather than something to implement.
  ashkin: hostile({
    name: 'ashkin',
    dimension: 'cinderdeep',
    shape: 'biped',
    size: { width: 0.65, height: 1.9 },
    maxHealth: 20,
    walkSpeed: 2.2,
    attackDamage: 4,
    attackRange: 1.4,
    attackCooldown: 1.0,
    aggroRange: 16,
    particleColor: 0xd4af37,
    // Hostile only while the player has no gold armor equipped — see
    // mob.js's _updateAI check. Bartering (right-click with a gold
    // ingot) is handled in mobManager.js, not here.
    neutralUnlessGoldWorn: true,
    barterTableId: 'ashkin',
    drops: [{ itemId: ITEMS.GOLD_INGOT.id, min: 0, max: 1, chance: 0.4, lootingBoost: true }],
  }),
  ashkin_warden: hostile({
    name: 'ashkin_warden',
    dimension: 'cinderdeep',
    shape: 'biped',
    size: { width: 0.9, height: 2.3 },
    maxHealth: 50,
    walkSpeed: 2.0,
    attackDamage: 8,
    attackRange: 1.6,
    attackCooldown: 1.1,
    aggroRange: 16,
    particleColor: 0x8a7a5a,
    drops: [{ itemId: ITEMS.GOLD_INGOT.id, min: 1, max: 2, chance: 0.6, lootingBoost: true }],
  }),
  tuskbeast: hostile({
    name: 'tuskbeast',
    dimension: 'cinderdeep',
    shape: 'quadruped',
    size: { width: 1.4, height: 1.4 },
    maxHealth: 40,
    walkSpeed: 3.2,
    attackDamage: 6,
    attackRange: 1.6,
    attackCooldown: 0.9,
    aggroRange: 18,
    particleColor: 0x6b4a3a,
    // Repelled by Azurecap fungus — see mob.js's _updateAI check
    // (mirrors the aggro-range check, just inverted-and-fleeing).
    repelledByAzurecap: true,
    drops: [{ itemId: ITEMS.RAW_TUSKBEAST.id, min: 1, max: 3, chance: 1, lootingBoost: true }],
  }),
  cinder_wraith: hostile({
    name: 'cinder_wraith',
    dimension: 'cinderdeep',
    shape: 'bird', // floating — reuses the flying builder rather than new rod-segment geometry, see CINDERDEEP.md
    size: { width: 1.0, height: 1.0 },
    maxHealth: 20,
    walkSpeed: 2.4,
    attackDamage: 5,
    attackRange: 8,
    attackCooldown: 1.4,
    aggroRange: 20,
    particleColor: 0xf2a83a,
    // The telegraphed 3-shot fire volley per spec — a real projectile.js
    // shot now instead of the earlier flat-melee-at-range stand-in.
    rangedAttack: { color: 0xf2a83a, speed: 16, damage: 4, knockback: 3, count: 3, spread: 0.18, radius: 0.18 },
    drops: [{ itemId: ITEMS.CINDER_ROD.id, min: 0, max: 1, chance: 0.5, lootingBoost: true }],
  }),
  hollow_drifter: hostile({
    name: 'hollow_drifter',
    dimension: 'cinderdeep',
    shape: 'bird',
    size: { width: 2.2, height: 2.2 },
    maxHealth: 30,
    walkSpeed: 1.4,
    attackDamage: 6,
    attackRange: 10,
    attackCooldown: 2.0,
    aggroRange: 24,
    particleColor: 0xb9c9c9,
    // A slow, lobbed explosive shot per spec — real projectile.js
    // physics (gravity: true arcs it) instead of the earlier flat-
    // melee-at-range stand-in. "Deflectable" is still not implemented —
    // that needs the player's own attack to detect and reflect a
    // specific in-flight projectile, a distinct feature from having
    // projectiles exist at all.
    rangedAttack: { color: 0x3a3a3a, speed: 7, damage: 6, knockback: 5, count: 1, gravity: true, radius: 0.35 },
    drops: [{ itemId: ITEMS.DRIFTER_TEAR.id, min: 0, max: 1, chance: 0.6, lootingBoost: true }],
  }),
  magma_slug: hostile({
    name: 'magma_slug',
    dimension: 'cinderdeep',
    shape: 'quadruped',
    size: { width: 0.8, height: 0.6 },
    maxHealth: 12,
    walkSpeed: 1.8,
    attackDamage: 4,
    attackRange: 1.2,
    attackCooldown: 0.8,
    aggroRange: 12,
    particleColor: 0xe8621f,
    // Phase 6: the required source of Magma Cream, which gates the fire
    // resistance potion — "Fire resistance gated behind finding a Magma
    // Slug" per spec. Not a guaranteed drop, so it's a real (if short)
    // hunt rather than a certainty the first time one is killed.
    drops: [{ itemId: ITEMS.MAGMA_CREAM.id, min: 1, max: 1, chance: 0.5, lootingBoost: true }],
    // Splits into 2 half-sized copies on death (mobManager.js's
    // _onDeath), matching the overworld slime's own vanilla behavior —
    // built here first since this game has no overworld slime to copy.
    splitsOnDeath: true,
  }),
  ashbone: hostile({
    name: 'ashbone',
    dimension: 'cinderdeep',
    shape: 'biped',
    size: { width: 0.6, height: 2.0 },
    maxHealth: 25,
    walkSpeed: 2.0,
    attackDamage: 5,
    attackRange: 1.4,
    attackCooldown: 1.0,
    aggroRange: 16,
    particleColor: 0xd8d3c0,
    // A lingering decay tick applied on hit (mob.js's _updateAI attack
    // branch) rather than one big up-front number — "lingering decay
    // damage-over-time" per spec.
    decayDamage: 1,
    decayDuration: 4,
    drops: [
      { itemId: ITEMS.BONE.id, min: 0, max: 2, chance: 0.8, lootingBoost: true },
      // Roughly 2.5% base per spec — "a real goal, not a grind" for the
      // 3 skulls the Ashen Sovereign summon needs.
      { itemId: ITEMS.ASHBONE_SKULL.id, min: 1, max: 1, chance: 0.025, playerKillOnly: true },
    ],
  }),
  emberstrider: passive({
    name: 'emberstrider',
    dimension: 'cinderdeep',
    shape: 'quadruped',
    size: { width: 1.6, height: 1.9 },
    maxHealth: 20,
    walkSpeed: 2.6,
    babyChance: 0,
    particleColor: 0xf2c14d,
    drops: [],
  }),
};

export const HOSTILE_MOB_IDS = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].category === 'hostile');
export const PASSIVE_MOB_IDS = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].category === 'passive');
