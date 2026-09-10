// Tiny DOM-based confirm/prompt, matching this project's dark UI (menus.js,
// hud.js, inventoryUI.js) instead of native browser dialogs — native
// confirm()/prompt() also auto-dismiss under pointer lock in some browsers
// and can't be driven by automated testing, unlike a real DOM element.

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'menu-box modal-box';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  return { overlay, box };
}

/** Resolves true/false. Never rejects. */
export function showConfirm(message) {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();
    const text = document.createElement('p');
    text.className = 'modal-text';
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'modal-btn-row';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'menu-secondary-btn';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'menu-primary-btn';
    okBtn.textContent = 'OK';
    row.appendChild(cancelBtn);
    row.appendChild(okBtn);
    box.appendChild(text);
    box.appendChild(row);

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}

/** Resolves the entered string, or null if cancelled. */
export function showPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();
    const text = document.createElement('p');
    text.className = 'modal-text';
    text.textContent = message;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.value = defaultValue;
    const row = document.createElement('div');
    row.className = 'modal-btn-row';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'menu-secondary-btn';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'menu-primary-btn';
    okBtn.textContent = 'OK';
    row.appendChild(cancelBtn);
    row.appendChild(okBtn);
    box.appendChild(text);
    box.appendChild(input);
    box.appendChild(row);

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => finish(input.value));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // don't let input.js's global keydown listener react to typing
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    input.focus();
    input.select();
  });
}
