import { ITEMS, getNonBlockItem } from './items.js';

// Phase 7 (Voidsteel): which existing top-tier (iron) tool/armor piece
// upgrades into which Voidsteel one. Iron is this game's top pre-
// Voidsteel tier for both tools and armor (no diamond tier exists here),
// matching vanilla's iron->netherite smithing upgrade rather than
// diamond->netherite.
export const UPGRADE_TARGETS = {
  [ITEMS.IRON_PICKAXE.id]: ITEMS.VOIDSTEEL_PICKAXE.id,
  [ITEMS.IRON_AXE.id]: ITEMS.VOIDSTEEL_AXE.id,
  [ITEMS.IRON_SHOVEL.id]: ITEMS.VOIDSTEEL_SHOVEL.id,
  [ITEMS.IRON_SWORD.id]: ITEMS.VOIDSTEEL_SWORD.id,
  [ITEMS.IRON_HELMET.id]: ITEMS.VOIDSTEEL_HELMET.id,
  [ITEMS.IRON_CHEST.id]: ITEMS.VOIDSTEEL_CHEST.id,
  [ITEMS.IRON_LEGS.id]: ITEMS.VOIDSTEEL_LEGS.id,
  [ITEMS.IRON_BOOTS.id]: ITEMS.VOIDSTEEL_BOOTS.id,
};

// slots: [0] = base tool/armor, [1] = Voidsteel Ingot, [2] = Voidsteel
// Upgrade Plate (Bastion-treasure-only, see lootTables.js). No update(dt)
// — unlike Furnace/BrewingStand this is an instant transform with no
// burn/brew timer, so it only needs to compute what taking the (take-
// only) output slot right now would produce; inventoryUI.js applies it.
export class SmithingTable {
  constructor() {
    this.slots = [null, null, null];
  }

  /**
   * @returns {{itemId,count,durability}|null} the upgraded item this
   * combination would produce, or null if the 3 slots don't form a valid
   * upgrade. Doesn't mutate anything — inventoryUI.js's take handler
   * consumes the 3 inputs itself once the player actually takes this.
   */
  computeResult() {
    const base = this.slots[0];
    if (!base) return null;
    const targetId = UPGRADE_TARGETS[base.itemId];
    if (!targetId) return null;
    if (this.slots[1]?.itemId !== ITEMS.VOIDSTEEL_INGOT.id) return null;
    if (this.slots[2]?.itemId !== ITEMS.VOIDSTEEL_UPGRADE_PLATE.id) return null;

    // Preserve durability the way vanilla's smithing upgrade does: carry
    // over the absolute damage already taken, not the raw remaining
    // value or a ratio — an iron tool 1 hit from breaking comes out of
    // the upgrade 1 hit of *its own* (much larger) max from breaking too,
    // not nearly full. Armor's maxDurability is already material-
    // independent (see items.js's defineArmor), so this is a no-op there
    // (damageTaken transfers 1:1 either way).
    let durability;
    if (base.durability !== undefined) {
      const oldMax = getMaxDurability(base.itemId);
      const damageTaken = oldMax - base.durability;
      durability = Math.max(1, getMaxDurability(targetId) - damageTaken);
    }
    return { itemId: targetId, count: 1, durability };
  }
}

function getMaxDurability(itemId) {
  return getNonBlockItem(itemId)?.maxDurability ?? 1;
}
