/*
  Local settings (Esc menu -> Settings): everything a player might want to tune for themselves,
  gore piece by piece, graphics, camera, sound and the HUD. Saved in localStorage; any module
  reads `settings.x` when it needs it, or `onSetting('x', fn)` to act when it changes (fn is
  called straight away with the current value too).
*/

const KEY = 'settings.v1';

// What's in the menu: only what a player in a headset can change too (the same list is the VR
// menu's Settings page, vr.js) - every one an on/off switch.
export const SCHEMA = [
  { name: 'Gore', items: [
    { k: 'blood', label: 'Blood', def: true },
    { k: 'bloodSpray', label: 'Blood droplets in the air', def: true },
    { k: 'bloodFloor', label: 'Blood on the ground & cars', def: true },
    { k: 'bodyBlood', label: 'Blood on bodies & clothes', def: true },
    { k: 'bleeding', label: 'Bleeding (drips & pools)', def: true },
    { k: 'spurts', label: 'Arterial spurts', def: true },
    { k: 'weaponBlood', label: 'Blood on weapons', def: true },
    { k: 'wounds', label: 'Wound marks (cuts, bullet holes)', def: true },
    { k: 'bruises', label: 'Bruises', def: true },
    { k: 'dismember', label: 'Dismemberment / slicing', def: true },
    { k: 'flesh', label: 'Flesh on cut faces', def: true },
    { k: 'bones', label: 'Bone on cut faces', def: true },
    { k: 'coughBlood', label: 'Coughing up blood', def: true },
    { k: 'vomit', label: 'Vomiting', def: true },
    // everyone's blood, whatever they'd bleed (inks.js inkOf) - in a headset a slider of swatches
    { k: 'bloodColor', label: 'Blood colour', type: 'select', def: 'natural', opts: [['natural', 'Natural'], ['red', 'Red'], ['rotten', 'Brown'], ['gold', 'Gold'], ['brightgold', 'Yellow'], ['green', 'Green'], ['stark', 'Toxic green'], ['blue', 'Blue'], ['purple', 'Purple'], ['hotpink', 'Hot pink'], ['pink', 'Pink'], ['black', 'Black']] },
  ] },
  { name: 'Graphics', items: [
    { k: 'fog', label: 'Fog', def: true },
  ] },
  { name: 'Audio', items: [
    { k: 'volume', label: 'Master volume', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'volWeapons', label: 'Weapons & explosions', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'volWorld', label: 'Hits & world', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'volGore', label: 'Gore', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'volPeople', label: 'People (screams, coughs)', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'volVehicles', label: 'Vehicles', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'goreSounds', label: 'Gore sounds', def: true },
    { k: 'screams', label: 'Screams', def: true },
  ] },
  // voice chat (multiplayer/voice.js): open mic by default
  { name: 'Voice', items: [
  ] },
];
// Not in the menu any more (a headset can't reach them): always their base value, for the code
// that still reads them.
const FIXED = [
    { k: 'fullbright', label: 'Full bright (no lighting)', def: true },
    { k: 'shadows', label: 'Shadows', def: false },
    { k: 'charring', label: 'Burn charring', def: true },
    { k: 'fx', label: 'Fire, smoke & gas effects', def: true },
    { k: 'bloodAmount', label: 'Blood amount', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'shadowRes', label: 'Shadow quality', type: 'select', def: '2048', opts: [['512', 'Low'], ['1024', 'Medium'], ['2048', 'High'], ['4096', 'Ultra']] },
    { k: 'renderScale', label: 'Render scale', type: 'range', def: 1, min: 0.4, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'fov', label: 'Field of view', type: 'range', def: 55, min: 40, max: 110, step: 1, fmt: (v) => `${v}°` },
    { k: 'sens', label: 'Mouse sensitivity', type: 'range', def: 1, min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { k: 'invertY', label: 'Invert Y', def: false },
    { k: 'shake', label: 'Camera shake', def: true },
    { k: 'hitstop', label: 'Hit-stop freeze', def: true },
    { k: 'volSpeech', label: 'Spoken voices', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'voices', label: 'Spoken voices', def: true },
    { k: 'hud', label: 'HUD', def: true },
    { k: 'crosshair', label: 'Crosshair', def: true },
    { k: 'nameTags', label: 'Name tags', def: true },
    { k: 'bubbles', label: 'Speech bubbles', def: true },
];

const DEFS = {};
for (const c of SCHEMA) for (const it of c.items) DEFS[it.k] = it;
const FIXED_K = new Set(FIXED.map((it) => it.k));
for (const it of FIXED) DEFS[it.k] = it;

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
export const settings = {};
for (const k in DEFS) {
  const d = DEFS[k], v = saved[k];
  settings[k] = v === undefined || typeof v !== typeof d.def || FIXED_K.has(k) ? d.def : v;
}

const subs = {};
export function onSetting(k, fn) {
  (subs[k] ||= []).push(fn);
  fn(settings[k]);
}
export function setSetting(k, v) {
  if (!(k in DEFS) || settings[k] === v) return;
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  for (const fn of subs[k] || []) fn(v);
}
/** Blood amount scales a denser baseline so impacts leave more visible spray. */
export function bloodCount(n) {
  const x = n * settings.bloodAmount * 1.3;
  const f = Math.floor(x);
  return f + (Math.random() < x - f ? 1 : 0);
}

/** Extra sections other modules add to the end of the panel (fn(el), on every build). */
export const settingsExtras = [];

/** The panel: built from SCHEMA into `el`. */
export function buildSettings(el) {
  el.innerHTML = '';
  const inputs = {};
  for (const c of SCHEMA) {
    const h = document.createElement('h3');
    h.textContent = c.name;
    // (this section back to its base values)
    const rs = document.createElement('button');
    rs.className = 'reset';
    rs.textContent = 'Reset';
    rs.addEventListener('click', () => {
      for (const it of c.items) setSetting(it.k, it.def);
      buildSettings(el);
    });
    h.appendChild(rs);
    el.appendChild(h);
    const box = document.createElement('div');
    box.className = 'set';
    for (const it of c.items) {
      const row = document.createElement('label');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = it.label;
      row.appendChild(name);
      let input;
      if (it.type === 'range') {
        const wrap = document.createElement('span');
        wrap.className = 'rng';
        input = document.createElement('input');
        input.type = 'range';
        input.min = it.min; input.max = it.max; input.step = it.step;
        input.value = settings[it.k];
        const out = document.createElement('output');
        const show = () => { out.textContent = it.fmt ? it.fmt(+input.value) : input.value; };
        show();
        input.addEventListener('input', () => { show(); setSetting(it.k, +input.value); });
        wrap.append(input, out);
        row.appendChild(wrap);
      } else if (it.type === 'select') {
        input = document.createElement('select');
        for (const [v, t] of it.opts) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          input.appendChild(o);
        }
        input.value = settings[it.k];
        input.addEventListener('change', () => setSetting(it.k, input.value));
        row.appendChild(input);
      } else {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'sw';
        input.checked = settings[it.k];
        input.addEventListener('change', () => setSetting(it.k, input.checked));
        row.appendChild(input);
      }
      // (keys typed here aren't the game's)
      input.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
      inputs[it.k] = input;
      box.appendChild(row);
    }
    el.appendChild(box);
  }
  // quick presets for the gore section
  const bar = document.createElement('div');
  bar.className = 'presets';
  const preset = (label, on) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      for (const it of SCHEMA[0].items) {
        const v = it.type === 'range' ? (on ? 1 : 0) : it.type === 'select' ? it.def : on;
        setSetting(it.k, v);
        const inp = inputs[it.k];
        if (it.type === 'range') { inp.value = v; inp.dispatchEvent(new Event('input')); }
        else if (it.type === 'select') inp.value = v;
        else inp.checked = v;
      }
    });
    return b;
  };
  const reset = document.createElement('button');
  reset.textContent = 'Reset all to base';
  reset.addEventListener('click', () => {
    for (const k in DEFS) setSetting(k, DEFS[k].def);
    buildSettings(el);
  });
  bar.append(preset('All gore off', false), preset('All gore on', true), reset);
  el.insertBefore(bar, el.firstChild);
  for (const fn of settingsExtras) fn(el);
}
