/*
  The psychedelic skin (special.js: costume 'psy'): materials marked userData.psy = hue offset
  are drawn with a living fractal - a Kaliset folded through the body's own space (stain.js
  wires it in with the stain volume's coordinates, so it rides on the body) - drifting through
  the colour wheel, breathing, and glowing a little from inside.
*/

/** Shared time uniform for every psy material (psyTick advances it). */
export const PSY_T = { value: 0 };
let last = 0;
/** Called every frame by any psy body (only the first call per frame counts). */
export function psyTick() {
  const now = performance.now() / 1000;
  if (now - last < 0.001) return;
  last = now;
  PSY_T.value = now % 3600;
}

/** GLSL (after <common>): psyCol(p, t, hue) -> colour and psyGlow (0..1) at body point p (m). */
export const PSY_GLSL = `
uniform float uPsyT;
float psyGlow;
vec3 psyPal(float h) { return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }
vec3 psyCol(vec3 p, float t, float hue) {
  // slow breathing zoom and a turn, so the pattern keeps unfolding
  float z = 2.6 + 0.4 * sin(t * 0.21);
  float a = t * 0.11, ca = cos(a), sa = sin(a);
  vec3 q = p * z;
  q.xz = mat2(ca, -sa, sa, ca) * q.xz;
  q += vec3(0.3 * sin(t * 0.17), t * 0.05, 0.2 * cos(t * 0.13));
  vec3 c = vec3(0.56 + 0.05 * sin(t * 0.37), 0.44 + 0.05 * cos(t * 0.29), 0.62 + 0.04 * sin(t * 0.23));
  // (later folds are finer: weighted down so they add detail, not noise)
  float acc = 0.0, prev = 0.0, trap = 1e3, w = 1.0;
  for (int i = 0; i < 7; i++) {
    q = abs(q) / clamp(dot(q, q), 0.08, 8.0) - c;
    float l = length(q);
    acc += abs(l - prev) * w;
    prev = l;
    trap = min(trap, abs(q.x * q.y) / w);
    w *= 0.72;
  }
  float band = acc * 0.22 - t * 0.07 + hue;
  vec3 col = psyPal(band);
  col *= col; // (deep, saturated: the palette is sRGB-ish, diffuse is linear)
  // bands of light and dark rolling through it, bright filaments where the orbit trap is tight
  float ring = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(acc * 2.2 - t * 1.3));
  float fil = exp(-trap * 6.0);
  vec3 f2 = psyPal(band + 0.5);
  col = mix(col * 0.12, col, ring) + f2 * f2 * fil * 0.7;
  psyGlow = clamp(fil * 0.8 + ring * 0.35, 0.0, 1.0);
  return col;
}`;
