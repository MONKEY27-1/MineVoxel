import { audioEngine } from './audio.js';

// Hollow Reach phase 11: the first genuinely generative music in this
// codebase. Every existing synth.js sound is a single fire-and-forget
// envelope (playProfile's own one oscillator + one noise burst,
// scheduled and done); startWindSound (phase 9) is the only precedent
// for a long-lived, continuously-updated node, but it's still just one
// parameter-modulated drone, not multiple independent voices deciding
// their own notes and timing. This is closer to Eno's own "generative
// music" idea (Music for Airports): a handful of independent voices,
// each picking its own next note and delay at random from a shared
// scale, overlapping unpredictably rather than looping — no
// pre-composed sequence exists anywhere, and no two playthroughs sound
// the same. Reuses the existing 'ambient' category (added for the glide
// wind sound) rather than adding a new 'music' one — the two never
// actually play at once (nothing glides while standing at the exit
// portal), so a second settings-panel volume slider felt like scope
// this phase didn't need.
const SCALE = [130.81, 155.56, 174.61, 196.0, 233.08, 261.63, 311.13, 349.23]; // C minor pentatonic across two octaves, low register
const DRONE_FREQ = 65.41; // C2, well below the scale — a steady floor under the wandering voices above it

let active = false;
let voiceTimeouts = [];
let drone = null;

function pickNote() {
  return SCALE[Math.floor(Math.random() * SCALE.length)];
}

/** One soft pad note: slow attack, a short hold, a slower release — long enough to overlap the next voice's own note rather than reading as a discrete "plink". */
function playPad(freq, peakGain) {
  const ctx = audioEngine.ctx;
  const dest = audioEngine.categoryGains.ambient;
  if (!dest) return;
  const now = ctx.currentTime;
  const attack = 1.4 + Math.random() * 1.2;
  const hold = 1.5 + Math.random() * 2;
  const release = 2.5 + Math.random() * 2.5;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.006); // a hair of detune per note so it never reads as a synthesized loop
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + attack);
  gain.gain.setValueAtTime(peakGain, now + attack + hold);
  gain.gain.linearRampToValueAtTime(0, now + attack + hold + release);

  osc.connect(gain);
  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = (Math.random() - 0.5) * 1.4;
    gain.connect(panner).connect(dest);
  } else {
    gain.connect(dest);
  }
  osc.start(now);
  osc.stop(now + attack + hold + release + 0.1);
}

/** Schedules its own next call at a random delay — an independent voice, not a shared sequencer ticking every voice at once (the actual source of the "generative, never repeating" texture). */
function scheduleVoice(minMs, maxMs, freqFn, peakGain) {
  if (!active) return;
  const delay = minMs + Math.random() * (maxMs - minMs);
  const t = setTimeout(() => {
    if (!active) return;
    playPad(freqFn(), peakGain);
    scheduleVoice(minMs, maxMs, freqFn, peakGain);
  }, delay);
  voiceTimeouts.push(t);
}

function startDrone() {
  const ctx = audioEngine.ctx;
  const dest = audioEngine.categoryGains.ambient;
  if (!dest) return null;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = DRONE_FREQ;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06; // one slow breath roughly every 16s
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain).connect(gain.gain);
  osc.connect(gain).connect(dest);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 3); // fades in, not a hard start under the poem's first line
  osc.start(now);
  lfo.start(now);
  return { osc, lfo, gain };
}

export function startEndingMusic() {
  audioEngine.ensureStarted();
  if (active) return;
  active = true;
  drone = startDrone();
  scheduleVoice(2500, 6000, pickNote, 0.075);
  scheduleVoice(6000, 13000, () => pickNote() * 2, 0.05); // an octave up, sparser — a second independent voice, not a copy of the first
}

export function stopEndingMusic() {
  if (!active) return;
  active = false;
  for (const t of voiceTimeouts) clearTimeout(t);
  voiceTimeouts = [];
  if (drone) {
    const ctx = audioEngine.ctx;
    const now = ctx.currentTime;
    drone.gain.gain.cancelScheduledValues(now);
    drone.gain.gain.setValueAtTime(drone.gain.gain.value, now);
    drone.gain.gain.linearRampToValueAtTime(0, now + 1.5);
    const { osc, lfo } = drone;
    setTimeout(() => {
      try {
        osc.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
    }, 1600);
    drone = null;
  }
}
