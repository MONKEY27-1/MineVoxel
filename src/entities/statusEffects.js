// Phase 6 (alchemy): no status-effect system existed before this pass —
// potions were inert placeholder items. Kept intentionally small: a
// handful of named, timed effects (a Map so several distinct effects
// genuinely stack/coexist — drink Speed then Strength and both are
// active), each gameplay hook (movement, damage, lighting) reading
// `has()`/`remainingOf()` directly rather than this module owning
// callbacks into player/render code it has no business depending on.
// Healing is intentionally NOT here — it's an instant, one-shot effect
// applied directly to player.health where a potion is drunk, not a
// timed status.
export const EFFECT_TYPES = {
  strength: { name: 'Strength', color: 0xc0392b, duration: 180 },
  speed: { name: 'Speed', color: 0x3a8ee0, duration: 180 },
  night_vision: { name: 'Night Vision', color: 0x2e2e6e, duration: 180 },
  slow_falling: { name: 'Slow Falling', color: 0xd9c6a5, duration: 90 },
  regeneration: { name: 'Regeneration', color: 0xc85fc0, duration: 45 },
  fire_resistance: { name: 'Fire Resistance', color: 0xe8621f, duration: 180 },
  // Ashbone's lingering attack (mob.js) applies this directly with its
  // own short duration rather than the default 180s — a combat DoT, not
  // a brewed potion effect, though it shares the same timer/HUD-chip
  // machinery since "a timed thing ticking down" is exactly what this
  // class already does.
  decay: { name: 'Decay', color: 0x5a4d3a, duration: 4 },
};

// Dev Menu's "Night vision" toggle (phase 2) wants an indefinite effect
// — a real `Infinity` duration would serialize to `null` the moment this
// manager's toJSON() round-trips through JSON (the player-state save
// blob), silently failing to persist across a reload despite the spec's
// own "toggle states persist per world" requirement. A large but
// perfectly ordinary, JSON-safe number instead: never practically runs
// out in real play, and hud.js's own chip renders anything at or above
// it as "∞" instead of a meaningless multi-million-minute countdown.
export const INDEFINITE_DURATION = 1e9;

export class StatusEffectManager {
  constructor() {
    this.active = new Map(); // type -> remaining seconds
  }

  add(type, duration = EFFECT_TYPES[type]?.duration ?? 180) {
    this.active.set(type, duration);
  }

  has(type) {
    return (this.active.get(type) ?? 0) > 0;
  }

  remainingOf(type) {
    return this.active.get(type) ?? 0;
  }

  update(dt) {
    for (const [type, remaining] of this.active) {
      const next = remaining - dt;
      if (next <= 0) this.active.delete(type);
      else this.active.set(type, next);
    }
  }

  clear() {
    this.active.clear();
  }

  toJSON() {
    return [...this.active.entries()];
  }

  static fromJSON(data) {
    const mgr = new StatusEffectManager();
    for (const [type, remaining] of data ?? []) {
      if (EFFECT_TYPES[type] && remaining > 0) mgr.active.set(type, remaining);
    }
    return mgr;
  }
}
