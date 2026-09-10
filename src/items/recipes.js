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
]);

export const FUEL_ITEMS = new Map([
  [ITEMS.COAL.id, 80],
  [ITEMS.CHARCOAL.id, 80],
  [BLOCKS.OAK_LOG, 15],
  [BLOCKS.OAK_PLANKS, 7.5],
  [ITEMS.STICK.id, 5],
]);
