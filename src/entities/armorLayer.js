import * as THREE from 'three';
import { loadModelDef } from '../models/modelLoader.js';
import { createModelInstance } from '../models/modelBuilder.js';
import { createArmorTierVariant } from './armorVariant.js';
import { getArmorTierTexture } from './armorTexture.js';
import { getNonBlockItem } from '../items/items.js';

// Model and Animation Overhaul, phase 6 — armor as a real model layer,
// finally replacing phase 4's documented no-op setArmor(). Each
// equipped slot gets its own small Model instance (its own independent
// skeleton — createModelInstance always builds one; there's no
// "skin against someone else's skeleton" support in modelBuilder.js,
// and adding one was judged more machinery than a 4-piece armor set
// needs) whose parts are kept in lockstep with the player's own posed
// bones by copying rotation/position/scale every frame (see sync()) —
// which is exactly why every armor slot model (armor_*.model.json)
// mirrors the player's full body/head/arms/legs *hierarchy*, with
// boxes only on the part(s) that slot actually covers: copying local
// transforms bone-by-bone only composes into the right world result if
// both skeletons share the same parent chain.
const SLOT_MODEL_URLS = ['/assets/models/armor_helmet.model.json', '/assets/models/armor_chest.model.json', '/assets/models/armor_legs.model.json', '/assets/models/armor_boots.model.json'];
const PART_NAMES = ['body', 'head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
const KNOWN_TIERS = new Set(['gold', 'iron', 'voidsteel']);

export class ArmorLayer {
  /** `group` is the owning model's own THREE.Group (player or, later, a mob) — armor meshes are added as its children so they inherit its position/yaw for free, with no separate transform to keep in sync. */
  constructor(group) {
    this.group = group;
    this.pieces = [null, null, null, null]; // per slot: {tier, model} | null
    this._defsPromise = Promise.all(SLOT_MODEL_URLS.map((u) => loadModelDef(u)));
  }

  /**
   * `armor` is the 4-slot [helmet, chest, legs, boots] array of
   * {itemId, durability}|null that player.armor already uses — no new
   * data shape needed. A slot whose material isn't one of this game's
   * three real armor tiers (Glidewings' own `material.name` is
   * "glidewings", not a tier) renders no layer, same as before this
   * phase — Glidewings has its own separate visual identity, not a
   * generic chest-plate silhouette.
   */
  async setArmor(armor) {
    const baseDefs = await this._defsPromise;
    for (let slot = 0; slot < 4; slot++) {
      const piece = armor?.[slot];
      const materialName = piece ? getNonBlockItem(piece.itemId)?.material?.name : null;
      const tier = KNOWN_TIERS.has(materialName) ? materialName : null;
      const current = this.pieces[slot];
      if (current?.tier === tier) continue;
      if (current) {
        this.group.remove(current.model.mesh);
        current.model.dispose();
        current.model.mesh.material.dispose();
      }
      this.pieces[slot] = null;
      if (tier) {
        const def = createArmorTierVariant(baseDefs[slot], tier);
        const { texture } = getArmorTierTexture(tier);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const model = createModelInstance(def, material);
        this.group.add(model.mesh);
        this.pieces[slot] = { tier, model };
      }
    }
  }

  /** Copies the player's own just-posed bone transforms onto every equipped piece — call once per frame, after the player model's own pose has already been applied for that frame. */
  sync(playerModel) {
    for (const piece of this.pieces) {
      if (!piece) continue;
      for (const name of PART_NAMES) {
        const src = playerModel.model.parts.get(name);
        const dst = piece.model.parts.get(name);
        if (!src || !dst) continue;
        dst.rotation.copy(src.rotation);
        dst.position.copy(src.position);
        dst.scale.copy(src.scale);
      }
    }
  }

  dispose() {
    for (const piece of this.pieces) {
      if (!piece) continue;
      this.group.remove(piece.model.mesh);
      piece.model.dispose();
      piece.model.mesh.material.dispose();
    }
    this.pieces = [null, null, null, null];
  }
}
