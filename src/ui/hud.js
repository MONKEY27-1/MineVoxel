import { itemIconTile, itemDisplayName, isBlockItem, getNonBlockItem } from '../items/items.js';
import { applyIcon } from './itemIcon.js';
import { EFFECT_TYPES } from '../entities/statusEffects.js';

const HOTBAR_ICON_SIZE = 36;

// Durability-bar thresholds, two palettes. The default green/yellow/red
// ramp conveys "good/warning/critical" through hue alone — exactly the
// red-green axis most colorblind viewers (the large majority of color-
// vision deficiency is on this axis) can't reliably distinguish, with no
// other signal (shape, text, position) backing it up. The colorblind
// alternative swaps to blue/orange/near-black: blue-yellow discrimination
// is preserved in red-green CVD, and the critical state also drops in
// luminance (not just hue), so it reads as "worse" even in full
// grayscale. This is the Okabe-Ito colorblind-safe palette's blue/orange
// pair, not a personal color choice.
const DURABILITY_COLORS = {
  normal: { high: '#5fbf4a', mid: '#e0c23a', low: '#d94a4a' },
  colorblindSafe: { high: '#0072b2', mid: '#e69f00', low: '#3a2a1a' },
};

export class Hud {
  constructor(atlasUV) {
    this.atlasUV = atlasUV;
    this.colorblindMode = false;
    this.vitalsEl = document.getElementById('vitals');
    this.healthFillEl = document.getElementById('health-fill');
    this.breathFillEl = document.getElementById('breath-fill');
    this.breathBarEl = document.getElementById('breath-bar');
    this.hotbarEl = document.getElementById('hotbar');
    this.underwaterEl = document.getElementById('underwater-overlay');
    this.statusEffectsEl = document.getElementById('status-effects');
    this.bossBarEl = document.getElementById('boss-bar');
    this.bossBarNameEl = document.getElementById('boss-bar-name');
    this.bossBarFillEl = document.getElementById('boss-bar-fill');

    this._slots = Array.from({ length: 9 }, () => {
      const el = document.createElement('div');
      el.className = 'hotbar-slot';
      this.hotbarEl.appendChild(el);
      return el;
    });
    this._nameToast = document.createElement('div');
    this._nameToast.id = 'hotbar-name-toast';
    this._nameToast.className = 'hidden';
    document.getElementById('hud').appendChild(this._nameToast);
    this._lastSelected = -1;
    this._toastTimer = 0;
  }

  update(player, interaction, dt) {
    this.vitalsEl.classList.toggle('hidden', player.gameMode !== 'survival');
    if (player.gameMode === 'survival') {
      this.healthFillEl.style.width = `${(player.health / player.maxHealth) * 100}%`;
      this.breathFillEl.style.width = `${(player.breath / player.maxBreath) * 100}%`;
      this.breathBarEl.classList.toggle('hidden', player.breath >= player.maxBreath && !player.headInWater);
    }
    this.underwaterEl.classList.toggle('hidden', !player.headInWater);

    this.statusEffectsEl.innerHTML = '';
    for (const [type, remaining] of player.effects.active) {
      const def = EFFECT_TYPES[type];
      if (!def) continue;
      const chip = document.createElement('div');
      chip.className = 'status-effect-chip';
      const swatch = document.createElement('div');
      swatch.className = 'status-effect-swatch';
      swatch.style.background = `#${def.color.toString(16).padStart(6, '0')}`;
      const label = document.createElement('span');
      const mm = Math.floor(remaining / 60);
      const ss = Math.floor(remaining % 60)
        .toString()
        .padStart(2, '0');
      label.textContent = `${def.name} ${mm}:${ss}`;
      chip.append(swatch, label);
      this.statusEffectsEl.appendChild(chip);
    }

    for (let i = 0; i < 9; i++) {
      const el = this._slots[i];
      const slot = player.inventory.slots[i];
      el.classList.toggle('selected', i === player.selectedHotbar);
      el.innerHTML = '';
      el.style.backgroundImage = 'none';
      if (slot) {
        applyIcon(el, itemIconTile(slot.itemId), this.atlasUV, HOTBAR_ICON_SIZE);
        if (slot.count > 1) {
          const badge = document.createElement('span');
          badge.className = 'inv-count';
          badge.textContent = slot.count;
          el.appendChild(badge);
        }
        if (!isBlockItem(slot.itemId) && slot.durability !== undefined) {
          const def = getNonBlockItem(slot.itemId);
          if (def?.maxDurability) {
            const bar = document.createElement('div');
            bar.className = 'inv-durability';
            const fill = document.createElement('div');
            const pct = Math.max(0, slot.durability / def.maxDurability);
            fill.style.width = `${pct * 100}%`;
            const colors = this.colorblindMode ? DURABILITY_COLORS.colorblindSafe : DURABILITY_COLORS.normal;
            fill.style.background = pct > 0.5 ? colors.high : pct > 0.2 ? colors.mid : colors.low;
            bar.appendChild(fill);
            el.appendChild(bar);
          }
        }
      }
    }

    if (player.selectedHotbar !== this._lastSelected) {
      this._lastSelected = player.selectedHotbar;
      const slot = player.inventory.slots[player.selectedHotbar];
      if (slot) {
        this._nameToast.textContent = itemDisplayName(slot.itemId).replace(/_/g, ' ');
        this._nameToast.classList.remove('hidden');
        this._toastTimer = 1.2;
      }
    }
    if (this._toastTimer > 0) {
      this._toastTimer -= dt ?? 0;
      if (this._toastTimer <= 0) this._nameToast.classList.add('hidden');
    }
  }

  /** `boss` is a live Riftwyrm (or any future boss with the same `{name, health, maxHealth}` shape) or null/undefined to hide the bar — no boss bar existed anywhere in this codebase before the Hollow Reach's Riftwyrm (phase 4). */
  updateBossBar(boss) {
    this.bossBarEl.classList.toggle('hidden', !boss);
    if (!boss) return;
    this.bossBarNameEl.textContent = boss.name ?? 'The Riftwyrm';
    this.bossBarFillEl.style.width = `${Math.max(0, boss.health / boss.maxHealth) * 100}%`;
  }
}
