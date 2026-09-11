// Debug-only live tuning panel (F6, ?debug=1 builds only) — a slider per
// entry in player.js's TUNING object, so movement/jump feel can be
// adjusted while actually playing instead of edit-reload-repeat. Once a
// session settles on values that feel right, hand-edit TUNING's defaults
// in player.js to bake them in — this panel has no persistence of its
// own, it's a scratchpad, not a settings screen (see ui/menus.js's real
// Settings panel for anything meant to be saved).
const SLIDER_SPECS = [
  { key: 'WALK_SPEED', label: 'Walk speed', min: 0.5, max: 10, step: 0.1 },
  { key: 'SPRINT_SPEED', label: 'Sprint speed', min: 0.5, max: 12, step: 0.1 },
  { key: 'SNEAK_SPEED', label: 'Sneak speed', min: 0.2, max: 5, step: 0.1 },
  { key: 'SWIM_SPEED', label: 'Swim speed', min: 0.5, max: 8, step: 0.1 },
  { key: 'SWIM_SPRINT_SPEED', label: 'Swim sprint speed', min: 0.5, max: 12, step: 0.1 },
  { key: 'FLY_SPEED', label: 'Fly speed', min: 1, max: 30, step: 0.1 },
  { key: 'FLY_SPRINT_SPEED', label: 'Fly sprint speed', min: 1, max: 40, step: 0.1 },
  { key: 'JUMP_SPEED', label: 'Jump speed', min: 2, max: 20, step: 0.1 },
  { key: 'SPRINT_JUMP_BOOST_SPEED', label: 'Sprint-jump boost', min: 2, max: 30, step: 0.1 },
  { key: 'STEP_HEIGHT', label: 'Step-up height', min: 0, max: 2, step: 0.05 },
  { key: 'COYOTE_TIME', label: 'Coyote time (s)', min: 0, max: 0.5, step: 0.01 },
  { key: 'JUMP_BUFFER_TIME', label: 'Jump buffer (s)', min: 0, max: 0.5, step: 0.01 },
  { key: 'SPRINT_FOV_BOOST', label: 'Sprint FOV boost (deg)', min: 0, max: 25, step: 1 },
  { key: 'FOV_LERP_SPEED', label: 'FOV ease speed', min: 1, max: 20, step: 0.5 },
  { key: 'DAMAGE_SHAKE_DURATION', label: 'Damage shake duration (s)', min: 0, max: 1, step: 0.01 },
  { key: 'DAMAGE_SHAKE_STRENGTH', label: 'Damage shake strength (rad)', min: 0, max: 0.1, step: 0.001 },
];

export class TuningPanel {
  constructor(tuning) {
    this.tuning = tuning;
    this.visible = false;
    this._buildDom();
  }

  _buildDom() {
    const root = document.createElement('div');
    root.id = 'tuning-panel';
    root.className = 'hidden';
    Object.assign(root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: '280px',
      maxHeight: '90vh',
      overflowY: 'auto',
      background: 'rgba(10, 12, 18, 0.85)',
      color: '#fff',
      font: '12px/1.4 monospace',
      padding: '10px 12px',
      borderRadius: '6px',
      zIndex: '50',
      pointerEvents: 'auto',
    });
    root.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;">Tuning (F6) — debug only, not saved</div>
      <div id="tuning-rows"></div>
      <button id="tuning-reset-btn" style="margin-top:8px;width:100%;">Reset all to current defaults</button>
    `;
    document.body.appendChild(root);
    this.root = root;

    const rows = root.querySelector('#tuning-rows');
    this._inputs = {};
    this._defaults = { ...this.tuning };
    for (const spec of SLIDER_SPECS) {
      const row = document.createElement('div');
      row.style.marginBottom = '6px';
      const valSpan = document.createElement('span');
      valSpan.textContent = this.tuning[spec.key].toFixed(2);
      const label = document.createElement('label');
      label.textContent = `${spec.label} `;
      label.style.display = 'flex';
      label.style.justifyContent = 'space-between';
      label.appendChild(valSpan);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = spec.min;
      slider.max = spec.max;
      slider.step = spec.step;
      slider.value = this.tuning[spec.key];
      slider.style.width = '100%';
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        this.tuning[spec.key] = v;
        valSpan.textContent = v.toFixed(2);
      });
      row.append(label, slider);
      rows.appendChild(row);
      this._inputs[spec.key] = { slider, valSpan };
    }

    root.querySelector('#tuning-reset-btn').addEventListener('click', () => {
      for (const spec of SLIDER_SPECS) {
        this.tuning[spec.key] = this._defaults[spec.key];
        this._inputs[spec.key].slider.value = this._defaults[spec.key];
        this._inputs[spec.key].valSpan.textContent = this._defaults[spec.key].toFixed(2);
      }
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }
}
