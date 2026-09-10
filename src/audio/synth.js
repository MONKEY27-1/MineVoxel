import { audioEngine } from './audio.js';
import { getBlock } from '../world/blocks.js';

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
}

export function playBlockBreak(blockId) {
  const profile = MATERIAL_PROFILES[materialFor(blockId)] ?? MATERIAL_PROFILES.default;
  playProfile('blocks', { ...profile, decay: profile.decay * 1.6 }, { volume: 0.8, pitchVariance: 0.2 });
}

export function playBlockPlace(blockId) {
  const profile = MATERIAL_PROFILES[materialFor(blockId)] ?? MATERIAL_PROFILES.default;
  playProfile('blocks', { ...profile, decay: profile.decay * 0.8 }, { volume: 0.6, pitchVariance: 0.1 });
}

// --- Phase 10 polish: UI feedback + mob/player combat sounds ------------
// No sampled audio, same synthesized-tone approach as the material sounds
// above — just picked frequencies/noise mixes that read as "soft menu
// click", "thud", "groan" without needing real samples.

export function playUIClick() {
  playProfile('ui', { freq: 900, noise: 0.12, decay: 0.045 }, { volume: 0.45, pitchVariance: 0.04 });
}

export function playMobHit() {
  playProfile('mobs', { freq: 180, noise: 0.6, decay: 0.1 }, { volume: 0.5, pitchVariance: 0.2 });
}

export function playMobDeath() {
  playProfile('mobs', { freq: 90, noise: 0.7, decay: 0.35 }, { volume: 0.6, pitchVariance: 0.15 });
}

export function playPlayerHurt() {
  playProfile('mobs', { freq: 140, noise: 0.5, decay: 0.18 }, { volume: 0.55, pitchVariance: 0.1 });
}
