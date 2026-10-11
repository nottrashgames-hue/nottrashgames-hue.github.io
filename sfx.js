import { settings } from './settings.js';
const NAMES = ['shot', 'casing', 'magout', 'magin', 'rack', 'dry', 'impact', 'flesh', 'mag', 'whoosh', 'punch', 'bat', 'crowbar', 'chop', 'cash', 'buy', 'engine', 'crash', 'glass', 'horn', 'door', 'can', 'bin', 'bottle', 'brick', 'spray', 'kick', 'rifle', 'shotgun', 'pump', 'shell', 'molotov', 'fireloop', 'gas', 'cough', 'clank', 'scream', 'explosion', 'pin', 'mg', 'dmr', 'sniper', 'bolt', 'gib', 'clap', 'highfive', 'rocket', 'launch', 'groan', 'wave', 'button', 'crunch', 'laser', 'nuke', 'vomit', 'gulp', 'ball', 'slip', 'beep', 'jet', 'glitch', 'footstep1', 'footstep2', 'footstep3', 'footstepGrass', 'footstepSand', 'footstepGravel', 'footstepWood', 'footstepMetal', 'wasted', 'saw'];
// sounds that reuse another clip: [clip, volume, playback rate]
const ALIAS = { rackback: ['rack', 0.5, 1.25], pickup: ['magin', 0.35, 1.3], grab: ['punch', 0.28, 1.55], drop: ['mag', 1, 0.8], wood: ['bat', 0.55, 0.75], paper: ['whoosh', 0.25, 1.7], tick: ['casing', 0.35, 0.7], clang: ['crowbar', 0.8, 0.7] };

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const master = ctx.createGain();
master.gain.value = 0.8;
/** Everything's loudness (settings): 1 = as mixed. */
export function setVolume(v) { master.gain.value = 0.8 * v; }
master.connect(ctx.destination);
// a bus per kind of sound, each with its own slider (settings: vol*)
const BUS_OF = {
  weapons: ['shot', 'casing', 'magout', 'magin', 'rack', 'rackback', 'dry', 'mag', 'rifle', 'shotgun', 'pump', 'shell', 'mg', 'dmr', 'sniper', 'bolt', 'rocket', 'launch', 'explosion', 'pin', 'molotov', 'gas', 'fireloop', 'laser', 'nuke', 'beep', 'jet'],
  gore: ['flesh', 'splat', 'chop', 'crunch', 'gib', 'saw'],
  people: ['scream', 'cough', 'vomit', 'gulp', 'groan', 'clap', 'highfive', 'wave'],
  vehicles: ['engine', 'crash', 'horn', 'door', 'tyre', 'skid'],
};
const bus = {};
const busOf = {};
for (const k of ['weapons', 'gore', 'people', 'vehicles', 'world']) { bus[k] = ctx.createGain(); bus[k].connect(master); }
for (const [k, list] of Object.entries(BUS_OF)) for (const n of list) busOf[n] = k;
const outFor = (name) => bus[busOf[name] || 'world'];
/** One kind of sound's loudness: 'weapons' | 'gore' | 'people' | 'vehicles' | 'world'. */
export function setBusVolume(k, v) { if (bus[k]) bus[k].gain.value = v; }
const buffers = {};
// clips that aren't wavs
const FILES = { splat: 'splat.mp3' };
for (const n of [...NAMES, ...Object.keys(FILES)]) {
  fetch(`./sfx/${FILES[n] || n + '.wav'}`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => { buffers[n] = buf; }).catch(() => {});
}
// browsers start audio suspended until the first input
const unlock = () => { if (ctx.state !== 'running') ctx.resume(); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

const last = {}, playing = {};
/**
 * Play sound `name` at volume 0..1, with a little pitch variety. Optional `o`:
 * rate (pitch), vary (random pitch +-), voices (most at once of this clip), gap (min seconds
 * between starts), len (cut short: fades out over its last 40%).
 */
const GORE = new Set(['flesh', 'splat', 'chop', 'crunch']);
export function sfx(name, vol = 1, o = null) {
  if (GORE.has(name) && !settings.goreSounds) return;
  if (name === 'scream' && !settings.screams) return;
  let rate = 1;
  const out = outFor(name);
  const a = ALIAS[name];
  if (a) { name = a[0]; vol *= a[1]; rate = a[2]; }
  if (o?.rate) rate *= o.rate;
  const buf = buffers[name];
  if (!buf || ctx.state !== 'running' || !(vol >= 0.02) || !Number.isFinite(vol) || !Number.isFinite(rate)) return;
  vol = Math.min(vol, 4);
  // don't stack dozens of the same clink in one instant
  const now = ctx.currentTime;
  if (name !== 'shot' && name !== 'rifle' && name !== 'mg' && last[name] && now - last[name] < (o?.gap ?? 0.025)) return;
  if (o?.voices && (playing[name] || 0) >= o.voices) return;
  last[name] = now;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const vary = o?.vary ?? 0.07;
  src.playbackRate.value = rate * (1 - vary + Math.random() * vary * 2);
  const g = ctx.createGain();
  g.gain.value = vol;
  if (o?.len) {
    g.gain.setValueAtTime(vol, now + o.len * 0.6);
    g.gain.linearRampToValueAtTime(0, now + o.len);
  }
  src.connect(g).connect(out);
  playing[name] = (playing[name] || 0) + 1;
  src.onended = () => { playing[name]--; };
  src.start();
  if (o?.len) src.stop(now + o.len + 0.02);
}

/** A looping clip whose volume and pitch follow the game (an engine). */
export function engineLoop(name) {
  let src = null, g = null, vol = 0, rate = 1;
  const start = () => {
    if (src || !buffers[name] || ctx.state !== 'running') return;
    src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.loop = true;
    g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(outFor(name));
    src.start();
  };
  return {
    set(v, r) {
      if (!Number.isFinite(v) || !Number.isFinite(r)) return;
      vol = v; rate = r;
      if (!src) { if (v < 0.01) return; start(); if (!src) return; }
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(vol, t, 0.08);
      src.playbackRate.setTargetAtTime(rate, t, 0.08);
    },
  };
}
