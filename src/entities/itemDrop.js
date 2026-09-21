import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';
import { isVoidsteelItem } from '../items/items.js';
import { isSolid, BLOCKS } from '../world/blocks.js';

// Model and Animation Overhaul, phase 8 — dropped items now render the
// exact same real 3D models (a real cube for blocks, an extruded sprite
// for everything else) held items and the player's own hand use,
// instead of the old bespoke flat-icon-textured box this file used to
// build by hand. "Shares its cache" per the spec: getItemModel()'s own
// module-level cache (heldItemModel.js) means every dropped stone
// pickaxe, every held one, and every one a mob might someday hold all
// reference the exact same built geometry — nothing here ever builds
// per-entity geometry.
//
// A real, deliberate trade made switching: the old box used the atlas
// material's own custom shader (sky/block-light-aware, dims at night —
// see mesh/atlasMaterial.js), while getItemModel()'s own material is a
// plain always-full-bright MeshBasicMaterial (no scene lighting exists
// for held/dropped items — see heldItemModel.js's own doc comment).
// Dropped loot is now visible at full brightness even in the dark —
// judged an acceptable, even player-friendly change (finding your loot
// in a dark cave is a real quality-of-life win), not a regression to
// route around.
const GRAVITY = 20;
const MERGE_RADIUS = 1.2;
const VACUUM_RADIUS = 3.5;
const VACUUM_SPEED = 9;
const PICKUP_RADIUS = 0.9;
const PICKUP_DELAY = 0.4; // can't be immediately re-picked-up right after dropping (matches the vanilla feel)
const DROP_SCALE = 0.55; // held items are scaled 0.7x their own model; a dropped-on-the-ground stack reads better a little smaller still
const SPAWN_GROW_TIME = 0.25;
const MERGE_PULSE_TIME = 0.25;

/** 1 copy for a small stack, 2 for a real one, 3 for a big one — the classic "you can tell roughly how much is there without opening the tooltip" cue, per the spec's own "stack count shown by rendering two or three overlapping copies." */
function copiesForCount(count) {
  if (count >= 16) return 3;
  if (count >= 2) return 2;
  return 1;
}

export class ItemDropManager {
  constructor(scene, atlasAssets, particles = null) {
    this.scene = scene;
    this.atlasAssets = atlasAssets; // {atlasTexture, atlasCanvas, atlasUV} — see heldItemModel.js's getItemModel
    this.particles = particles; // optional — a brief sparkle on pickup, see update()
    this.drops = [];
    // Revision-pass section 8's "entity render distance" — dropped items
    // had no distance culling of any kind before this (see mobManager.js's
    // matching field for the same reasoning/history).
    this.despawnDist = 96;
    // Same one-global-list-shared-across-dimensions shape mobManager.js
    // has, and the same fix — see this class's spawn()/update().
    this._activeDimensionId = 'overworld';
  }

  /** (Re)builds the 1-3 overlapping item-model copies for a stack's current count. Never disposes their geometry — see this file's own top-of-file note on why. */
  _rebuildCopies(d) {
    for (const c of d.copies) d.mesh.remove(c);
    d.copies = [];
    const n = copiesForCount(d.count);
    for (let i = 0; i < n; i++) {
      const itemMesh = getItemModel(d.itemId, this.atlasAssets);
      itemMesh.scale.setScalar(DROP_SCALE);
      if (n > 1) {
        // A small, deterministic-per-slot spread so a stack reads as
        // "several items sitting together," not one bigger item.
        const angle = (i / n) * Math.PI * 2;
        itemMesh.position.set(Math.cos(angle) * 0.09, i * 0.03, Math.sin(angle) * 0.09);
      }
      d.mesh.add(itemMesh);
      d.copies.push(itemMesh);
    }
  }

  spawn(position, itemId, count, durability, dimensionId = this._activeDimensionId) {
    // Durability-bearing items (tools, maxStack 1) never merge — there's
    // no sensible "count: 2" for two tools with two different remaining
    // durabilities, so any item carrying metadata always gets its own
    // entity instead of folding into a same-itemId stack nearby.
    if (durability === undefined) {
      for (const d of this.drops) {
        if (d.itemId === itemId && d.durability === undefined && d.dimensionId === dimensionId && d.mesh.position.distanceTo(position) < MERGE_RADIUS) {
          d.count += count;
          d._mergePulseT = 0; // a brief scale-pop cue, see update()
          this._rebuildCopies(d);
          return;
        }
      }
    }
    const mesh = new THREE.Group();
    mesh.position.copy(position);
    this.scene.add(mesh);
    const d = {
      itemId,
      count,
      durability,
      dimensionId,
      mesh,
      copies: [],
      physicsY: position.y,
      vy: 2 + Math.random(),
      resting: false,
      age: 0,
      pickupDelay: PICKUP_DELAY,
      _spawnT: 0,
      _mergePulseT: null,
    };
    this._rebuildCopies(d);
    this.drops.push(d);
  }

  update(dt, playerFeetPos, chunkManager, onPickup, dimension) {
    this._activeDimensionId = dimension?.id ?? this._activeDimensionId;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];

      // Left behind in a dimension the player isn't currently in (see
      // mobManager.js's identical fix) — paused and hidden rather than
      // ticking physics against the wrong dimension's terrain.
      if (d.dimensionId !== this._activeDimensionId) {
        d.mesh.visible = false;
        continue;
      }
      d.mesh.visible = true;

      const dxp = d.mesh.position.x - playerFeetPos.x;
      const dzp = d.mesh.position.z - playerFeetPos.z;
      if (dxp * dxp + dzp * dzp > this.despawnDist * this.despawnDist) {
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
        continue;
      }

      d.age += dt;
      d.pickupDelay = Math.max(0, d.pickupDelay - dt);
      d._spawnT = Math.min(1, d._spawnT + dt / SPAWN_GROW_TIME);
      if (d._mergePulseT !== null) {
        d._mergePulseT += dt;
        if (d._mergePulseT >= MERGE_PULSE_TIME) d._mergePulseT = null;
      }

      if (!d.resting) {
        d.vy -= GRAVITY * dt;
        const nextY = d.physicsY + d.vy * dt;
        const x = Math.floor(d.mesh.position.x);
        const z = Math.floor(d.mesh.position.z);
        const belowId = chunkManager.getBlock(x, Math.floor(nextY), z);
        // Voidsteel items float on lava instead of sinking through it
        // (phase 7) — every other item just falls straight through lava
        // today (no fluid buoyancy/despawn exists for drops at all), so
        // "never burn" is already true by omission; this only adds the
        // "float" half for Voidsteel specifically.
        if (d.vy < 0 && (isSolid(belowId) || (belowId === BLOCKS.LAVA && isVoidsteelItem(d.itemId)))) {
          d.physicsY = Math.ceil(nextY);
          d.vy = 0;
          d.resting = true;
        } else {
          d.physicsY = nextY;
        }
      }

      let x = d.mesh.position.x;
      let z = d.mesh.position.z;

      if (d.pickupDelay <= 0) {
        const dist = Math.hypot(x - playerFeetPos.x, d.physicsY - playerFeetPos.y, z - playerFeetPos.z);
        if (dist < PICKUP_RADIUS) {
          // onPickup returns the leftover count that didn't fit (a full
          // inventory) — keep the entity around at that reduced count
          // instead of deleting items the player never actually received.
          const leftover = onPickup(d.itemId, d.count, d.durability) ?? 0;
          if (leftover < d.count) this.particles?.spawnBurst(d.mesh.position, 0xffe066, 4, 1.5); // some or all of the stack was actually collected
          if (leftover >= d.count) {
            d.pickupDelay = 0.5; // inventory's full — stop retrying every frame
          } else if (leftover <= 0) {
            this.scene.remove(d.mesh);
            this.drops.splice(i, 1);
            continue;
          } else {
            d.count = leftover;
            this._rebuildCopies(d);
          }
        }
        if (dist < VACUUM_RADIUS) {
          const dx = playerFeetPos.x - x;
          const dz = playerFeetPos.z - z;
          const len = Math.hypot(dx, dz) || 1;
          x += (dx / len) * VACUUM_SPEED * dt;
          z += (dz / len) * VACUUM_SPEED * dt;
        }
      }

      const bob = d.resting ? Math.sin(d.age * 3) * 0.08 : 0;
      d.mesh.position.set(x, d.physicsY + bob, z);
      d.mesh.rotation.y += dt * 1.5;

      // Scale-up on spawn (an ease-out pop from 0) and a brief pulse
      // whenever two stacks merge — both just a scalar on the group, so
      // they compose independently of the per-copy stack offsets above.
      const growEase = Math.sin(Math.min(1, d._spawnT) * Math.PI * 0.5);
      let mergePulse = 1;
      if (d._mergePulseT !== null) {
        const t = d._mergePulseT / MERGE_PULSE_TIME;
        mergePulse = 1 + Math.sin(t * Math.PI) * 0.35;
      }
      d.mesh.scale.setScalar(growEase * mergePulse);
    }
  }

  dispose() {
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops.length = 0;
  }
}
