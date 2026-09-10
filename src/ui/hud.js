import { itemIconTile, itemDisplayName, isBlockItem, getNonBlockItem } from '../items/items.js';
import { applyIcon } from './itemIcon.js';

const HOTBAR_ICON_SIZE = 36;

export class Hud {
  constructor(atlasUV) {
    this.atlasUV = atlasUV;
    this.vitalsEl = document.getElementById('vitals');
    this.healthFillEl = document.getElementById('health-fill');
    this.breathFillEl = document.getElementById('breath-fill');
    this.breathBarEl = document.getElementById('breath-bar');
    this.hotbarEl = document.getElementById('hotbar');
    this.underwaterEl = document.getElementById('underwater-overlay');

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
            fill.style.background = pct > 0.5 ? '#5fbf4a' : pct > 0.2 ? '#e0c23a' : '#d94a4a';
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
}
