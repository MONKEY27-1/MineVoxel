import { BLOCKS, getBlock } from '../world/blocks.js';
import { isBlockItem, getNonBlockItem, getMaxStack } from '../items/items.js';
import { destroyBlock } from '../world/destroyBlock.js';

const REACH = 6;
const PLACE_COOLDOWN = 0.2;

// Right-clicking these opens a UI (see main.js's _openContainerFor)
// instead of placing whatever's in the player's hand.
export const CONTAINER_BLOCKS = new Set([BLOCKS.CRAFTING_TABLE, BLOCKS.FURNACE, BLOCKS.CHEST, BLOCKS.BREWING_STAND, BLOCKS.SMITHING_TABLE, BLOCKS.VAULT_BOX, BLOCKS.RIFT_CHEST]);

function cubeOverlapsAABB(cx, cy, cz, position, size) {
  const halfW = size.width / 2;
  const x0 = position.x - halfW;
  const x1 = position.x + halfW;
  const y0 = position.y;
  const y1 = position.y + size.height;
  const z0 = position.z - halfW;
  const z1 = position.z + halfW;
  return x1 > cx && x0 < cx + 1 && y1 > cy && y0 < cy + 1 && z1 > cz && z0 < cz + 1;
}

function cubeOverlapsPlayer(cx, cy, cz, player) {
  return cubeOverlapsAABB(cx, cy, cz, player.position, player.size);
}

/** Mirrors cubeOverlapsPlayer for mobs — a block placed inside a mob's hitbox is a genre-convention gap (mobs have no suffocation damage here, so it's not a crash/data-loss issue, just "block clips through mob" looking wrong), fixed by reusing the exact same AABB check the player already gets. */
function cubeOverlapsAnyMob(cx, cy, cz, mobs) {
  for (const mob of mobs) {
    if (cubeOverlapsAABB(cx, cy, cz, mob.position, mob.size)) return true;
  }
  return false;
}

/** Amanatides & Woo voxel DDA raycast. Passes through liquids and air. */
export function raycastVoxel(chunkManager, origin, direction, maxDistance = REACH) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(direction.x);
  const stepY = Math.sign(direction.y);
  const stepZ = Math.sign(direction.z);

  const tDeltaX = direction.x !== 0 ? Math.abs(1 / direction.x) : Infinity;
  const tDeltaY = direction.y !== 0 ? Math.abs(1 / direction.y) : Infinity;
  const tDeltaZ = direction.z !== 0 ? Math.abs(1 / direction.z) : Infinity;

  const frac = (v, step) => (step > 0 ? 1 - (v - Math.floor(v)) : v - Math.floor(v));
  let tMaxX = stepX !== 0 ? frac(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? frac(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? frac(origin.z, stepZ) * tDeltaZ : Infinity;

  let normal = [0, 0, 0];
  let t = 0;
  let guard = 0;

  while (t <= maxDistance && guard++ < 256) {
    const id = chunkManager.getBlock(x, y, z);
    const def = getBlock(id);
    if (id !== BLOCKS.AIR && !def.liquid) {
      return { blockPos: [x, y, z], normal, distance: t, blockId: id };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = [0, 0, -stepZ];
    }
  }
  return null;
}

function toolSpeedMultiplier(heldItem, blockDef) {
  if (!heldItem || isBlockItem(heldItem.itemId)) return 1;
  const tool = getNonBlockItem(heldItem.itemId);
  if (!tool || tool.kind !== 'tool') return 1;
  return tool.toolType === blockDef.tool ? tool.material.speedMultiplier : 1;
}

/**
 * Drives block breaking/placing off the player's raycast, using the
 * player's real inventory/hotbar (phase 6) instead of a fixed palette.
 * Call once a frame (fixed-timestep is fine — nothing here needs
 * sub-frame precision).
 */
export class InteractionController {
  constructor() {
    this.target = null; // { blockPos, normal, distance, blockId } | null
    this.breakProgress = 0;
    this._breakingKey = null;
    this._placeCooldown = 0;
    // One-frame events for main.js to react to (particles, sound hooks,
    // opening a container UI). Cleared at the start of every update().
    this.justBroke = null; // { position, blockId, drop:{itemId,count}|null } | null
    this.justPlaced = null; // { position, blockId } | null
    this.wantsOpenContainer = null; // { blockId, pos:[x,y,z] } | null
  }

  update(dt, player, input, chunkManager, suppressBreak = false, mobs = []) {
    this.justBroke = null;
    this.justPlaced = null;
    this.wantsOpenContainer = null;
    // devReach (Dev Menu Player tab, "Infinite reach") defaults to this
    // module's own REACH constant — see player.js's constructor — so
    // ordinary play is completely unaffected until the slider is touched.
    // Both breaking and placing key off this same raycast target, so one
    // slider covers both per the spec's own wording.
    this.target = raycastVoxel(chunkManager, player.eyePosition, player.lookDirection, player.devReach);
    this._placeCooldown = Math.max(0, this._placeCooldown - dt);

    for (let i = 0; i < 9; i++) {
      if (input.wasPressed(`hotbar${i + 1}`)) player.selectedHotbar = i;
    }
    if (input.wheelDelta !== 0) {
      player.selectedHotbar = (player.selectedHotbar + Math.sign(input.wheelDelta) + 9) % 9;
    }
    if (input.wasMousePressed(1) && this.target && player.gameMode === 'creative') {
      player.inventory.slots[player.selectedHotbar] = { itemId: this.target.blockId, count: getMaxStack(this.target.blockId) };
    }

    this._updateBreaking(dt, player, input, chunkManager, suppressBreak);
    this._updatePlacing(player, input, chunkManager, mobs);
  }

  _updateBreaking(dt, player, input, chunkManager, suppressBreak) {
    // A left-click swing that lands on a mob (mobManager.js's own
    // reach+cone hit test, not this raycast) takes priority over breaking
    // whatever block happens to be behind/around it that tick — otherwise
    // a prolonged fight with the crosshair crossing a low-hardness block
    // could break it as a side effect of holding the attack button.
    const breaking = !suppressBreak && input.isMouseDown(0) && this.target;
    if (!breaking) {
      this.breakProgress = 0;
      this._breakingKey = null;
      return;
    }

    const key = this.target.blockPos.join(',');
    if (key !== this._breakingKey) {
      this._breakingKey = key;
      this.breakProgress = 0;
    }

    const def = getBlock(this.target.blockId);
    if (def.hardness === Infinity) return; // unbreakable (bedrock)

    if (player.gameMode === 'creative' || player.devInstantMine) {
      this.breakProgress = 1;
    } else {
      const multiplier = toolSpeedMultiplier(player.selectedItem, def);
      const breakTime = Math.max(0.05, def.hardness * 1.5) / multiplier;
      this.breakProgress += dt / breakTime;
    }

    if (this.breakProgress >= 1) {
      const [x, y, z] = this.target.blockPos;
      // destroyBlock (revision-pass section 6) is the single path every
      // block removal goes through — it also wipes any chest/furnace at
      // this position from the container registry and hands back its
      // contents, so this no longer needs its own separate
      // CONTAINER_BLOCKS check the way main.js used to.
      const result = destroyBlock(chunkManager, x, y, z);

      const held = player.selectedItem;
      if (player.gameMode !== 'creative' && held && !isBlockItem(held.itemId)) {
        const tool = getNonBlockItem(held.itemId);
        if (tool?.kind === 'tool') {
          held.durability -= 1;
          if (held.durability <= 0) player.inventory.slots[player.selectedHotbar] = null;
        }
      }

      const dropBlockItem = player.gameMode !== 'creative';
      // A Vault Box with real contents always drops itself with its
      // vaultId attached (destroyBlock.js), even in creative mode — the
      // same "container contents are player-placed, not part of the
      // block itself, so they always drop" exception containerDrops
      // already gets below. Without this, breaking a stocked Vault Box
      // in creative would silently orphan its saved contents forever
      // (stored in the registry, but with no item left anywhere to
      // reference that id).
      const drop =
        result.vaultId != null
          ? { ...result.blockDrop, durability: result.vaultId }
          : dropBlockItem
            ? result.blockDrop
            : null;
      this.justBroke = {
        position: { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
        blockId: result.blockId,
        drop,
        // Container contents are player-placed items, not part of the
        // block itself — they always drop regardless of game mode
        // (matches genre convention). Gating this on dropBlockItem too
        // meant breaking a stocked chest/furnace while in creative mode
        // silently destroyed whatever was stored in it.
        containerDrops: result.containerDrops,
      };
      this.breakProgress = 0;
      this._breakingKey = null;
    }
  }

  _updatePlacing(player, input, chunkManager, mobs) {
    if (!input.isMouseDown(2) || !this.target || this._placeCooldown > 0) return;

    if (CONTAINER_BLOCKS.has(this.target.blockId)) {
      this.wantsOpenContainer = { blockId: this.target.blockId, pos: this.target.blockPos };
      this._placeCooldown = PLACE_COOLDOWN;
      return;
    }

    const held = player.selectedItem;
    if (!held || !isBlockItem(held.itemId)) return;

    const [bx, by, bz] = this.target.blockPos;
    const [nx, ny, nz] = this.target.normal;
    const px = bx + nx;
    const py = by + ny;
    const pz = bz + nz;

    const existing = chunkManager.getBlock(px, py, pz);
    if (existing !== BLOCKS.AIR) return;
    if (cubeOverlapsPlayer(px, py, pz, player)) return;
    if (cubeOverlapsAnyMob(px, py, pz, mobs)) return;

    chunkManager.setBlock(px, py, pz, held.itemId);
    // Vault Box (phase 8): held.durability carries a vaultBoxRegistry id
    // (see vaultBoxRegistry.js) — captured here, before count-- below
    // might null out the slot entirely, so main.js's justPlaced handler
    // can restore that vault's saved contents into the freshly-placed
    // block.
    this.justPlaced = { position: { x: px + 0.5, y: py + 0.5, z: pz + 0.5 }, blockId: held.itemId, durability: held.durability };
    this._placeCooldown = PLACE_COOLDOWN;

    if (player.gameMode !== 'creative') {
      held.count -= 1;
      if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
    }
  }
}
