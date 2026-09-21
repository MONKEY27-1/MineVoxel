// Model and Animation Overhaul, phase 6 — derives a per-tier armor
// variant from one base slot model, the same "one data transform, not N
// hand-authored files" approach playerModelVariant.js's createSlimVariant
// already established. Pure data, no THREE dependency, for the same
// Node-testability reason.
//
// Real, if simple, per-tier silhouette difference (not just a color
// swap) — gold thinner/sleeker, iron the baseline, voidsteel bulkier —
// satisfies the spec's "helmets and boots should differ in shape
// between tiers, not only in tint" by scaling each box's `inflate`.
// This game has exactly three real armor tiers (gold/iron/voidsteel —
// see items.js's ARMOR_MATERIAL; there is no leather or diamond tier
// here), so this is a fixed 3-entry table, not an extensible material
// registry.
const TIER_INFLATE_SCALE = { gold: 0.5, iron: 1.0, voidsteel: 1.6 };

export function createArmorTierVariant(def, tier) {
  const scale = TIER_INFLATE_SCALE[tier];
  if (scale === undefined) throw new Error(`[armorVariant] unknown armor tier "${tier}"`);
  const clone = structuredClone(def);
  clone.id = `${def.id}_${tier}`;
  for (const part of Object.values(clone.parts)) {
    for (const box of part.boxes) {
      box.inflate = (box.inflate ?? 0) * scale;
    }
  }
  return clone;
}
