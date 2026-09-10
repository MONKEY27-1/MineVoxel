import { RECIPES, ingredientMatches } from './recipes.js';

// Trims the grid down to the bounding box of its non-empty cells — that's
// what lets a 2x2 pattern match no matter where in a 3x3 bench grid it's
// placed, without the recipe author needing to enumerate every offset.
function trimGrid(cells, w, h) {
  let minR = h,
    maxR = -1,
    minC = w,
    maxC = -1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (cells[r * w + c]) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < 0) return null;
  const rows = [];
  for (let r = minR; r <= maxR; r++) {
    const row = [];
    for (let c = minC; c <= maxC; c++) row.push(cells[r * w + c]);
    rows.push(row);
  }
  return rows;
}

function matchesShaped(cells, w, h, pattern) {
  const trimmed = trimGrid(cells, w, h);
  if (!trimmed || trimmed.length !== pattern.length) return false;
  for (let r = 0; r < pattern.length; r++) {
    if (trimmed[r].length !== pattern[r].length) return false;
    for (let c = 0; c < pattern[r].length; c++) {
      const ingredient = pattern[r][c];
      const cell = trimmed[r][c];
      if (!ingredient && !cell) continue;
      if (!ingredient || !cell) return false;
      if (!ingredientMatches(ingredient, cell.itemId)) return false;
    }
  }
  return true;
}

function matchesShapeless(cells, ingredients) {
  const filled = cells.filter(Boolean);
  if (filled.length !== ingredients.length) return false;
  const remaining = [...ingredients];
  for (const cell of filled) {
    const idx = remaining.findIndex((ing) => ingredientMatches(ing, cell.itemId));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

/** @param cells ({itemId,count}|null)[] length w*h, row-major */
export function findMatchingRecipe(cells, w, h, benchAvailable) {
  for (const recipe of RECIPES) {
    if (recipe.requiresBench && !benchAvailable) continue;
    if (recipe.shaped && (recipe.pattern.length > h || recipe.pattern[0].length > w)) continue;
    const matched = recipe.shaped ? matchesShaped(cells, w, h, recipe.pattern) : matchesShapeless(cells, recipe.ingredients);
    if (matched) return recipe;
  }
  return null;
}

/** Consumes one of each occupied cell (every current recipe needs exactly 1 per slot). */
export function consumeCraftingGrid(cells) {
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    cells[i].count -= 1;
    if (cells[i].count <= 0) cells[i] = null;
  }
}
