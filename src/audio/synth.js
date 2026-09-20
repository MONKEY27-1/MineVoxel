import { audioEngine } from './audio.js';
import { getBlock } from '../world/blocks.js';
import { showCaption } from '../ui/captions.js';

function blockLabel(blockId) {
  return getBlock(blockId).name.replace(/_/g, ' ');
}

// Per-material timbre: base oscillator frequency + a noise-burst mix,
// picked to read as "grass/soft", "stone/hard click", "wood/hollow",
// "sand/shuffle", "water/splash" without needing sampled audio.
const MATERIAL_PROFILES = {
  stone: { freq: 220, noise: 0.5, decay: 0.08 },
  wood: { freq: 150, noise: 0.25, decay: 0.12 },
  sand: { freq: 500, noise: 0.85, decay: 0.06 },
  gravel: { freq: 300, noise: 0.9, decay: 0.07 },
  grass: { freq: 380, noise: 0.4, decay: 0.09 },
  water: { freq: 600, noise: 0.7, decay: 0.15 },
  snow: { freq: 700, noise: 0.6, decay: 0.05 },
  glass: { freq: 1400, noise: 0.2, decay: 0.2 },
  default: { freq: 300, noise: 0.5, decay: 0.09 },
};

function materialFor(blockId) {
  const name = getBlock(blockId).name;
  if (name.includes('log') || name.includes('planks') || name.includes('mushroom_stem')) return 'wood';
  if (name === 'sand' || name === 'red_sand') return 'sand';
  if (name === 'gravel') return 'gravel';
  if (name.includes('grass') || name.includes('leaves') || name.includes('fern') || name.includes('bush')) return 'grass';
  if (name === 'water') return 'water';
  if (name.includes('snow') || name.includes('ice')) return 'snow';
  if (name === 'glass') return 'glass';
  if (name.includes('stone') || name.includes('ore') || name.includes('cobble')) return 'stone';
  return 'default';
}

function noiseBuffer(ctx, duration) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playProfile(category, profile, { volume = 1, pitchVariance = 0.15 } = {}) {
  audioEngine.ensureStarted();
  const ctx = audioEngine.ctx;
  const dest = audioEngine.categoryGains[category];
  if (!dest) return;

  const now = ctx.currentTime;
  const pitch = 1 + (Math.random() * 2 - 1) * pitchVariance;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = profile.freq * pitch;
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(volume * (1 - profile.noise) * 0.5, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + profile.decay);
  osc.connect(oscGain).connect(dest);
  osc.start(now);
  osc.stop(now + profile.decay + 0.02);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, profile.decay);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = profile.freq * 2 * pitch;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(volume * profile.noise * 0.5, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + profile.decay);
  noise.connect(noiseFilter).connect(noiseGain).connect(dest);
  noise.start(now);
}

export function playFootstep(blockId) {
  const profile = MATERIAL_PROFILES[materialFor(blockId)] ?? MATERIAL_PROFILES.default;
  playProfile('footsteps', profile, { volume: 0.35 });
  // Deliberately not captioned — footsteps fire every ~0.3-0.5s while
  // moving, constant and not informationally meaningful (unlike a break/
  // place/hit/explosion, which tells you something actually happened);
  // captioning it would flood the log and defeat the point of captions.
}

export function playBlockBreak(blockId) {
  const profile = MATERIAL_PROFILES[materialFor(blockId)] ?? MATERIAL_PROFILES.default;
  playProfile('blocks', { ...profile, decay: profile.decay * 1.6 }, { volume: 0.8, pitchVariance: 0.2 });
  showCaption(`Block broken (${blockLabel(blockId)})`);
}

export function playBlockPlace(blockId) {
  const profile = MATERIAL_PROFILES[materialFor(blockId)] ?? MATERIAL_PROFILES.default;
  playProfile('blocks', { ...profile, decay: profile.decay * 0.8 }, { volume: 0.6, pitchVariance: 0.1 });
  showCaption(`Block placed (${blockLabel(blockId)})`);
}

// --- Phase 10 polish: UI feedback + mob/player combat sounds ------------
// No sampled audio, same synthesized-tone approach as the material sounds
// above — just picked frequencies/noise mixes that read as "soft menu
// click", "thud", "groan" without needing real samples.

export function playUIClick() {
  playProfile('ui', { freq: 900, noise: 0.12, decay: 0.045 }, { volume: 0.45, pitchVariance: 0.04 });
  // Not captioned — visually self-evident (the button you just clicked
  // is right there), same reasoning vanilla accessibility guidance gives
  // for skipping UI-click captions specifically.
}

export function playMobHit() {
  playProfile('mobs', { freq: 180, noise: 0.6, decay: 0.1 }, { volume: 0.5, pitchVariance: 0.2 });
  showCaption('Mob hit');
}

export function playMobDeath() {
  playProfile('mobs', { freq: 90, noise: 0.7, decay: 0.35 }, { volume: 0.6, pitchVariance: 0.15 });
  showCaption('Mob died');
}

export function playPlayerHurt() {
  playProfile('mobs', { freq: 140, noise: 0.5, decay: 0.18 }, { volume: 0.55, pitchVariance: 0.1 });
  showCaption('You took damage');
}

// Phase 7 (Voidsteel): TNT's detonation — a low boom plus a long noise
// tail, same synthesis approach as everything else here (no downloaded
// assets), just a much longer decay/lower frequency than any existing
// profile to read as an explosion rather than a block break.
export function playExplosion() {
  playProfile('blocks', { freq: 55, noise: 0.75, decay: 0.6 }, { volume: 1, pitchVariance: 0.1 });
  showCaption('Explosion');
}

// Polish pass: water-entry splash. The 'water' MATERIAL_PROFILE already
// exists (used for footsteps/block sounds in water) but nothing played
// it for the moment of *entering* water specifically — `speed` (the
// player's clamped fall speed at entry) scales volume and decay length
// the same way the splash-particle burst scales its own count/spread.
export function playSplash(speed = 4) {
  const t = Math.min(1, speed / 12);
  const profile = MATERIAL_PROFILES.water;
  playProfile('blocks', { ...profile, decay: profile.decay * (1 + t) }, { volume: 0.4 + t * 0.5, pitchVariance: 0.15 });
  showCaption('Splash');
}

// Polish pass: cave-drip ambience — a soft, quiet, higher-pitched single
// droplet, distinct from the louder/lower splash above (a fall-speed-
// scaled event) since this is a periodic background cue, not something
// that just happened *to* the player.
export function playDrip() {
  playProfile('blocks', { freq: 900, noise: 0.3, decay: 0.12 }, { volume: 0.18, pitchVariance: 0.25 });
  showCaption('Drip');
}

// Phase 9 (Glidewings): Skyburst's launch whoosh and a wing-impact thud —
// both one-shots on the existing playProfile machinery, in the 'mobs'
// bucket the same way playPlayerHurt already borrows it for a
// player-centric (not strictly "mob") sound.
export function playSkyburst() {
  playProfile('mobs', { freq: 260, noise: 0.55, decay: 0.4 }, { volume: 0.8, pitchVariance: 0.1 });
  showCaption('Skyburst');
}

export function playGlideImpact() {
  playProfile('mobs', { freq: 120, noise: 0.65, decay: 0.25 }, { volume: 0.7, pitchVariance: 0.15 });
  showCaption('Wing impact');
}

// Phase 9 (Glidewings) wind: the first CONTINUOUS, parameter-updated sound
// in this codebase — every other sound here is a fire-and-forget envelope
// (create, ramp to 0, done). This one is created once on glide-start, has
// its gain/filter cutoff pushed every frame by updateWindSound() to track
// glideSpeed, and is explicitly stopped on glide-end — closer to a synth
// voice than a one-shot. Filtered looping noise (not a tone) reads as
// rushing air rather than a musical pitch.
let windNode = null;

export function startWindSound() {
  audioEngine.ensureStarted();
  const ctx = audioEngine.ctx;
  const dest = audioEngine.categoryGains.ambient;
  if (!dest || windNode) return;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 2);
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 500;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  noise.connect(filter).connect(gain).connect(dest);
  noise.start();
  windNode = { noise, filter, gain };
}

/** speedFraction: 0..1, current glideSpeed relative to its max — called every frame while gliding. */
export function updateWindSound(speedFraction) {
  if (!windNode) return;
  const t = Math.max(0, Math.min(1, speedFraction));
  const now = audioEngine.ctx.currentTime;
  windNode.gain.gain.setTargetAtTime(0.08 + t * 0.32, now, 0.1);
  windNode.filter.frequency.setTargetAtTime(400 + t * 2200, now, 0.1);
}

export function stopWindSound() {
  if (!windNode) return;
  const node = windNode;
  windNode = null;
  const ctx = audioEngine.ctx;
  const now = ctx.currentTime;
  node.gain.gain.setTargetAtTime(0, now, 0.08);
  setTimeout(() => { try { node.noise.stop(); } catch { /* already stopped */ } }, 300);
}
