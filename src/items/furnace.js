import { SMELTING_RECIPES, FUEL_ITEMS } from './recipes.js';
import { getMaxStack } from './items.js';

// slots: [0]=input, [1]=fuel, [2]=output. Kept as a plain `.slots` array
// (like Inventory) so the UI's generic slot click/drag handlers work on a
// furnace the same way they work on a chest — with the output slot
// special-cased as take-only, since a furnace shouldn't accept an item
// dropped straight into its result.
export class Furnace {
  constructor() {
    this.slots = [null, null, null];
    this.burnTimeRemaining = 0;
    this.burnTimeTotal = 0;
    this.cookProgress = 0;
    this.isBurning = false;
  }

  get inputSlot() {
    return this.slots[0];
  }
  get fuelSlot() {
    return this.slots[1];
  }
  get outputSlot() {
    return this.slots[2];
  }

  _canSmelt() {
    const input = this.slots[0];
    if (!input) return null;
    const recipe = SMELTING_RECIPES.get(input.itemId);
    if (!recipe) return null;
    const output = this.slots[2];
    if (output && output.itemId !== recipe.outputId) return null;
    if ((output?.count ?? 0) + recipe.outputCount > getMaxStack(recipe.outputId)) return null;
    return recipe;
  }

  update(dt) {
    const recipe = this._canSmelt();
    const fuel = this.slots[1];

    if (this.burnTimeRemaining <= 0 && recipe && fuel && FUEL_ITEMS.has(fuel.itemId)) {
      this.burnTimeTotal = FUEL_ITEMS.get(fuel.itemId);
      this.burnTimeRemaining = this.burnTimeTotal;
      fuel.count -= 1;
      if (fuel.count <= 0) this.slots[1] = null;
    }

    this.isBurning = this.burnTimeRemaining > 0;
    if (this.isBurning) {
      this.burnTimeRemaining -= dt;
      if (recipe) {
        this.cookProgress += dt;
        if (this.cookProgress >= recipe.time) {
          this.cookProgress = 0;
          const input = this.slots[0];
          input.count -= 1;
          if (input.count <= 0) this.slots[0] = null;
          if (this.slots[2]) this.slots[2].count += recipe.outputCount;
          else this.slots[2] = { itemId: recipe.outputId, count: recipe.outputCount };
        }
      } else {
        this.cookProgress = 0;
      }
    } else {
      this.cookProgress = Math.max(0, this.cookProgress - dt * 2);
    }
  }
}
