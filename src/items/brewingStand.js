import { BREW_RECIPES, BREW_FUEL_ITEM, BREW_CHARGES_PER_FUEL } from './recipes.js';

// slots: [0][1][2] = bottle slots, [3] = ingredient, [4] = fuel (Cinder
// Powder only, per spec — not the furnace's general FUEL_ITEMS table).
// Mirrors furnace.js's shape (plain `.slots` array so the generic
// inventory-UI slot handlers work the same way) but a brew transforms up
// to 3 bottles from one ingredient at once, matching a real brewing
// stand, instead of one input -> one output.
export class BrewingStand {
  constructor() {
    this.slots = [null, null, null, null, null];
    this.brewTimeRemaining = 0;
    this.brewTimeTotal = 0;
    this.charges = 0; // remaining brews left in the current fuel unit
  }

  get ingredientSlot() {
    return this.slots[3];
  }
  get fuelSlot() {
    return this.slots[4];
  }

  _matchingRecipe() {
    const ingredient = this.slots[3];
    if (!ingredient) return null;
    const recipe = BREW_RECIPES.find((r) => r.ingredient === ingredient.itemId);
    if (!recipe) return null;
    // At least one bottle slot must actually hold the recipe's `from`
    // potion for this ingredient to have anything to brew.
    const hasMatchingBottle = this.slots.slice(0, 3).some((s) => s?.itemId === recipe.from);
    return hasMatchingBottle ? recipe : null;
  }

  get isBrewing() {
    return this.brewTimeRemaining > 0;
  }

  update(dt) {
    const recipe = this._matchingRecipe();

    if (this.brewTimeRemaining <= 0 && recipe) {
      if (this.charges <= 0) {
        const fuel = this.slots[4];
        if (!fuel || fuel.itemId !== BREW_FUEL_ITEM) return;
        this.charges = BREW_CHARGES_PER_FUEL;
        fuel.count -= 1;
        if (fuel.count <= 0) this.slots[4] = null;
      }
      this.brewTimeTotal = recipe.time;
      this.brewTimeRemaining = recipe.time;
    }

    if (this.brewTimeRemaining <= 0) return;
    this.brewTimeRemaining -= dt;
    if (this.brewTimeRemaining > 0) return;

    // Brew complete: every bottle slot currently holding the recipe's
    // `from` potion converts to `to`; the ingredient is consumed once
    // regardless of how many of the 3 bottles it actually converted,
    // same as a real brewing stand.
    const finished = this._matchingRecipe();
    this.brewTimeRemaining = 0;
    if (!finished) return; // ingredient or last matching bottle got pulled mid-brew
    for (let i = 0; i < 3; i++) {
      const bottle = this.slots[i];
      if (bottle?.itemId === finished.from) this.slots[i] = { itemId: finished.to, count: bottle.count };
    }
    const ingredient = this.slots[3];
    ingredient.count -= 1;
    if (ingredient.count <= 0) this.slots[3] = null;
    this.charges -= 1;
  }
}
