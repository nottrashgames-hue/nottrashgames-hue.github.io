import { settings } from './settings.js';
/*
  Blood colours ("inks"). Everyone bleeds red (ink 0) except bodies whose look says otherwise
  (look.blood = 'blue' | 'gold' | ...; see special.js). An ink is a key colour: every red shade
  the blood code uses (thin film to dried crust) becomes the same darkness in that colour:
      red (r, g, b) -> key * r + g
  so each system keeps its own carefully picked reds and gets every other colour for free.
  'toon' inks are drawn flat with a black outline where the renderer can (floor, props).
*/

import * as THREE from 'three';

export const INKS = [
  { name: 'red', key: [1, 0, 0] },
  { name: 'blue', key: [0.12, 0.4, 1] },
  { name: 'gold', key: [1, 0.74, 0.16] },
  { name: 'pink', key: [1, 0.34, 0.66] },
  { name: 'grey', key: [1, 1, 1], toon: true },
  { name: 'purple', key: [0.6, 0.16, 1] },
  { name: 'green', key: [0.3, 0.95, 0.12] },
  { name: 'black', key: [0.16, 0.14, 0.13] },
  // no blood at all: nothing sprays, drips, stains or pools (a cut shows pale bone, the key)
  { name: 'none', key: [0.95, 0.9, 0.8], none: true },
  // rainbow: painted in pure magenta (its marker - see RAINBOW_GLSL), drawn as swirling
  // pearly rainbow colours that shift hue as it dries
  { name: 'rainbow', key: [1, 0, 1], rainbow: true },
  // the dead's: old, thick, gone brown - a rusty red-brown
  { name: 'rotten', key: [0.6, 0.3, 0.12] },
  // prism: every injury bleeds its own random, vivid colour - one solid hue per wound, not a
  // swirl - which slides on round the colour wheel as it dries, into a deep jewel tone. Painted
  // in cyan (its marker - see PRISM_GLSL) where a shader picks the colour; everywhere else
  // (drops, floor, cut faces) in the colour of the injury itself (prismHue)
  { name: 'prism', key: [0, 1, 1], prism: true },
  // stark green: a harsh, pure, almost glowing green (brighter and less yellow than 'green')
  { name: 'stark', key: [0.08, 1, 0.06] },
  // bright gold: a lighter, shinier, more yellow gold than 'gold'
  { name: 'brightgold', key: [1, 0.92, 0.38] },
  // the next two are drawn by shaders (see INK_FX_GLSL): painted in a marker key (pure blue /
  // pure yellow) where a shader picks the look; everywhere else (drops, gibs, cut faces) in base.
  // seek: black ink with eyes opening in it - white, staring, a black pupil each
  { name: 'seek', key: [0, 0, 1], base: [0.1, 0.085, 0.095], fx: 'seek' },
  // galaxy: deep space - purple and blue nebula swirls, full of stars
  { name: 'galaxy', key: [1, 1, 0], base: [0.5, 0.22, 1], fx: 'galaxy' },
  // gunmetal: a dark, cool, oily grey (darker and bluer than 'grey', and not drawn toon)
  { name: 'gunmetal', key: [0.46, 0.5, 0.56] },
  // matrix: falling green code - columns of glyphs raining down through it, a bright head on
  // each, flickering as they change (drawn by shaders, like seek and galaxy; marker key: this green)
  { name: 'matrix', key: [0, 1, 0.45], base: [0.06, 0.8, 0.26], fx: 'matrix' },
  // hot pink: a loud, saturated magenta-pink (much hotter than 'pink')
  { name: 'hotpink', key: [1, 0.05, 0.52] },
  // figure: not blood at all - it bleeds its own flesh, the same raw orange-red as its skin, and
  // what comes out is matte like it (drops and gibs are rough, faceted chunks: inkMat)
  { name: 'figure', key: [1, 0.36, 0.14], matte: true },
  // vomit (organs.js vomit()): not blood - a muddled green, with bits of orange, yellow and brown
  // in it (each its own ink, so a puddle of it is mottled). `film`: how it shows on a body
  // (stain.js addForeign) - lighter and duller than blood, it's not a dark liquid
  { name: 'vomit', key: [0.78, 1, 0.24], vomit: true, film: [0.42, 0.47, 0.16] },
  { name: 'vomitOrange', key: [1, 0.55, 0.1], vomit: true, film: [0.62, 0.36, 0.1] },
  { name: 'vomitYellow', key: [1, 0.86, 0.22], vomit: true, film: [0.6, 0.52, 0.16] },
  { name: 'vomitBrown', key: [1, 0.66, 0.32], vomit: true, film: [0.33, 0.22, 0.1] },
];
const INDEX = Object.fromEntries(INKS.map((k, i) => [k.name, i]));
const NONE = INDEX.none;
/** True for the ink of a body with no blood (nothing of it is ever drawn). */
export const noInk = (ink) => ink === NONE;

/** The ink of an actor (its look.blood), or an ink index passed straight through. */
export function inkOf(who) {
  // (a bloodless body stays bloodless, whatever colour everyone else bleeds)
  if (typeof who !== 'number' && who?.hero?.look?.blood === 'none') return NONE;
  // (vomit is vomit, whatever colour blood's been set to)
  if (typeof who === 'number' && INKS[who]?.vomit) return who;
  // (a blood colour picked in settings: everyone's, whatever they'd bleed)
  const o = settings.bloodColor;
  if (o && o !== 'natural') return INDEX[o] ?? 0;
  if (typeof who === 'number') return who | 0;
  const b = who?.hero?.look?.blood;
  const ink = b ? INDEX[b] ?? 0 : 0;
  // (a prism body: its latest injury's colour is the one coming out now)
  if (ink === PRISM_I) HUE = who._prismHue ??= Math.random();
  return ink;
}
const PRISM_I = INDEX.prism;

export const RAINBOW = INDEX.rainbow;
export const PRISM = INDEX.prism;
export const SEEK = INDEX.seek;
export const GALAXY = INDEX.galaxy;
export const MATRIX = INDEX.matrix;
/** Time (s) for the shader-drawn inks that move (matrix rain): shared by every material using INK_FX_GLSL. */
export const INK_T = { get value() { return (performance.now() / 1000) % 3600; } };
/** The shader-drawn look of an ink ('seek' | 'galaxy' | 'matrix'), or null. */
export const inkFx = (ink) => INKS[ink]?.fx || null;

/**
 * GLSL (after <common>): seek and galaxy blood. inkSeek(key) / inkGalaxy(key) are 1 where a
 * painted key is that ink's marker. seekCol(p, thick, dry, fl) is black ink with eyes in it at p
 * (metres); galaxyCol(p, thick, dry, fl) is a starry nebula. fl = 1 for a flat surface lying in
 * x/z (the floor: p.y ignored), 0 on a body in 3D. Cheap enough to run only where it's needed.
 * inkMatrix / matrixCol: falling green code; it moves, so materials using this set uInkT = INK_T.
 */
export const INK_FX_GLSL = `
uniform float uInkT;
float fxHash(vec3 c) { return fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float inkSeek(vec3 key) { return step(0.8, key.b) * (1.0 - smoothstep(0.05, 0.2, max(key.r, key.g))); }
float inkGalaxy(vec3 key) { return step(0.8, min(key.r, key.g)) * (1.0 - smoothstep(0.05, 0.2, key.b)); }
vec3 seekCol(vec3 p, float thick, float dry, float fl) {
  vec3 ink = mix(vec3(0.035, 0.022, 0.028), vec3(0.01, 0.007, 0.009), thick);
  vec3 q = p / 0.11;
  q.y = mix(q.y, 0.5, fl);
  vec3 i = floor(q);
  float vis = smoothstep(0.22, 0.5, thick) * (1.0 - 0.75 * dry);
  vec3 col = ink;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    if (fl > 0.5 && y != 0) continue;
    vec3 c = i + vec3(float(x), float(y), float(z));
    if (fxHash(c) > 0.42) continue;
    vec3 o = c + 0.5 + (vec3(fxHash(c + 7.0), 0.5, fxHash(c + 29.0)) - 0.5) * 0.6;
    o.y = mix(c.y + 0.2 + 0.6 * fxHash(c + 13.0), c.y + 0.5, fl);
    float r = 0.17 + 0.17 * fxHash(c + 41.0);
    vec3 d = q - o;
    // an almond, turned its own way; the pupil looks off somewhere
    float a = fxHash(c + 53.0) * 6.2832;
    vec3 ax = vec3(cos(a), 0.0, sin(a));
    float al = dot(d, ax);
    float ac = length(d - ax * al);
    float e = length(vec2(al / r, ac / (r * 0.58)));
    if (e > 1.0) continue;
    vec3 look = (vec3(fxHash(c + 61.0), fxHash(c + 67.0), fxHash(c + 71.0)) - 0.5) * r * 0.45;
    float pd = length(d - look) / r;
    vec3 eye = mix(vec3(0.95, 0.93, 0.9), vec3(0.55, 0.08, 0.08), smoothstep(0.72, 0.98, e) * 0.7);
    eye = mix(eye, vec3(0.02), 1.0 - smoothstep(0.28, 0.34, pd));
    col = mix(col, eye, (1.0 - smoothstep(0.9, 1.0, e)) * vis);
  }
  return col;
}
vec3 galaxyCol(vec3 p, float thick, float dry, float fl) {
  vec3 w = mix(p, vec3(p.x, 0.0, p.z), fl);
  float n = sin(w.x * 7.0 + sin(w.z * 5.0 + w.y * 3.0) * 2.0) * 0.5 + sin(w.z * 11.0 - w.x * 4.0 + w.y * 6.0) * 0.3 + sin((w.x + w.y - w.z) * 19.0) * 0.2;
  float m = sin(w.x * 3.0 - w.z * 6.0 + w.y * 4.0 + n * 1.5) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.02, 0.01, 0.07), vec3(0.34, 0.06, 0.5), smoothstep(-0.4, 0.9, n));
  col = mix(col, vec3(0.07, 0.28, 0.75), m * m * 0.6);
  col = mix(col, vec3(0.95, 0.3, 0.65), smoothstep(0.72, 1.0, n) * 0.45);
  col *= mix(1.15, 0.65, thick);
  // stars: many small ones, a few bright ones
  vec3 q = w * 60.0, i = floor(q);
  vec3 so = vec3(fxHash(i + 5.0), fxHash(i + 9.0), fxHash(i + 11.0)) * 0.6 + 0.2;
  vec3 dq = fract(q) - so; dq.y *= 1.0 - fl;
  float st = step(0.9, fxHash(i + 3.1)) * (1.0 - smoothstep(0.0, 0.16 + 0.12 * fxHash(i + 2.0), length(dq)));
  vec3 q2 = w * 17.0, i2 = floor(q2);
  vec3 d2 = fract(q2) - 0.5; d2.y *= 1.0 - fl;
  float s2 = step(0.94, fxHash(i2 + 1.7)) * (1.0 - smoothstep(0.0, 0.13, length(d2)));
  col += vec3(1.0, 0.95, 0.88) * (st + s2 * 1.5) * (1.0 - 0.5 * dry);
  return col * (1.0 - 0.4 * dry);
}
float inkMatrix(vec3 key) { return step(0.8, key.g) * (1.0 - smoothstep(0.08, 0.2, key.r)) * smoothstep(0.25, 0.35, key.b) * (1.0 - smoothstep(0.6, 0.72, key.b)); }
vec3 matrixCol(vec3 p, float thick, float dry, float fl) {
  // cells of code: on a body, columns round it falling down it; on the floor, across it
  vec2 q = mix(vec2(p.x + p.z * 0.73, -p.y), vec2(p.x, p.z), fl) / vec2(0.016, 0.022);
  vec2 c = floor(q), f = fract(q);
  float sp = 4.0 + 9.0 * fxHash(vec3(c.x, 3.0, 1.0));
  float head = uInkT * sp + fxHash(vec3(c.x, 7.0, 2.0)) * 97.0;
  float d = mod(head - c.y, 34.0 + 20.0 * fxHash(vec3(c.x, 11.0, 5.0)));
  float trail = exp(-d * 0.16);
  // a glyph: 3 x 5 bits, each cell swapping its glyph now and then
  float gs = floor(uInkT * (0.6 + 3.0 * fxHash(vec3(c, 5.0))) + fxHash(vec3(c, 9.0)) * 50.0);
  vec2 g = floor(f * vec2(4.0, 6.0));
  float on = (g.x < 3.0 && g.y < 5.0) ? step(0.42, fxHash(vec3(c.x + gs * 13.0, c.y - gs * 7.0, g.x + g.y * 3.0))) : 0.0;
  vec3 bg = mix(vec3(0.004, 0.03, 0.012), vec3(0.0, 0.012, 0.004), thick);
  vec3 green = vec3(0.12, 1.0, 0.38) * (0.12 + 0.88 * trail);
  green = mix(green, vec3(0.8, 1.0, 0.88), smoothstep(1.5, 0.0, d));
  float vis = smoothstep(0.1, 0.4, thick) * (1.0 - 0.65 * dry);
  return bg + green * on * vis;
}`;

// prism: the colour of the injury being drawn right now. Each body keeps the hue of its latest
// injury (rollPrism picks a new one); resolving its ink (inkOf) makes that the current hue.
let HUE = Math.random();
/** A new injury on a prism body: a new colour out of it from now on. */
export function rollPrism(who) { if (who && typeof who === 'object') who._prismHue = Math.random(); }
/** The current prism hue (0..1). */
export const prismHue = () => HUE;
/** Make h the current prism hue again (a drop that left a body landing somewhere). */
export const setPrismHue = (h) => { HUE = h; };
const hsv = (h, s, v) => {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
};
/** The prism colour at hue h (0..1): fully saturated, brightness v. */
export const prismRGB = (h, v = 1) => hsv(((h % 1) + 1) % 1, 1, v);
const BUCKETS = 24;
/** The current hue, snapped to one of a few steps (for things cached by colour). */
export const prismBucket = () => Math.floor(HUE * BUCKETS) % BUCKETS;
const bucketHue = () => (prismBucket() + 0.5) / BUCKETS;

/**
 * GLSL (after <common>): prism blood. inkPrism(key) is 1 where the key is the cyan marker;
 * prismCell(p, cell) is a random hue for the jittered cell around p (one per wound-sized spot);
 * inkPrismCol(c, h, dry) turns red shade c into hue h's colour, going on round the wheel and
 * deepening as it dries. prismHueOf(key) reads the hue back off a painted colour.
 */
export const PRISM_GLSL = `
vec3 prHsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
float inkPrism(vec3 key) { return step(0.8, min(key.g, key.b)) * (1.0 - smoothstep(0.06, 0.22, key.r)); }
float prHash(vec3 c) { return fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float prismCell(vec3 p, float cell) {
  vec3 q = p / cell, i = floor(q);
  float best = 9.0, h = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 c = i + vec3(float(x), float(y), float(z));
    vec3 o = c + vec3(prHash(c), prHash(c + 17.0), prHash(c + 31.0));
    vec3 d = q - o;
    float dd = dot(d, d);
    if (dd < best) { best = dd; h = prHash(c + 53.0); }
  }
  return h;
}
float prismHueOf(vec3 k) {
  float mx = max(k.r, max(k.g, k.b)), mn = min(k.r, min(k.g, k.b)), d = max(mx - mn, 1e-4);
  float h = mx == k.r ? mod((k.g - k.b) / d, 6.0) : mx == k.g ? (k.b - k.r) / d + 2.0 : (k.r - k.g) / d + 4.0;
  return h / 6.0;
}
vec3 inkPrismCol(vec3 c, float h, float dry) {
  float lum = c.r + c.g;
  // wet: candy-bright, a touch lighter where it's thin
  vec3 wet = prHsv(h, 0.92, 1.0) * (0.2 + lum * 1.7);
  // drying: on round the wheel, darker and richer
  vec3 dried = prHsv(h + 0.38, 0.95, 1.0) * (0.07 + lum * 1.15);
  return mix(wet, dried, smoothstep(0.0, 1.0, dry));
}`;

/**
 * GLSL (put it after <common>): rainbow blood. inkRainbow(key) is 1 where the ink key is the
 * rainbow's magenta marker; inkRainbowCol(c, p, dry, pearl) turns red shade c (its darkness)
 * at point p (metres) into swirling rainbow colour, going round the hues as it dries (dry
 * 0..1), with a pearly sheen at grazing angles (pearl 0..1, see INK_PEARL).
 */
export const RAINBOW_GLSL = `
vec3 inkPal(float h) { return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.333, 0.667))); }
float inkRainbow(vec3 key) { return step(0.8, min(key.r, key.b)) * (1.0 - smoothstep(0.06, 0.22, key.g)); }
vec3 inkRainbowCol(vec3 c, vec3 p, float dry, float pearl) {
  float h = dot(p, vec3(1.7, 2.3, 1.1)) + sin(p.x * 11.0 + p.z * 7.0) * 0.3 + sin(p.y * 13.0 - p.x * 9.0 + p.z * 5.0) * 0.25;
  h += dry * 0.6 + pearl * 0.4;
  float lum = c.r + c.g;
  vec3 wet = inkPal(h) * lum * 1.7;
  // drying: round the colour wheel to deeper, cooler tones gone a little milky
  vec3 dried = mix(inkPal(h + 0.3) * lum * 1.5, vec3(lum * 1.2), 0.22);
  vec3 col = mix(wet, dried, dry);
  return col + vec3(0.85, 0.92, 1.0) * pearl * pearl * mix(0.4, 0.2, dry);
}`;
/** GLSL expression: the pearl sheen term (after the normal and view varyings exist). */
export const INK_PEARL = 'pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 2.0)';

/** The vomit inks, by name. */
export const VOMIT = { green: INDEX.vomit, orange: INDEX.vomitOrange, yellow: INDEX.vomitYellow, brown: INDEX.vomitBrown };
export const isVomit = (ink) => !!INKS[ink]?.vomit;
/**
 * How this ink looks lying wet on a body that isn't its own (stain.js addForeign): [r, g, b].
 * Blood: its fresh film colour; prism: this injury's colour; vomit and the rest: their own.
 */
export function inkFilm(ink) {
  const I = INKS[ink];
  if (!I) return [0.46, 0.018, 0.026];
  if (I.film) return I.film;
  const k = ink === PRISM_I ? prismRGB(HUE) : I.base || I.key;
  // (rainbow: a pearly pink-violet stand-in; toon grey: flat mid grey)
  if (I.rainbow) return [0.55, 0.3, 0.6];
  if (I.toon) return [0.42, 0.42, 0.42];
  return [k[0] * 0.46 + 0.018, k[1] * 0.46 + 0.018, k[2] * 0.46 + 0.018];
}

/** A red blood shade in this ink. */
export function shade(ink, r, g, b) {
  if (!ink) return [r, g, b];
  const k = ink === PRISM_I ? prismRGB(HUE) : INKS[ink].base || INKS[ink].key;
  return [k[0] * r + g, k[1] * r + g, k[2] * r + g];
}
/** shade(), in the ink's marker key (for shaders that pick the colour themselves). */
function shadeKey(ink, r, g, b) {
  const k = INKS[ink].base || INKS[ink].key;
  return [k[0] * r + g, k[1] * r + g, k[2] * r + g];
}

/** Every `vec3(r, g, b)` literal in a GLSL snippet, re-shaded into this ink. */
export function shadeGLSL(src, ink) {
  if (!ink) return src;
  return src.replace(/vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/g, (m, r, g, b) =>
    `vec3(${shadeKey(ink, +r, +g, +b).map((x) => x.toFixed(4)).join(', ')})`);
}

/** The 0-255 RGB a surface brush paints this ink with (the key; its hue survives filtering). */
export const inkRGB = (ink) => (ink === PRISM_I
  // (prism: the injury's own colour, at a lower brightness - its mark, see bloodsurf.js)
  ? prismRGB(bucketHue(), PRISM_V) : INKS[ink].key).map((x) => Math.round(x * 255)).join(',');
/** How bright prism is painted on surfaces: every other ink's brightest channel is full. */
export const PRISM_V = 0.55;

/** GLSL: the key colours by index (for shaders that mix several inks per pixel). */
export const INK_KEYS_GLSL = `const vec3 INK_KEY[${INKS.length}] = vec3[](${INKS.map((k) => `vec3(${k.key.map((x) => x.toFixed(3)).join(', ')})`).join(', ')});`;

const MATS = new Map();
/** A shared MeshStandardMaterial in the colour of red `hex`, re-shaded into this ink. */
export function inkMat(hex, ink, props = {}) {
  const key = hex + ':' + ink;
  const pkey = ink === PRISM_I ? key + ':' + prismBucket() : key;
  let m = MATS.get(pkey);
  if (!m && ink === PRISM_I) {
    // (beads and gibs: glossy, in the injury's colour)
    const c = new THREE.Color(hex);
    const l = Math.min(1, c.getHSL({}).l * 2.2 + 0.3);
    m = new THREE.MeshPhysicalMaterial({ roughness: 0.08, metalness: 0, ...props, clearcoat: 1, clearcoatRoughness: 0.04 });
    m.color.setHSL(bucketHue(), 1, Math.min(0.55, l * 0.6));
    MATS.set(pkey, m);
  }
  if (!m && ink === RAINBOW) {
    // (beads and gibs: pearly, a thin film of every colour)
    const c = new THREE.Color(hex);
    const l = Math.min(1, c.getHSL({}).l * 3 + 0.25);
    m = new THREE.MeshPhysicalMaterial({
      roughness: 0.1, metalness: 0, ...props, color: new THREE.Color().setHSL(0.85, 0.6, l),
      iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [150, 900], clearcoat: 1, clearcoatRoughness: 0.05,
    });
    MATS.set(key, m);
  }
  if (!m) {
    const c = new THREE.Color(hex);
    const [r, g, b] = shade(ink, ...c.getRGB(new THREE.Color(), THREE.SRGBColorSpace).toArray());
    m = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0, ...props, ...(INKS[ink]?.matte ? { roughness: 0.82, flatShading: true } : null) });
    m.color.setRGB(r, g, b, THREE.SRGBColorSpace);
    MATS.set(key, m);
  }
  return m;
}
