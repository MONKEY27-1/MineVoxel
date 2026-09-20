import { Riftwyrm } from './riftwyrm.js';

// Owns the Hollow Reach's one-of-a-kind boss — zero or one live Riftwyrm
// at a time, plus its Rift Breath lingering hazards. Deliberately not
// folded into mobManager.js: a boss has unique identity and its own
// save/load story (persistence/worldSave.js's riftwyrmState store, not
// the flat/interchangeable entitySnapshots array every regular mob
// shares), so it gets its own small manager mirroring the same
// "singleton owned directly by main.js" pattern gateRegistry already
// uses for the Cinder Gate's own per-world state.

export const BREATH_CLOUD_RADIUS = 3; // exported so main.js's bottle-filling interaction checks the exact same radius, not a duplicated magic number
const BREATH_CLOUD_DURATION = 6;
const BREATH_CLOUD_DAMAGE_PER_TICK = 2;
const BREATH_CLOUD_TICK_INTERVAL = 1;

export class RiftwyrmManager {
  constructor(scene, particles, projectiles, xpOrbs) {
    this.scene = scene;
    this.particles = particles;
    this.projectiles = projectiles;
    this.xpOrbs = xpOrbs;
    this.current = null; // the live Riftwyrm, or null
    this.spawned = false; // has one ever been spawned in this world (persisted) — phase 6 will need this to gate its own respawn ritual
    // The rest of the Hollow Reach's own "boss arc" state (phase 5) —
    // kept here rather than a second persisted record, since it's all
    // one continuous story (has the wyrm ever died, is its exit gate
    // open, is its egg still sitting there, has the player seen the
    // first-time ending) that naturally lives alongside `spawned` above.
    this.exitGateOpen = false;
    this.eggPresent = false;
    this.hasSeenEnding = false;
    this.clouds = []; // active Rift Breath hazards: {x,y,z,remaining,tickTimer}
    this.justDied = false; // one-shot flag, read+cleared by main.js to build the exit gate + Wyrm Egg exactly once, and to roll boss loot
    this.lastDeathPosition = null; // read by main.js's justDied handler — this.current is already gone by the time that flag is seen
    this.timesKilled = 0; // phase 6: every respawn-ritual completion increments this, main.js uses it to scale down repeat-fight XP
  }

  spawn(position, pillars, fountain, health, xpMultiplier = 1) {
    this.current = new Riftwyrm(this.scene, position, { health, pillars, arrivalPoint: position, fountain, xpMultiplier });
    this.spawned = true;
  }

  update(dt, chunkManager, player, dimension) {
    this.justDied = false;
    if (this.current) {
      this.current.update(dt, chunkManager, player, this.particles, this.projectiles, dimension.id, this.xpOrbs);
      if (this.current.justBreathed) this._spawnBreathCloud(this.current.justBreathed);
      if (this.current.dead) {
        this.lastDeathPosition = { ...this.current.position };
        this.current.dispose();
        this.current = null;
        this.justDied = true;
      }
    }
    this._updateClouds(dt, player, dimension);
  }

  _spawnBreathCloud(pos) {
    this.clouds.push({ x: pos.x, y: pos.y, z: pos.z, remaining: BREATH_CLOUD_DURATION, tickTimer: 0 });
  }

  /**
   * A deliberately narrow stand-in for a full lingering-potion-cloud
   * system (documented as a real, separate scope cut in CINDERDEEP.md —
   * "lingering needs a whole second entity type... scoped out") — just
   * enough to make Rift Breath a real lingering hazard: a fixed-radius,
   * fixed-duration zone that damages the player on a tick, visualized by
   * reusing the existing particle system rather than a new mesh/shader.
   */
  _updateClouds(dt, player, dimension) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.remaining -= dt;
      c.tickTimer -= dt;
      if (c.tickTimer <= 0) {
        c.tickTimer = BREATH_CLOUD_TICK_INTERVAL;
        this.particles?.spawnBurst({ x: c.x, y: c.y, z: c.z }, 0x6a3a8a, 6, 1.5);
        if (dimension.id === 'hollow_reach') {
          const dist = Math.hypot(player.position.x - c.x, player.position.y - c.y, player.position.z - c.z);
          if (dist < BREATH_CLOUD_RADIUS) player.takeDamage(BREATH_CLOUD_DAMAGE_PER_TICK, null, 'Rift Breath');
        }
      }
      if (c.remaining <= 0) this.clouds.splice(i, 1);
    }
  }

  /** Only what's needed to resume the fight roughly where it left off — see Riftwyrm.toJSON's own note on why the trail/crystal-links need nothing extra. The exit gate/egg/ending flags need no such caveat — they're plain booleans, not live entity state. */
  toJSON() {
    return {
      spawned: this.spawned,
      alive: !!this.current,
      health: this.current?.health ?? null,
      x: this.current?.position.x ?? null,
      y: this.current?.position.y ?? null,
      z: this.current?.position.z ?? null,
      exitGateOpen: this.exitGateOpen,
      eggPresent: this.eggPresent,
      hasSeenEnding: this.hasSeenEnding,
      timesKilled: this.timesKilled,
    };
  }

  /** `pillars`/`fountain` always come from the live generator, never the save — they're deterministic from the world seed alone, so persisting them would just be a second, redundant copy that could drift out of sync. */
  static fromJSON(json, scene, particles, projectiles, xpOrbs, pillars, fountain) {
    const manager = new RiftwyrmManager(scene, particles, projectiles, xpOrbs);
    if (!json) return manager;
    manager.spawned = !!json.spawned;
    manager.exitGateOpen = !!json.exitGateOpen;
    manager.eggPresent = !!json.eggPresent;
    manager.hasSeenEnding = !!json.hasSeenEnding;
    manager.timesKilled = json.timesKilled ?? 0;
    if (json.alive && json.health > 0) {
      manager.current = new Riftwyrm(scene, { x: json.x, y: json.y, z: json.z }, { health: json.health, pillars, arrivalPoint: { y: json.y }, fountain });
    }
    return manager;
  }

  dispose() {
    this.current?.dispose();
    this.current = null;
  }
}
