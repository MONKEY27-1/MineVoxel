// Slices the (already-built) atlas canvas into per-tile CSS backgrounds
// instead of creating one <canvas> per inventory slot — the atlas is
// rasterized once, we just reposition/rescale the same data URL.
let atlasDataUrl = null;
let atlasW = 0;
let atlasH = 0;

export function initItemIcons(atlasCanvas) {
  atlasDataUrl = atlasCanvas.toDataURL();
  atlasW = atlasCanvas.width;
  atlasH = atlasCanvas.height;
}

export function applyIcon(el, tileName, atlasUV, size = 32) {
  const rect = atlasUV.get(tileName);
  if (!rect || !atlasDataUrl) {
    el.style.backgroundImage = 'none';
    return;
  }
  const tileWpx = (rect.u1 - rect.u0) * atlasW;
  const scale = size / tileWpx;
  const cssX = rect.u0 * atlasW * scale;
  const cssY = (1 - rect.v1) * atlasH * scale; // atlas.js stores v bottom-left-origin; CSS is top-left
  el.style.backgroundImage = `url(${atlasDataUrl})`;
  el.style.backgroundPosition = `-${cssX}px -${cssY}px`;
  el.style.backgroundSize = `${atlasW * scale}px ${atlasH * scale}px`;
  el.style.imageRendering = 'pixelated';
}
