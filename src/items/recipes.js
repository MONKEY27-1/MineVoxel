import { BLOCKS } from '../world/blocks.js';
import { ITEMS } from './items.js';

// Ingredient tags let a recipe accept "any planks" instead of one exact
// item id — only one wood type exists today, but the recipes are written
// against the tag so adding birch/spruce planks later doesn't mean
// touching every recipe that uses planks.
export const TAGS = {
  planks: [BLOCKS.OAK_PLANKS],
  log: [BLOCKS.OAK_LOG],
  cobblestone: [BLOCKS.COBBLESTONE],
  sand: [BLOCKS.SAND],
};

function tag(name) {
  return { tag: name };
}
function item(id) {
  return { itemId: id };
}

export function ingredientMatches(ingredient, itemId) {
  if (ingredient.itemId !== undefined) return ingredient.itemId === itemId;
  return TAGS[ingredient.tag]?.includes(itemId) ?? false;
}

// Shaped: `pattern` rows must appear as a contiguous, tightly-bounded
// sub-block of the crafting grid (matched at every possible offset —
// see crafting.js) — an empty cell is `null`. Shapeless: `ingredients` is
// just a multiset, position doesn't matter, but every grid item must be
// accounted for (no extra junk ingredients).
export const RECIPES = [
  { id: 'planks_from_log', shapeless: true, ingredients: [tag('log')], outputId: BLOCKS.OAK_PLANKS, outputCount: 4 },
  { id: 'stick', shaped: true, pattern: [[tag('planks')], [tag('planks')]], outputId: ITEMS.STICK.id, outputCount: 4 },
  {
    id: 'crafting_table',
    shaped: true,
    pattern: [
      [tag('planks'), tag('planks')],
      [tag('planks'), tag('planks')],
    ],
    outputId: BLOCKS.CRAFTING_TABLE,
    outputCount: 1,
  },
  {
    id: 'furnace',
    shaped: true,
    requiresBench: true,
    pattern: [
      [tag('cobblestone'), tag('cobblestone'), tag('cobblestone')],
      [tag('cobblestone'), null, tag('cobblestone')],
      [tag('cobblestone'), tag('cobblestone'), tag('cobblestone')],
    ],
    outputId: BLOCKS.FURNACE,
    outputCount: 1,
  },
  {
    id: 'chest',
    shaped: true,
    requiresBench: true,
    pattern: [
      [tag('planks'), tag('planks'), tag('planks')],
      [tag('planks'), null, tag('planks')],
      [tag('planks'), tag('planks'), tag('planks')],
    ],
    outputId: BLOCKS.CHEST,
    outputCount: 1,
  },
  ...toolFamily('pickaxe', [
    ['H', 'H', 'H'],
    [null, 'S', null],
    [null, 'S', null],
  ]),
  ...toolFamily('shovel', [
    ['H'],
    ['S'],
    ['S'],
  ]),
  ...toolFamily('axe', [
    ['H', 'H'],
    ['H', 'S'],
    [null, 'S'],
  ]),
  ...toolFamily('sword', [
    ['H'],
    ['H'],
    ['S'],
  ]),
  // Phase 6 (alchemy) — Cinder Rod stands in for blaze rod exactly the
  // way it does everywhere else in this dimension: fuels/builds the
  // brewing stand, and grinds down into its powder form.
  {
    id: 'brewing_stand',
    shaped: true,
    requiresBench: true,
    pattern: [
      [null, item(ITEMS.CINDER_ROD.id), null],
      [tag('cobblestone'), tag('cobblestone'), tag('cobblestone')],
    ],
    outputId: BLOCKS.BREWING_STAND,
    outputCount: 1,
  },
  { id: 'cinder_powder', shapeless: true, ingredients: [item(ITEMS.CINDER_ROD.id)], outputId: ITEMS.CINDER_POWDER.id, outputCount: 2 },
  // Phase 7 (Voidsteel): 4 scrap + 4 gold ingots, same recipe shape as
  // vanilla's netherite ingot — a 3x3 bench grid (8 of its 9 cells
  // filled) rather than the smithing table, which is reserved for the
  // upgrade step below.
  {
    id: 'voidsteel_ingot',
    shapeless: true,
    requiresBench: true,
    ingredients: [
      item(ITEMS.VOIDIRON_SCRAP.id), item(ITEMS.VOIDIRON_SCRAP.id), item(ITEMS.VOIDIRON_SCRAP.id), item(ITEMS.VOIDIRON_SCRAP.id),
      item(ITEMS.GOLD_INGOT.id), item(ITEMS.GOLD_INGOT.id), item(ITEMS.GOLD_INGOT.id), item(ITEMS.GOLD_INGOT.id),
    ],
    outputId: ITEMS.VOIDSTEEL_INGOT.id,
    outputCount: 1,
  },
  // Phase 7 (Voidsteel): TNT had no recipe at all before this — without
  // one, exposing Voidiron Ore ("only revealed by explosions") would be
  // unreachable in survival. This game has no gunpowder-equivalent drop,
  // so Cinder Powder (already the brewing-stand fuel, already a
  // "volatile" material by that role) stands in for it instead of
  // inventing a new item.
  {
    id: 'tnt',
    shaped: true,
    requiresBench: true,
    pattern: [
      [tag('sand'), item(ITEMS.CINDER_POWDER.id), tag('sand')],
      [item(ITEMS.CINDER_POWDER.id), tag('sand'), item(ITEMS.CINDER_POWDER.id)],
      [tag('sand'), item(ITEMS.CINDER_POWDER.id), tag('sand')],
    ],
    outputId: BLOCKS.TNT,
    outputCount: 1,
  },
  {
    id: 'smithing_table',
    shaped: true,
    requiresBench: true,
    pattern: [
      [tag('planks'), tag('planks')],
      [item(ITEMS.IRON_INGOT.id), item(ITEMS.IRON_INGOT.id)],
    ],
    outputId: BLOCKS.SMITHING_TABLE,
    outputCount: 1,
  },
  // The Hollow Reach (dimension 3), phase 1: items.js's own RIFT_SHARD
  // comment already claimed "crafted from a Riftpearl + Cinder Powder,"
  // but no recipe actually existed anywhere — a real gap, closed here
  // rather than left for whenever someone next touched this file.
  { id: 'rift_shard', shapeless: true, ingredients: [item(ITEMS.RIFTPEARL.id), item(ITEMS.CINDER_POWDER.id)], outputId: ITEMS.RIFT_SHARD.id, outputCount: 1 },
  // Phase 6: how a player crafts the 4 Spire Crystals the Riftwyrm's
  // respawn ritual needs — glass (already a real block) + a Rift Shard +
  // a bottle of Rift Breath (BOTTLED_RIFT_BREATH, filled by standing in
  // an active Rift Breath cloud with a Glass Bottle held — see main.js).
  { id: 'spire_crystal', shapeless: true, ingredients: [item(BLOCKS.GLASS), item(ITEMS.RIFT_SHARD.id), item(ITEMS.BOTTLED_RIFT_BREATH.id)], outputId: BLOCKS.SPIRE_CRYSTAL, outputCount: 1 },
  // Phase 8: a Vault Box is just a Chest reinforced with a Vault Shell —
  // main.js's own break/place handling (not this recipe) is what
  // actually makes the resulting block keep its contents.
  { id: 'vault_box', shapeless: true, ingredients: [item(ITEMS.VAULT_SHELL.id), item(BLOCKS.CHEST)], outputId: BLOCKS.VAULT_BOX, outputCount: 1 },
];

function toolFamily(toolType, template) {
  const materials = [
    { key: 'wooden', head: tag('planks'), toolItemKey: `WOODEN_${toolType.toUpperCase()}` },
    { key: 'stone', head: tag('cobblestone'), toolItemKey: `STONE_${toolType.toUpperCase()}` },
    { key: 'iron', head: item(ITEMS.IRON_INGOT.id), toolItemKey: `IRON_${toolType.toUpperCase()}` },
  ];
  return materials.map(({ key, head, toolItemKey }) => ({
    id: `${key}_${toolType}`,
    shaped: true,
    requiresBench: true,
    pattern: template.map((row) => row.map((cell) => (cell === 'H' ? head : cell === 'S' ? tag('stick_placeholder') : null))),
    outputId: ITEMS[toolItemKey].id,
    outputCount: 1,
  }));
}

// 'stick' isn't a block, so it can't go through the `tag()`/TAGS lookup
// (that table is block-tag only) — patch the tool-family patterns to
// reference the actual stick item id directly, post-hoc, rather than
// teaching TAGS about non-block items for one case.
for (const recipe of RECIPES) {
  if (!recipe.pattern) continue;
  for (const row of recipe.pattern) {
    for (let i = 0; i < row.length; i++) {
      if (row[i]?.tag === 'stick_placeholder') row[i] = item(ITEMS.STICK.id);
    }
  }
}

export const SMELTING_RECIPES = new Map([
  [BLOCKS.SAND, { outputId: BLOCKS.GLASS, outputCount: 1, time: 10 }],
  [BLOCKS.COBBLESTONE, { outputId: BLOCKS.STONE, outputCount: 1, time: 10 }],
  [BLOCKS.IRON_ORE, { outputId: ITEMS.IRON_INGOT.id, outputCount: 1, time: 10 }],
  [BLOCKS.GOLD_ORE, { outputId: ITEMS.GOLD_INGOT.id, outputCount: 1, time: 10 }],
  [BLOCKS.OAK_LOG, { outputId: ITEMS.CHARCOAL.id, outputCount: 1, time: 10 }],
  // Phase 7 (Voidsteel): matches vanilla's ancient debris -> netherite
  // scrap step — a much longer burn than every other smelt, since this
  // is the endgame material, not a routine one.
  [BLOCKS.VOIDIRON_ORE, { outputId: ITEMS.VOIDIRON_SCRAP.id, outputCount: 1, time: 25 }],
  // Phase 8: "cooking yields Riftstone material" per spec — Rift Fruit's
  // own second use, beyond eating it raw.
  [ITEMS.RIFT_FRUIT.id, { outputId: BLOCKS.RIFTSTONE, outputCount: 1, time: 10 }],
]);

export const FUEL_ITEMS = new Map([
  [ITEMS.COAL.id, 80],
  [ITEMS.CHARCOAL.id, 80],
  [BLOCKS.OAK_LOG, 15],
  [BLOCKS.OAK_PLANKS, 7.5],
  [ITEMS.STICK.id, 5],
]);

// Phase 6 (alchemy): each entry transforms every filled bottle slot whose
// current item matches `from` into `to`, consuming one `ingredient` per
// brew (brewingStand.js applies this to up to 3 slots at once, matching
// a real brewing stand). The base recipe (Emberwart turns Water Bottle
// into Awkward Potion) and every named-effect recipe both live in this
// one table — nothing about brewingStand.js needs to know which tier a
// recipe belongs to.
export const BREW_RECIPES = [
  { ingredient: BLOCKS.EMBERWART, from: ITEMS.WATER_BOTTLE.id, to: ITEMS.AWKWARD_POTION.id, time: 20 },
  { ingredient: ITEMS.MAGMA_CREAM.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_FIRE_RESISTANCE.id, time: 20 },
  { ingredient: ITEMS.DRIFTER_TEAR.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_HEALING.id, time: 20 },
  { ingredient: ITEMS.GOLD_INGOT.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_STRENGTH.id, time: 20 },
  { ingredient: ITEMS.RAW_TUSKBEAST.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_SPEED.id, time: 20 },
  { ingredient: ITEMS.QUARTZ.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_NIGHT_VISION.id, time: 20 },
  { ingredient: ITEMS.BONE.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_SLOW_FALLING.id, time: 20 },
  { ingredient: ITEMS.CINDER_ROD.id, from: ITEMS.AWKWARD_POTION.id, to: ITEMS.POTION_REGENERATION.id, time: 20 },
];

/** Brewing-stand fuel — Cinder Powder only, per spec (not the general FUEL_ITEMS table). Each unit burns enough for BREW_CHARGES_PER_FUEL brews. */
export const BREW_FUEL_ITEM = ITEMS.CINDER_POWDER.id;
export const BREW_CHARGES_PER_FUEL = 20;
