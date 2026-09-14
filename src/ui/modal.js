// Tiny DOM-based confirm/prompt, matching this project's dark UI (menus.js,
// hud.js, inventoryUI.js) instead of native browser dialogs — native
// confirm()/prompt() also auto-dismiss under pointer lock in some browsers
// and can't be driven by automated testing, unlike a real DOM element.

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Polish-pass tier-9 fix: Tab used to escape every modal (settings,
// inventory, these confirm/prompt boxes) straight to the browser's own
// chrome — confirmed fully absent, not just a gap on one dialog. A small
// stack (not a single active/inactive flag) so a confirm/prompt opened
// *from inside* the settings panel (e.g. "Delete world?") traps
// correctly on top of it without the settings panel's own trap fighting
// it for every Tab press once both are listening.
const trapStack = [];

/**
 * Confines Tab/Shift+Tab cycling to the focusable elements inside
 * `container` for as long as it's the topmost trap. Returns a cleanup
 * function — callers must call it when their modal closes, or the trap
 * (and, for nested modals, whatever trap was under it) never resumes
 * normal Tab behavior.
 */
export function trapFocus(container, { onEscape } = {}) {
  const entry = { container, onEscape };
  trapStack.push(entry);

  const onKeyDown = (e) => {
    if (trapStack[trapStack.length - 1] !== entry) return; // a nested trap owns Tab/Escape right now, not this one
    if (e.key === 'Escape' && onEscape) {
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!container.contains(document.activeElement)) {
      // Focus drifted outside (or nothing was focused yet) — pull it back in rather than letting Tab continue from wherever it actually was.
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  if (!container.contains(document.activeElement)) {
    const items = container.querySelectorAll(FOCUSABLE_SELECTOR);
    items[0]?.focus();
  }

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    const idx = trapStack.indexOf(entry);
    if (idx !== -1) trapStack.splice(idx, 1);
  };
}

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

    let untrap;
    const finish = (value) => {
      untrap();
      overlay.remove();
      resolve(value);
    };
    untrap = trapFocus(box, { onEscape: () => finish(false) });
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

    let untrap;
    const finish = (value) => {
      untrap();
      overlay.remove();
      resolve(value);
    };
    untrap = trapFocus(box, { onEscape: () => finish(null) });
    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => finish(input.value));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // don't let input.js's global keydown listener react to typing
      if (e.key === 'Enter') finish(input.value);
      // Escape is handled by the trap's own onEscape (window-level,
      // capture phase) — it fires before this bubble-phase listener
      // would, so no separate handling needed here.
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    input.focus();
    input.select();
  });
}
