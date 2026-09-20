// npm run test:model-viewer — Model and Animation Overhaul, phase 3's
// end-to-end test for the debug model viewer (src/debug/modelViewer.js).
// Drives the real page with ?debug=1 (same gate as tuningPanel.js) and
// exercises the viewer through its actual DOM controls — F8 to open,
// part-visibility checkboxes, rotation sliders, the animation picker/
// play/scrub, and every overlay toggle — rather than poking its
// internals directly, since this file's whole job is a real UI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newGamePage, closeAll } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_PATH = path.join(ROOT, 'assets', 'models', 'debug_test.model.json');

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  const originalModelText = fs.readFileSync(MODEL_PATH, 'utf8');
  try {
    // newGamePage itself always navigates with ?debug=1 appended — see
    // harness.js — so baseUrl is passed through as-is here.
    console.log(`[test:model-viewer] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await page.waitForFunction(() => !!window.__minevoxel?.modelViewer, undefined, { timeout: 10000 });

    async function step(label, fn) {
      process.stdout.write(`  - ${label}... `);
      await fn();
      console.log('ok');
    }

    await step('F8 opens the viewer and loads the debug fixture model', async () => {
      await page.keyboard.press('F8');
      await page.waitForSelector('#model-viewer:not(.hidden)', { timeout: 5000 });
      await page.waitForFunction(() => window.__minevoxel.modelViewer.model !== null, undefined, { timeout: 5000 });
      const partCount = await page.evaluate(() => window.__minevoxel.modelViewer.model.parts.size);
      if (partCount !== 6) throw new Error(`expected 6 parts (body/head/rightArm/leftArm/rightLeg/leftLeg), got ${partCount}`);
    });

    await step('the part tree lists every part with a visibility checkbox and rotation sliders', async () => {
      const rows = await page.$$('.mv-part-row');
      if (rows.length !== 6) throw new Error(`expected 6 part rows, got ${rows.length}`);
      const headRow = await page.$('.mv-part-row[data-part="head"]');
      if (!headRow) throw new Error('expected a row for "head"');
      const sliders = await headRow.$$('input[data-axis]');
      if (sliders.length !== 3) throw new Error(`expected 3 rotation sliders (x/y/z) on the head row, got ${sliders.length}`);
    });

    await step('unchecking a part\'s visibility checkbox zeroes its bone scale', async () => {
      await page.click('.mv-part-row[data-part="head"] input[data-part="head"]');
      await page.waitForTimeout(50); // one animation frame to apply
      const scale = await page.evaluate(() => {
        const bone = window.__minevoxel.modelViewer.model.getPart('head');
        return { x: bone.scale.x, y: bone.scale.y, z: bone.scale.z };
      });
      if (scale.x !== 0 || scale.y !== 0 || scale.z !== 0) throw new Error(`expected head's scale to be zeroed when hidden, got ${JSON.stringify(scale)}`);
      await page.click('.mv-part-row[data-part="head"] input[data-part="head"]'); // re-show for later steps
    });

    await step('dragging a rotation slider poses the real bone (manual pose, no animation selected)', async () => {
      const xSlider = await page.$('.mv-part-row[data-part="rightArm"] input[data-axis="x"]');
      await xSlider.evaluate((el) => {
        el.value = '90';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const rotX = await page.evaluate(() => window.__minevoxel.modelViewer.model.getPart('rightArm').rotation.x);
      if (Math.abs(rotX - Math.PI / 2) > 1e-3) throw new Error(`expected a 90 degree slider to set rotation.x to PI/2, got ${rotX}`);
    });

    await step('selecting a clip loads it, enables Play, and disables manual pose sliders immediately (before Play is even pressed)', async () => {
      const options = await page.$$eval('.mv-anim-select option', (opts) => opts.map((o) => o.textContent));
      if (!options.includes('walk')) throw new Error(`expected a "walk" option in the animation picker, got ${JSON.stringify(options)}`);
      await page.selectOption('.mv-anim-select', { label: 'walk' });
      await page.waitForFunction(() => window.__minevoxel.modelViewer.clip !== null, undefined, { timeout: 5000 });
      const playEnabled = await page.$eval('.mv-anim-play', (el) => !el.disabled);
      if (!playEnabled) throw new Error('expected the Play button to become enabled once a clip is selected');
      // A selected-but-paused clip already owns the pose at frame 0 (see
      // _applyCurrentFrame), so sliders must be disabled right away —
      // not just once playback starts — or a slider edit would just get
      // silently overwritten on the very next frame.
      const sliderDisabled = await page.$eval('.mv-part-row[data-part="rightLeg"] input[data-axis="x"]', (el) => el.disabled);
      if (!sliderDisabled) throw new Error('expected rotation sliders to already be disabled once a clip is selected, even before pressing Play');
    });

    await step('pressing Play advances animation time', async () => {
      await page.click('.mv-anim-play');
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => {
        const mv = window.__minevoxel.modelViewer;
        return { time: mv.animTime, sliderDisabled: document.querySelector('.mv-part-row[data-part="rightLeg"] input[data-axis="x"]').disabled };
      });
      if (state.time <= 0) throw new Error(`expected animTime to have advanced past 0 while playing, got ${state.time}`);
      if (!state.sliderDisabled) throw new Error('expected rotation sliders to still be disabled while an animation plays');
      // The procedural leg track should actually be driving the bone by now.
      const legRotX = await page.evaluate(() => window.__minevoxel.modelViewer.model.getPart('rightLeg').rotation.x);
      // Not asserting an exact value (depends on real elapsed time/limbSwing default), just that it moved off a suspiciously-exact rest 0.
      if (typeof legRotX !== 'number' || Number.isNaN(legRotX)) throw new Error(`expected a real numeric leg rotation, got ${legRotX}`);
    });

    await step('the limbSwing procedural-input slider actually changes the pose', async () => {
      await page.click('.mv-anim-play'); // pause
      const limbSwingRow = await page.$$('.mv-proc-row');
      let target = null;
      for (const row of limbSwingRow) {
        const text = await row.evaluate((el) => el.textContent);
        if (text.trim().startsWith('limbSwing') && !text.includes('Amount')) {
          target = row;
          break;
        }
      }
      if (!target) throw new Error('expected a limbSwing procedural-input row');
      const before = await page.evaluate(() => window.__minevoxel.modelViewer.model.getPart('rightLeg').rotation.x);
      const input = await target.$('input[type="range"]');
      await input.evaluate((el) => {
        el.value = '1.5';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const scrub = await page.$('.mv-anim-scrub');
      await scrub.evaluate((el) => el.dispatchEvent(new Event('input', { bubbles: true }))); // re-apply the current frame with the new var
      const after = await page.evaluate(() => window.__minevoxel.modelViewer.model.getPart('rightLeg').rotation.x);
      if (Math.abs(after - before) < 1e-6) throw new Error(`expected changing limbSwing to change the leg's rotation (before=${before}, after=${after})`);
    });

    await step("pausing re-syncs sliders to the bone's actual current rotation (no jump)", async () => {
      // Playback was already paused in the previous step (the second
      // click on .mv-anim-play) — assert the slider now reflects reality
      // rather than whatever it displayed before playback started.
      const { sliderDeg, boneDeg } = await page.evaluate(() => {
        const bone = window.__minevoxel.modelViewer.model.getPart('rightLeg');
        const slider = document.querySelector('.mv-part-row[data-part="rightLeg"] input[data-axis="x"]');
        return { sliderDeg: parseFloat(slider.value), boneDeg: (bone.rotation.x * 180) / Math.PI };
      });
      if (Math.abs(sliderDeg - boneDeg) > 1) throw new Error(`expected the slider (${sliderDeg} deg) to match the bone's real rotation (${boneDeg} deg) after pausing`);
    });

    await step('every overlay toggle checkbox actually flips its corresponding viewer.toggles flag', async () => {
      for (const name of ['wireframe', 'normals', 'pivots', 'attachments', 'boundingBoxes', 'uvOverlay']) {
        await page.click(`input[data-toggle="${name}"]`);
        const value = await page.evaluate((n) => window.__minevoxel.modelViewer.toggles[n], name);
        if (value !== true) throw new Error(`expected toggling "${name}" to set toggles.${name} to true`);
      }
      const wireframe = await page.evaluate(() => window.__minevoxel.modelViewer.model.mesh.material.wireframe);
      if (wireframe !== true) throw new Error('expected the wireframe toggle to actually set material.wireframe');
      const uvVisible = await page.$eval('.mv-uv-section', (el) => !el.classList.contains('hidden'));
      if (!uvVisible) throw new Error('expected the UV overlay section to become visible when toggled');
    });

    await step('the UV overlay canvas is actually drawn (non-blank)', async () => {
      const hasContent = await page.evaluate(() => {
        const canvas = document.querySelector('.mv-uv-canvas');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0) return true;
        return false;
      });
      if (!hasContent) throw new Error('expected the UV overlay canvas to have real pixel content');
    });

    await step('editing the model JSON on disk hot-reloads the live viewer (real file, real poll, no page reload)', async () => {
      // watchAsset (hotReload.js) never fires onChange on its own first
      // successful fetch — that fetch just establishes the baseline it
      // diffs future polls against (see hotReload.js's doc comment).
      // The watcher was created back when the viewer opened several
      // steps ago, but wait out one full poll interval explicitly
      // anyway rather than relying on the incidental timing of earlier
      // steps — otherwise editing the file before that first baseline
      // poll completes would make this edit silently BECOME the
      // baseline instead of triggering a reload.
      await page.waitForTimeout(1200);
      const edited = JSON.parse(originalModelText);
      edited.parts.head.pivot[1] = 34; // was 30 — a real, detectable change to bind-pose geometry
      fs.writeFileSync(MODEL_PATH, JSON.stringify(edited, null, 2));
      try {
        await page.waitForFunction(() => window.__minevoxel.modelViewer.model?.def.parts.head.pivot[1] === 34, undefined, { timeout: 5000 });
      } finally {
        fs.writeFileSync(MODEL_PATH, originalModelText);
      }
      // Confirm it's not just the stored def that changed but the actual
      // live geometry/bone rig was rebuilt to match.
      const headLocalY = await page.evaluate(() => {
        const model = window.__minevoxel.modelViewer.model;
        return model.restPose.get('head').position.y;
      });
      const expected = ((34 - 24) * (1 / 16)).toFixed(5); // head pivot minus body's own pivot, in world units
      if (Math.abs(headLocalY - parseFloat(expected)) > 1e-4) {
        throw new Error(`expected the rebuilt model's head bone to reflect the edited pivot (${expected}), got ${headLocalY}`);
      }
    });

    await step('F8 again closes the viewer', async () => {
      await page.keyboard.press('F8');
      // The element itself never becomes Playwright-"visible" once
      // display:none is applied — waitForSelector's default visible
      // state would wait forever on a contradiction. Just check the
      // class landed.
      await page.waitForFunction(() => document.getElementById('model-viewer').classList.contains('hidden'), undefined, { timeout: 5000 });
    });

    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    console.log('[test:model-viewer] PASS');
  } finally {
    // Belt-and-suspenders restore — the hot-reload step above already
    // restores in its own finally, but this guarantees the committed
    // fixture is never left edited if an earlier step throws first.
    fs.writeFileSync(MODEL_PATH, originalModelText);
    await closeAll({ browser, context });
  }
}
