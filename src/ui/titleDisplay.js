// On-screen title/subtitle and action-bar text — didn't exist anywhere
// in the HUD before the command system needed /title and /actionbar.
// Kept as its own small class (not bolted onto Hud) since it's pure
// transient-text display with its own timers, no per-frame game-state
// reads the way Hud's health/hotbar rendering needs.
export class TitleDisplay {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'title-display';
    this.root.innerHTML = `
      <div id="title-main" class="hidden"></div>
      <div id="title-sub" class="hidden"></div>
    `;
    document.getElementById('hud').appendChild(this.root);
    this.actionbarEl = document.createElement('div');
    this.actionbarEl.id = 'actionbar-display';
    this.actionbarEl.className = 'hidden';
    document.getElementById('hud').appendChild(this.actionbarEl);

    this.mainEl = this.root.querySelector('#title-main');
    this.subEl = this.root.querySelector('#title-sub');
    this._titleTimer = 0;
    this._actionbarTimer = 0;
  }

  showTitle(title, subtitle, holdSeconds = 3) {
    this.mainEl.textContent = title ?? '';
    this.mainEl.classList.toggle('hidden', !title);
    this.subEl.textContent = subtitle ?? '';
    this.subEl.classList.toggle('hidden', !subtitle);
    this._titleTimer = holdSeconds;
  }

  showActionbar(text, holdSeconds = 3) {
    this.actionbarEl.textContent = text;
    this.actionbarEl.classList.remove('hidden');
    this._actionbarTimer = holdSeconds;
  }

  update(dt) {
    if (this._titleTimer > 0) {
      this._titleTimer -= dt;
      if (this._titleTimer <= 0) {
        this.mainEl.classList.add('hidden');
        this.subEl.classList.add('hidden');
      }
    }
    if (this._actionbarTimer > 0) {
      this._actionbarTimer -= dt;
      if (this._actionbarTimer <= 0) this.actionbarEl.classList.add('hidden');
    }
  }
}
