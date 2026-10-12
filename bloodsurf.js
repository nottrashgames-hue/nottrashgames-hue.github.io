import { settings } from './settings.js';
const floorOn = () => settings.blood && settings.bloodFloor && settings.bloodAmount > 0;
import * as THREE from 'three';
import { ShapeGrid } from './world.js';
import { DRY_T } from './dry.js';
import { inkOf, inkRGB, noInk, RAINBOW_GLSL, INK_PEARL, PRISM, PRISM_GLSL, PRISM_V, prismBucket, INK_FX_GLSL, INK_T } from './inks.js';

/*
  Blood on level surfaces: the floor (lazy 8 m tiles) and every face of every box prop (top +
  four sides), each a canvas laid just off the surface.

  Brushes never paint colour: they accumulate soft *density* (alpha of white). A shader turns
  density into liquid: a threshold with a narrow smooth band gives a crisp wet edge, so nearby
  blobs, drops and strokes merge into one continuous body the way real blood pools and smears
  (metaball-style), and thicker areas shade darker and glossier.

  Each surface also keeps a coarse wetness grid so bodies and feet can pick fresh blood back up.

  Blood dries: each half-metre block of a surface remembers when it was last painted, and over
  DRY_T seconds its blood darkens to a matte brown-black and stops being picked up. Once dry,
  the block is baked - copied from the wet canvas into a second, dried one and cleared from the
  wet one - so nothing that drags, steps or rolls through it afterwards (smears, footprints,
  tread knocked out of a print) can move or wipe it any more. Fresh blood lands on top.
*/

const TILE = 8;
const PPM = 64;      // pixels per meter
const CELL = 0.125;  // wetness cell size (m)
const DRY = 1 / 20;  // wetness lost per second
const BLOCK = 0.5;   // drying block size (m)
const AGE_DT = 0.5;  // s between drying passes
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _sph = new THREE.Sphere();
const _fp = new THREE.Vector3();
const _shown = [];

let EMPTY = null;
const emptyTex = () => {
  if (!EMPTY) { EMPTY = new THREE.DataTexture(new Uint8Array(4), 1, 1); EMPTY.needsUpdate = true; }
  return EMPTY;
};

let MAT = null;
function bloodMaterial() {
  if (MAT) return MAT;
  MAT = new THREE.MeshStandardMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.22, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  MAT.onBeforeCompile = (sh) => {
    sh.uniforms.bloodMap = { value: null };
    sh.uniforms.dryMap = { value: null };
    sh.uniforms.ageMap = { value: null };
    sh.uniforms.ageScale = { value: new THREE.Vector2(1, 1) };
    sh.uniforms.uInkT = INK_T;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
        uniform sampler2D bloodMap, dryMap, ageMap;
        uniform vec2 ageScale;
        varying vec2 vBloodUv;
        float bloodRough, bloodPearl, bloodRain, bloodHeight;
        vec3 perturbBloodNormal(vec3 surfPos, vec3 surfNorm, vec2 heightGrad) {
          vec3 sigmaX = dFdx(surfPos), sigmaY = dFdy(surfPos);
          vec3 r1 = cross(sigmaY, surfNorm), r2 = cross(surfNorm, sigmaX);
          float det = dot(sigmaX, r1);
          vec3 grad = sign(det) * (heightGrad.x * r1 + heightGrad.y * r2);
          return normalize(abs(det) * surfNorm - grad);
        }
        ${RAINBOW_GLSL}
        ${PRISM_GLSL}
        ${INK_FX_GLSL}
        // thin film -> thick pool: fresh is bright arterial red to black-red, dried a matte
        // brown to near black
        // other inks (inks.js): the brushes paint the ink's key colour; the red shade's
        // darkness in that colour. A colourless key is a toon ink: flat grey, outlined in black.
        vec3 bloodCol(float d, float dry, vec3 texel) {
          vec3 key = texel / max(max(texel.r, texel.g), max(texel.b, 1e-3));
          float thick = smoothstep(0.2, 0.95, d);
          vec3 wet = mix(vec3(0.55, 0.025, 0.03), vec3(0.3, 0.01, 0.014), thick);
          vec3 dried = mix(vec3(0.2, 0.03, 0.022), vec3(0.1, 0.014, 0.011), thick);
          vec3 c = mix(wet, dried, dry), c0 = c;
          float rb = inkRainbow(key);
          bloodRain = max(bloodRain, rb);
          vec3 cr = inkRainbowCol(c, vec3(vBloodUv.x, 0.0, vBloodUv.y) * ${TILE}.0, dry, bloodPearl);
          c = mix(key * c.r + vec3(c.g), cr, rb);
          // prism (inks.js): painted in the injury's own colour, dimmer than any other ink - the
          // brightness is its mark, the hue its colour, going round the wheel as it dries
          float mx = max(max(texel.r, texel.g), texel.b);
          float pr = (1.0 - smoothstep(${(PRISM_V + 0.1).toFixed(2)}, ${(PRISM_V + 0.22).toFixed(2)}, mx)) * step(${(PRISM_V * 0.5).toFixed(2)}, mx);
          c = mix(c, inkPrismCol(c0, prismHueOf(key), dry), pr);
          bloodRain = max(bloodRain, pr);
          // seek (eyes in it) and galaxy (stars): their marker keys, drawn here (inks.js)
          vec3 fxP = vec3(vBloodUv.x, 0.055 / ${TILE}.0, vBloodUv.y) * ${TILE}.0;
          float sk = inkSeek(key) * (1.0 - pr);
          if (sk > 0.01) c = mix(c, seekCol(fxP, thick, dry, 1.0), sk);
          float gx = inkGalaxy(key) * (1.0 - pr);
          if (gx > 0.01) { c = mix(c, galaxyCol(fxP, thick, dry, 1.0), gx); bloodRain = max(bloodRain, gx * 0.6); }
          float mxk = inkMatrix(key) * (1.0 - pr);
          if (mxk > 0.01) c = mix(c, matrixCol(fxP, thick, dry, 1.0), mxk);
          // a slightly darker rim where the edge dries first
          c *= 1.0 - 0.2 * (1.0 - dry) * (1.0 - smoothstep(0.13, 0.26, d));
          // (the key's max channel is 1: how far its least one is below that = its saturation)
          float toon = 1.0 - smoothstep(0.08, 0.25, 1.0 - min(min(key.r, key.g), key.b));
          vec3 flat_ = d < 0.21 ? vec3(0.012) : vec3(mix(0.5, 0.3, dry));
          return mix(c, flat_, toon);
        }`)
      .replace('#include <map_fragment>', `
        bloodPearl = ${INK_PEARL}; bloodRain = 0.0;
        vec4 tw = texture2D(bloodMap, vBloodUv), td = texture2D(dryMap, vBloodUv);
        float dw = tw.a, dd = td.a;
        tw.rgb /= max(tw.a, 1e-3); // (the wet canvas is uploaded premultiplied)
        // (no blood here, wet or dried: the alpha below would come out exactly 0 - both edges
        // are smoothstep(0.13, 0.2, ..) - so this pixel adds nothing; skip the ink colours and
        // all the lighting of a tile that's mostly bare floor)
        if (dw <= 0.13 && dd <= 0.13) discard;
        float age = smoothstep(0.0, 1.0, texture2D(ageMap, vBloodUv * ageScale).r);
        bloodHeight = max(
          smoothstep(0.13, 0.95, dw) * (1.0 - age) * 0.014,
          smoothstep(0.13, 0.95, dd) * 0.002
        );
        float ew = smoothstep(0.13, 0.2, dw), ed = smoothstep(0.13, 0.2, dd);
        // fresh blood over the dried
        diffuseColor.rgb = mix(bloodCol(dd, 1.0, td.rgb), bloodCol(dw, age, tw.rgb), ew);
        diffuseColor.a *= max(ew, ed);
        float rw = mix(mix(0.3, 0.055, smoothstep(0.2, 0.95, dw)), 0.82, age);
        bloodRough = mix(0.82, rw, ew);
        // (rainbow blood keeps a pearly gloss, even dried)
        bloodRough = mix(bloodRough, mix(0.08, 0.3, age * ew + (1.0 - ew)), bloodRain);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bloodRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = perturbBloodNormal(-vViewPosition, normal, vec2(dFdx(bloodHeight), dFdy(bloodHeight)));`);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 buv;\nvarying vec2 vBloodUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBloodUv = buv;');
    MAT.userData.shader = sh;
  };
  return MAT;
}

/** One paintable rectangle: origin + s*u + t*v, s in [0,w], t in [0,h] (meters). */
class Surf {
  constructor(sys, scene, origin, u, v, w, h, n) {
    this.sys = sys;
    this.o = origin.clone(); this.u = u.clone(); this.v = v.clone(); this.w = w; this.h = h;
    this.n = n.clone();
    const ppm = sys.ppm || PPM;
    const rw = Math.min(1024, Math.ceil(w * ppm)), rh = Math.min(1024, Math.ceil(h * ppm));
    this.sx = rw / w; this.sy = rh / h;
    const canvas = document.createElement('canvas');
    canvas.width = rw; canvas.height = rh;
    this.ctx = canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.flipY = false;
    this.tex.anisotropy = 4;
    // (premultiplied: filtering and mipmaps blend the ink colour with bare floor without
    // darkening it - unpremultiplied, an edge fades through dim colours the shader reads as
    // prism ink, a coloured outline round every stain, worst at a headset's lower resolution)
    this.tex.premultiplyAlpha = true;
    // quad with explicit per-corner blood uvs (s/w, t/h)
    const g = new THREE.BufferGeometry();
    // (the quad only spans the blocks that hold blood - see fit - so a few drops on a big tile
    // don't cost a whole 8 m square of transparent, discarding fragments)
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 2, 3].flatMap(() => n.toArray()), 3));
    g.setAttribute('buv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
    // wind the quad so its front face points along n: DoubleSide flips the normal of back
    // faces, which would light the blood as if it faced into the floor (nearly black)
    const front = new THREE.Vector3().crossVectors(u, v).dot(n) > 0;
    g.setIndex(front ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    // each surface needs its own texture: clone the material, share the shader program
    // drying: last-painted time per block, shown through a small age map (0 fresh .. 1 dry)
    this.bw = Math.max(1, Math.ceil(w / BLOCK)); this.bh = Math.max(1, Math.ceil(h / BLOCK));
    this.bt = new Float32Array(this.bw * this.bh).fill(-1);
    this.live = 0; // blocks with wet blood
    this.ageData = new Uint8Array(this.bw * this.bh * 4);
    this.ageTex = new THREE.DataTexture(this.ageData, this.bw, this.bh);
    this.ageTex.magFilter = this.ageTex.minFilter = THREE.LinearFilter;
    this.ageTex.needsUpdate = true;
    this.dryCtx = null; this.dryTex = null; this.dryDirty = false;
    this.uni = {
      bloodMap: { value: this.tex }, dryMap: { value: emptyTex() }, ageMap: { value: this.ageTex },
      ageScale: { value: new THREE.Vector2(w / (this.bw * BLOCK), h / (this.bh * BLOCK)) },
    };
    const mat = bloodMaterial().clone();
    mat.onBeforeCompile = (sh) => { bloodMaterial().onBeforeCompile(sh); Object.assign(sh.uniforms, this.uni); };
    mat.customProgramCacheKey = () => 'blood';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.gw = Math.max(1, Math.ceil(w / CELL)); this.gh = Math.max(1, Math.ceil(h / CELL));
    this.wet = new Float32Array(this.gw * this.gh);
    this.inkc = new Uint8Array(this.gw * this.gh); // which ink most of that wet blood is
    this.own = new Uint16Array(this.gw * this.gh); // whose body most of it came off (ownId; 0: nobody's)
    this.dirty = false;
    this.upT = 0;
    this.wetT = 0;
    // for culling: a sphere round the whole rectangle, and a few points on it to look at
    this.c = this.o.clone().addScaledVector(u, w / 2).addScaledVector(v, h / 2);
    this.r = Math.hypot(w, h) / 2;
    this.probes = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([a, c]) =>
      this.o.clone().addScaledVector(u, w * a).addScaledVector(v, h * c).addScaledVector(n, 0.05));
    this.occ = false;
    this.lo = null; // [i0, j0, i1, j1]: the blocks with blood in them (null: none)
    this.cc = this.c.clone(); this.cr = this.r; // the sphere round just those
    this.mesh.visible = false;
  }
  /** Lay the quad over blocks i0..i1, j0..j1 only. */
  fit(i0, j0, i1, j1) {
    this.lo = [i0, j0, i1, j1];
    const s0 = i0 * BLOCK, t0 = j0 * BLOCK, s1 = Math.min(this.w, (i1 + 1) * BLOCK), t1 = Math.min(this.h, (j1 + 1) * BLOCK);
    const g = this.mesh.geometry, pos = g.attributes.position, uv = g.attributes.buv;
    const P = _fp;
    [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].forEach(([s, t], k) => {
      P.copy(this.o).addScaledVector(this.u, s).addScaledVector(this.v, t).addScaledVector(this.n, 0.006);
      pos.setXYZ(k, P.x, P.y, P.z);
      uv.setXY(k, s / this.w, t / this.h);
    });
    pos.needsUpdate = uv.needsUpdate = true;
    g.computeBoundingSphere();
    this.cc.copy(this.o).addScaledVector(this.u, (s0 + s1) / 2).addScaledVector(this.v, (t0 + t1) / 2);
    this.cr = Math.hypot(s1 - s0, t1 - t0) / 2;
  }
  /** Refit the quad to whatever blocks still hold blood (after some dried away). */
  refit() {
    let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
    for (let k = 0; k < this.bt.length; k++) {
      if (this.bt[k] < 0) continue;
      const i = k % this.bw, j = (k / this.bw) | 0;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    if (i1 < 0) { this.lo = null; this.mesh.visible = false; return; }
    const L = this.lo;
    if (!L || L[0] !== i0 || L[1] !== j0 || L[2] !== i1 || L[3] !== j1) this.fit(i0, j0, i1, j1);
  }
  st(p, out = { s: 0, t: 0 }) {
    const dx = p.x - this.o.x, dy = p.y - this.o.y, dz = p.z - this.o.z;
    out.s = dx * this.u.x + dy * this.u.y + dz * this.u.z;
    out.t = dx * this.v.x + dy * this.v.y + dz * this.v.z;
    return out;
  }
  /** Tangent (s, t) components of a world vector. */
  dir(vec) { return [vec.dot(this.u), vec.dot(this.v)]; }
  /** Paint on the wet canvas; (s0,t0)-(s1,t1) bounds what it can reach (those blocks are fresh again). */
  paint(draw, s0, t0, s1, t1) {
    const g = this.ctx;
    g.save();
    penReset(g, this.sx, this.sy);
    draw(g);
    g.restore();
    this.dirty = true;
    this.touch(s0, t0, s1, t1);
  }
  touch(s0, t0, s1, t1) {
    const i0 = clamp(Math.floor(s0 / BLOCK), 0, this.bw - 1), i1 = clamp(Math.floor(s1 / BLOCK), 0, this.bw - 1);
    const j0 = clamp(Math.floor(t0 / BLOCK), 0, this.bh - 1), j1 = clamp(Math.floor(t1 / BLOCK), 0, this.bh - 1);
    const now = this.sys.time;
    let changed = false;
    const L = this.lo;
    if (!L) this.fit(i0, j0, i1, j1);
    else if (i0 < L[0] || j0 < L[1] || i1 > L[2] || j1 > L[3]) this.fit(Math.min(i0, L[0]), Math.min(j0, L[1]), Math.max(i1, L[2]), Math.max(j1, L[3]));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * this.bw + i;
      // (the clock starts when blood first lands: more blood on top doesn't keep a stain
      // around - every stain on the ground is gone DRY_T s after it appeared)
      if (this.bt[k] >= 0) continue;
      this.live++;
      this.bt[k] = now;
      if (this.ageData[k * 4]) { this.ageData[k * 4] = 0; changed = true; }
    }
    if (changed) this.ageTex.needsUpdate = true;
  }
  /** 0 (fresh) .. 1 (dry) at surface point (s, t). */
  dryness(s, t) {
    const i = Math.floor(s / BLOCK), j = Math.floor(t / BLOCK);
    if (i < 0 || j < 0 || i >= this.bw || j >= this.bh) return 1;
    const b = this.bt[j * this.bw + i];
    return b < 0 ? 1 : clamp((this.sys.time - b) / DRY_T, 0, 1);
  }
  /** Ages every wet block; the dry ones are baked into the dried canvas. */
  age() {
    if (!this.live) return;
    const now = this.sys.time, bw = this.bw;
    let baked = false;
    for (let k = 0; k < this.bt.length; k++) {
      const b = this.bt[k];
      if (b < 0) continue;
      const a = (now - b) / DRY_T;
      // (a baked block's wet canvas is empty: its age reads 0 so it doesn't tint fresh blood beside it)
      if (a >= 1) { this.bake(k % bw, Math.floor(k / bw)); this.ageData[k * 4] = 0; baked = true; }
      else this.ageData[k * 4] = Math.round(a * 255);
    }
    this.ageTex.needsUpdate = true;
    if (baked) this.refit();
  }
  bake(i, j) {
    const k = j * this.bw + i;
    this.bt[k] = -1;
    this.live--;
    const cv = this.ctx.canvas;
    const x0 = Math.round(i * BLOCK * this.sx), x1 = Math.min(cv.width, Math.round(Math.min((i + 1) * BLOCK, this.w) * this.sx));
    const y0 = Math.round(j * BLOCK * this.sy), y1 = Math.min(cv.height, Math.round(Math.min((j + 1) * BLOCK, this.h) * this.sy));
    if (x1 <= x0 || y1 <= y0) return;
    // after DRY_T the stain is gone (not kept as dried blood)
    this.ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    this.dirty = true;
    // nothing left there to pick up
    for (let y = j * BLOCK; y < (j + 1) * BLOCK - 1e-6; y += CELL) for (let x = i * BLOCK; x < (i + 1) * BLOCK - 1e-6; x += CELL) {
      const c = this.cell(x + CELL / 2, y + CELL / 2);
      if (c >= 0) this.wet[c] = 0;
    }
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.tex.dispose();
    this.dryTex?.dispose();
    this.ageTex.dispose();
  }
  cell(s, t) {
    const i = Math.floor(s / CELL), j = Math.floor(t / CELL);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return -1;
    return j * this.gw + i;
  }
  wetAdd(s, t, r, a) {
    for (let x = s - r; x <= s + r + 1e-6; x += CELL) for (let y = t - r; y <= t + r + 1e-6; y += CELL) {
      const i = this.cell(x, y);
      if (i >= 0) {
        const w = this.wet[i];
        if (a > w * 0.6) { this.inkc[i] = INK; this.own[i] = OWN; }
        this.wet[i] = Math.min(1.5, w + a);
      }
    }
  }
}

// ---------- density brushes (canvas already in surface meters) ----------
// the soft round brush, rendered once: full in the middle, 75% at 0.55, fading to 0 at the rim
// (blobs merge under the threshold). Stamped with globalAlpha instead of building a gradient
// per dab - identical density, a fraction of the cost.
// Ink: the colour being painted right now (an inks.js index, 0 red). Every painter sets it
// from the surfaces' one-shot ink before drawing, and paints in that ink's key colour.
let INK = 0;
// Whose body the blood being laid down came off (ownId), 0 for nobody's: a body never soaks its
// own blood back up off the floor (dragged along, it would wipe and re-collect it forever)
let OWN = 0;
const OWNERS = new WeakMap();
let ownN = 0;
export const ownId = (a) => {
  if (!a) return 0;
  let id = OWNERS.get(a);
  if (!id) { id = (ownN = ownN % 65535 + 1); OWNERS.set(a, id); }
  return id;
};
const BRUSH = [];
const inkFill = () => `rgb(${inkRGB(INK)})`;
function brush() {
  // (prism: a brush per colour step)
  const k = INK === PRISM ? 'p' + prismBucket() : INK;
  if (BRUSH[k]) return BRUSH[k];
  const N = 128;
  const c = BRUSH[k] = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  const rgb = inkRGB(INK);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.55, `rgba(${rgb},0.75)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, N, N);
  return c;
}
/*
  The painters' transform, mirrored here instead of read back off the canvas: a dab is thousands
  of times a second in a gush, and a getTransform (a fresh DOMMatrix) plus a setTransform(DOMMatrix)
  back per dab cost more than the drawImage. The painters move the canvas with pen*() (the canvas
  does the same translate / rotate / scale, and the mirror follows with Blink's own arithmetic, in
  its order, so it holds exactly the numbers getTransform would have given). A dab translates and
  rotates the canvas itself as ever, and leaves it there - its alpha too; the next dab, or penSync
  before anything else is drawn, puts the painters' transform (and alpha 1) back, just as
  setTransform(getTransform()) did. Pixel for pixel the same as before.
*/
let TA = 1, TB = 0, TC = 0, TD = 1, TE = 0, TF = 0;
let PG = null, penDirty = false, penA = 1;
function penReset(g, sx, sy) {
  g.setTransform(sx, 0, 0, sy, 0, 0);
  TA = sx; TB = 0; TC = 0; TD = sy; TE = 0; TF = 0;
  PG = g; penDirty = false;
  penA = g.globalAlpha;
}
function penTranslate(x, y) {
  PG.translate(x, y);
  TE += x * TA + y * TC;
  TF += x * TB + y * TD;
}
function penRotate(r) {
  PG.rotate(r);
  const c = Math.cos(r), s = Math.sin(r);
  const a = c * TA + s * TC, b = c * TB + s * TD;
  TC = -s * TA + c * TC; TD = -s * TB + c * TD;
  TA = a; TB = b;
}
function penScale(x, y) {
  PG.scale(x, y);
  TA *= x; TB *= x; TC *= y; TD *= y;
}
const penGet = () => [TA, TB, TC, TD, TE, TF];
function penSet(m) {
  TA = m[0]; TB = m[1]; TC = m[2]; TD = m[3]; TE = m[4]; TF = m[5];
  PG.setTransform(TA, TB, TC, TD, TE, TF);
  penDirty = false;
}
/** The canvas back on the painters' transform, at full alpha (for anything that isn't a dab). */
function penSync(g) {
  if (penDirty) { g.setTransform(TA, TB, TC, TD, TE, TF); penDirty = false; }
  if (penA !== 1) { g.globalAlpha = 1; penA = 1; }
}
function dab(g, x, y, rx, ry, rot, a) {
  a = clamp(a, 0, 1);
  if (a <= 0) return;
  if (a !== a) a = 1; // (NaN: the canvas ignores it and draws at the alpha it had - always 1)
  if (penDirty) g.setTransform(TA, TB, TC, TD, TE, TF);
  g.translate(x, y);
  if (rot) g.rotate(rot);
  if (penA !== a) { g.globalAlpha = a; penA = a; }
  g.drawImage(brush(), -rx, -ry, rx * 2, ry * 2);
  penDirty = true;
}

/** Bounds (s0, t0, s1, t1) of a circle, and of a queue of strokes [as, at, bs, bt, width, ...]. */
const box = (s, t, r) => [s - r, t - r, s + r, t + r];
function qbox(Q, n) {
  let s0 = Infinity, t0 = Infinity, s1 = -Infinity, t1 = -Infinity;
  for (let q = 0; q < Q.length; q += n) {
    const w = Q[q + 4];
    s0 = Math.min(s0, Q[q] - w, Q[q + 2] - w); s1 = Math.max(s1, Q[q] + w, Q[q + 2] + w);
    t0 = Math.min(t0, Q[q + 1] - w, Q[q + 3] - w); t1 = Math.max(t1, Q[q + 1] + w, Q[q + 3] + w);
  }
  return [s0, t0, s1, t1];
}

export class BloodSurfaces {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.tiles = new Map();
    this.faces = new Map(); // box index + face -> Surf
    this.all = [];
    this.smearing = new Set(); // surfaces with smears queued this frame
    this.ink = 0;   // the next paint call's ink (inks.js); read once, then red again
    this.picked = 0; // the ink of the blood the last pickup() took
    this.own = 0;    // the next paint call's owner (by); read once, then nobody's
    this.time = 0;
    this.ageT = 0;
    this.rebuild();
    /*
      Culling (set by main each frame): where the eye is, what it can see, and a test for a
      wall in the way. Stains out of view, too far off, or behind a building aren't drawn - and
      aren't uploaded to the GPU either until they come back into view (the canvas uploads are
      most of what blood costs). far: metres; uploads / upRate: the upload budget.
    */
    this.view = null; // { pos, frustum, occluded(from, to), far }
    this.uploads = 6;
    this.upRate = 1 / 30;
    this.maxShown = Infinity; // most stained surfaces drawn at once (nearest first)
    this.ppm = PPM;           // canvas resolution of surfaces made from now on (lower in a headset)
    this.occT = 0;
  }

  /** Who's drawn this frame: in the view, near enough, not behind a wall (that's checked a few times a second). */
  cull(dt) {
    const Vw = this.view;
    if (!Vw) { for (const S of this.all) S.mesh.visible = !!S.lo; return; }
    this.occT -= dt;
    const recheck = this.occT <= 0;
    if (recheck) this.occT = 0.15;
    const far = Vw.far || 40;
    _shown.length = 0;
    for (const S of this.all) {
      // (nothing on it - all dried away, or never painted: nothing to draw)
      if (!S.lo) { S.mesh.visible = false; continue; }
      const d = S.cc.distanceTo(Vw.pos) - S.cr;
      let vis = d < far && (!Vw.frustum || Vw.frustum.intersectsSphere(_sph.set(S.cc, S.cr)));
      if (vis && Vw.occluded && recheck) {
        // (standing on it or right by it: no need to look)
        S.occ = d > 2 && S.probes.every((p) => Vw.occluded(Vw.pos, p));
      }
      if (vis && S.occ) vis = false;
      S.mesh.visible = vis;
      if (vis) { S.dist = d; _shown.push(S); }
    }
    // (a headset: only the nearest few stained surfaces are drawn at all)
    if (_shown.length > this.maxShown) {
      _shown.sort((a, b) => a.dist - b.dist);
      for (let i = this.maxShown; i < _shown.length; i++) _shown[i].mesh.visible = false;
    }
  }

  // ---------- surface lookup ----------
  floorTile(x, z, create = true) {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), key = (tx + 32768) * 65536 + (tz + 32768);
    let s = this.tiles.get(key);
    if (!s && create) {
      s = new Surf(this, this.scene, V(tx * TILE, 0, tz * TILE), V(1, 0, 0), V(0, 0, 1), TILE, TILE, V(0, 1, 0));
      this.tiles.set(key, s); this.all.push(s);
    }
    return s;
  }
  face(bi, f, create = true) {
    const key = bi * 8 + f;
    let s = this.faces.get(key);
    if (s || !create) return s;
    const b = this.boxes[bi];
    const W = b.maxX - b.minX, H = b.maxY - b.minY, D = b.maxZ - b.minZ;
    const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
    const defs = [
      [V(b.minX, b.maxY, b.minZ), X, Z, W, D, Y],                 // 0 top
      [V(b.maxX, b.minY, b.minZ), Z, Y, D, H, X],                 // 1 +x
      [V(b.minX, b.minY, b.minZ), Z, Y, D, H, X.clone().negate()], // 2 -x
      [V(b.minX, b.minY, b.maxZ), X, Y, W, H, Z],                 // 3 +z
      [V(b.minX, b.minY, b.minZ), X, Y, W, H, Z.clone().negate()], // 4 -z
    ];
    const [o, u, v, w, h, n] = defs[f];
    s = new Surf(this, this.scene, o, u, v, w, h, n);
    this.faces.set(key, s); this.all.push(s);
    return s;
  }
  /** The horizontal surface a point rests on (box top or floor). */
  horizontal(p, create = true) {
    const L = this.grid.query(p.x, p.z, p.x, p.z);
    for (let k = 0; k < L.length; k++) {
      const i = L[k], b = this.boxes[i];
      if (Math.abs(p.y - b.maxY) < 0.06 && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) return this.face(i, 0, create);
    }
    return this.floorTile(p.x, p.z, create);
  }
  /** Which box face (if any) a segment a->b just entered. Returns { surf, point, n } or null. */
  hitBox(a, b) {
    const L = this.grid.query(b.x, b.z, b.x, b.z);
    for (let k = 0; k < L.length; k++) {
      const i = L[k], B = this.boxes[i];
      if (b.x < B.minX || b.x > B.maxX || b.y < B.minY || b.y > B.maxY || b.z < B.minZ || b.z > B.maxZ) continue;
      // entered through the face whose plane the previous position was outside of
      let f = 0;
      if (a.y >= B.maxY) f = 0;
      else if (a.x >= B.maxX) f = 1;
      else if (a.x <= B.minX) f = 2;
      else if (a.z >= B.maxZ) f = 3;
      else if (a.z <= B.minZ) f = 4;
      else continue;
      if (B.topOnly && f !== 0) continue;
      const s = this.face(i, f);
      const p = b.clone();
      if (f === 0) p.y = B.maxY; else if (f === 1) p.x = B.maxX; else if (f === 2) p.x = B.minX; else if (f === 3) p.z = B.maxZ; else p.z = B.minZ;
      return { surf: s, point: p, n: s.n };
    }
    return null;
  }

  /** The next paint call (only that one) is this blood colour (actor or 0/1). */
  inked(b) { this.ink = inkOf(b); return this; }
  takeInk() { INK = this.ink | 0; this.ink = 0; OWN = this.own | 0; this.own = 0; return INK; }
  /** The next paint call (only that one) is blood that came off this body (see OWN). */
  by(actor) { this.own = ownId(actor); return this; }

  // ---------- painting ----------
  /**
   * A drop / gush landing on surface S at world p with world velocity vel: an elongated body
   * along the tangential velocity, satellite droplets thrown ahead, thin tails.
   */
  splat(S, p, vel, size, amount = 1) {
    if (!floorOn()) return;
    if (noInk(this.takeInk())) return;
    const { s, t } = S.st(p);
    const [vs, vt] = S.dir(vel);
    const sp = Math.hypot(vs, vt);
    const into = Math.abs(vel.dot(S.n));
    const ang = Math.atan2(vt, vs);
    const stretch = 1 + clamp(sp / Math.max(into, 0.5) * 0.6, 0, 3.5);
    S.paint((g) => {
      penTranslate(s, t);
      penRotate(ang);
      const a = 0.55 + 0.4 * amount;
      dab(g, size * (stretch - 1) * 0.3, 0, size * stretch * 0.75, size * 0.75 / Math.sqrt(stretch), 0, a);
      const lobes = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < lobes; i++) {
        const q = rnd(0, Math.PI * 2);
        dab(g, Math.cos(q) * size * stretch * 0.45, Math.sin(q) * size * 0.4, size * rnd(0.3, 0.5), size * rnd(0.3, 0.5), 0, a * 0.8);
      }
      // droplets thrown ahead, each elongated back toward the source
      const n = Math.floor(clamp(1 + sp * 2.2 * amount, 0, 18));
      for (let i = 0; i < n; i++) {
        const d = size * stretch * 0.7 + rnd(0.01, 0.05 + sp * 0.05);
        const off = rnd(-1, 1) * d * 0.5 / (1 + sp * 0.3);
        const r = rnd(0.004, 0.011) * (0.7 + amount * 0.5);
        dab(g, d, off, r * (1.2 + sp * 0.25), r, Math.atan2(off, d) * 0.3, rnd(0.6, 0.95));
        if (sp > 1.5 && Math.random() < 0.5) {
          const L = rnd(0.01, 0.025) * sp;
          for (let k = 1; k <= 3; k++) dab(g, d - (L * k) / 3, off * (1 - k * 0.03), r * 0.9, r * (0.7 - k * 0.12), 0, 0.5);
        }
      }
    }, ...box(s, t, size * stretch * 1.3 + 0.08 + sp * 0.06));
    S.wetAdd(s, t, size * 0.8, 0.5 * amount);
  }

  drop(S, p, vel, r = 0.006) {
    if (!floorOn()) return;
    if (noInk(this.takeInk())) return;
    const { s, t } = S.st(p);
    const [vs, vt] = S.dir(vel);
    const sp = Math.hypot(vs, vt);
    S.paint((g) => {
      dab(g, s, t, r * (1.6 + sp * 0.6), r * 1.6, Math.atan2(vt, vs), 0.9);
      if (Math.random() < 0.5) {
        const q = rnd(0, Math.PI * 2);
        dab(g, s + Math.cos(q) * r * 2.6, t + Math.sin(q) * r * 2.6, r * 0.6, r * 0.6, 0, 0.7);
      }
    }, ...box(s, t, r * (4 + sp * 0.6)));
    S.wetAdd(s, t, 0.02, 0.06);
  }

  /** Blood pooling on a horizontal surface under p: a soft, slowly spreading puddle. */
  /** look: how thickly it shows each time (a slowly filling puddle: < 1) - not how wet it is. */
  pool(p, r, amount, look = 1) {
    if (!floorOn()) return;
    r *= 1.2 * Math.sqrt(Math.min(3, settings.bloodAmount));
    if (noInk(this.takeInk())) return;
    const S = this.horizontal(p);
    const { s, t } = S.st(p);
    S.paint((g) => {
      for (let i = 0; i < 3; i++) {
        const q = rnd(0, Math.PI * 2), o = r * rnd(0, 0.3);
        dab(g, s + Math.cos(q) * o, t + Math.sin(q) * o, r * rnd(0.8, 1.1), r * rnd(0.7, 1), rnd(0, 3), (0.12 + 0.12 * amount) * look);
      }
    }, ...box(s, t, r * 1.5));
    S.wetAdd(s, t, r * 0.8, 0.12 * amount);
  }

  /**
   * A wet body part dragged from a to b across the surface it rests on: a continuous
   * stroke of overlapping dabs, then streaks knocked out of it by the texture of the part so
   * it reads as a drag, not a line of circles. load 0..1 thins and breaks it up.
   */
  smear(a, b, width, load) {
    const ink = this.takeInk();
    if (noInk(ink)) return;
    if (load < 0.02) return;
    const S = this.horizontal(a);
    const A = S.st(a), B = S.st(b, {});
    const ds = B.s - A.s, dt = B.t - A.t, len = Math.hypot(ds, dt);
    if (len < 1e-3) return;
    // queued: all of a surface's smears this frame are drawn together (see flushSmears)
    (S.smears ||= []).push(A.s, A.t, B.s, B.t, width, load, ink);
    this.smearing.add(S);
    S.wetAdd((A.s + B.s) / 2, (A.t + B.t) / 2, width * 0.5, 0.05 * load);
    INK = 0; OWN = 0;
  }

  /**
   * A bloody tyre rolling from a to b: a band of tread blocks laid down along the path (odo:
   * how far the tyre had rolled at a, so the blocks line up from one step to the next). A
   * skidding tyre smears one long streaky stripe instead. Painted on every surface the step
   * touches, so tracks carry across tile edges.
   */
  tyre(a, b, width, load, odo, skid) {
    const ink = this.takeInk();
    if (noInk(ink)) return;
    if (load < 0.015) return;
    const S0 = this.horizontal(a), S1 = this.horizontal(b);
    for (const S of S0 === S1 ? [S0] : [S0, S1]) {
      const A = S.st(a), B = S.st(b, {});
      if (Math.hypot(B.s - A.s, B.t - A.t) < 1e-3) continue;
      (S.tracks ||= []).push(A.s, A.t, B.s, B.t, width, load, odo, skid ? 1 : 0, ink);
      this.smearing.add(S);
      INK = ink; S.wetAdd((A.s + B.s) / 2, (A.t + B.t) / 2, width * 0.4, 0.015 * load); INK = 0;
    }
    OWN = 0;
  }

  flushTracks(S) {
    const Q = S.tracks;
    S.tracks = [];
    S.paint((g) => {
      // the rubber's print: a straight-edged band per step
      for (let q = 0; q < Q.length; q += 9) {
        const as = Q[q], at = Q[q + 1], ds = Q[q + 2] - as, dt = Q[q + 3] - at, w = Q[q + 4], load = Q[q + 5], skid = Q[q + 7];
        const len = Math.hypot(ds, dt);
        const t = penGet();
        penTranslate(as, at); penRotate(Math.atan2(dt, ds));
        penSync(g);
        g.globalAlpha = clamp((skid ? 0.3 : 0.22) + load * 0.75, 0, 0.95);
        INK = Q[q + 8];
        g.fillStyle = inkFill();
        g.fillRect(-0.004, -w / 2, len + 0.008, w);
        g.globalAlpha = 1;
        penSet(t);
      }
      // tread pulled back out of it: chevron blocks and two grooves (skids: streaks along)
      g.globalCompositeOperation = 'destination-out';
      g.lineCap = 'butt';
      for (let q = 0; q < Q.length; q += 9) {
        const as = Q[q], at = Q[q + 1], ds = Q[q + 2] - as, dt = Q[q + 3] - at, w = Q[q + 4], load = Q[q + 5], odo = Q[q + 6], skid = Q[q + 7];
        const len = Math.hypot(ds, dt);
        const t = penGet();
        penTranslate(as, at); penRotate(Math.atan2(dt, ds));
        penSync(g);
        if (skid) {
          g.lineWidth = 0.004;
          for (let i = 0; i < 9; i++) {
            const y = rnd(-0.48, 0.48) * w;
            g.strokeStyle = `rgba(0,0,0,${rnd(0.2, 0.6)})`;
            g.beginPath(); g.moveTo(0, y); g.lineTo(len, y + rnd(-0.004, 0.004)); g.stroke();
          }
        } else {
          const P = 0.045;
          g.strokeStyle = `rgba(0,0,0,${0.75 - load * 0.25})`;
          g.lineWidth = 0.013;
          g.beginPath();
          for (let d = P - (odo % P); d < len; d += P) {
            g.moveTo(d + 0.012, -w * 0.44); g.lineTo(d, -w * 0.08);
            g.moveTo(d, w * 0.08); g.lineTo(d + 0.012, w * 0.44);
          }
          g.stroke();
          g.lineWidth = 0.011;
          g.beginPath();
          for (const y of [-w * 0.24, w * 0.24]) { g.moveTo(-0.004, y); g.lineTo(len + 0.004, y); }
          g.stroke();
        }
        // a thinning load leaves a patchy print
        for (let i = 0, n = Math.round((1 - load) * 6 * len / 0.12); i < n; i++) {
          dab(g, rnd(0, len), rnd(-0.5, 0.5) * w, rnd(0.015, 0.04), rnd(0.012, 0.03), 0, rnd(0.4, 0.9));
        }
        penSet(t);
      }
    }, ...qbox(Q, 9));
    INK = 0;
  }

  /** Shoe print at p on the surface it's on, yaw 0 = +Z. */
  footprint(p, yaw, side, load) {
    if (!floorOn()) return;
    if (noInk(this.takeInk())) return;
    if (load < 0.03) return;
    const S = this.horizontal(p);
    const { s, t } = S.st(p);
    // world forward (sin yaw, cos yaw) in surface coords
    const [fs, ft] = S.dir(V(Math.sin(yaw), 0, Math.cos(yaw)));
    S.paint((g) => {
      penTranslate(s, t);
      penRotate(Math.atan2(ft, fs) - Math.PI / 2); // local +y = forward
      penScale(side, 1);
      const a = clamp(0.3 + load * 0.7, 0.3, 0.95);
      const L = 0.27, W = 0.095;
      for (let k = -2; k <= 2; k++) dab(g, 0.004 - k * 0.002, L * 0.2 + k * 0.03, W * 0.46, L * 0.13, 0.08, a * 0.8);
      dab(g, -0.006, -L * 0.32, W * 0.4, L * 0.15, 0, a * 0.9);
      // tread and patchy transfer knocked out of it
      g.globalCompositeOperation = 'destination-out';
      penSync(g);
      g.strokeStyle = `rgba(0,0,0,${0.5 - load * 0.25})`;
      g.lineWidth = 0.007;
      for (let i = -6; i <= 6; i++) {
        const y = i * 0.022;
        g.beginPath(); g.moveTo(-W * 0.6, y); g.lineTo(W * 0.6, y + 0.006); g.stroke();
      }
      for (let i = 0; i < (1 - load) * 12; i++) dab(g, rnd(-W * 0.5, W * 0.5), rnd(-L * 0.45, L * 0.45), rnd(0.008, 0.02), rnd(0.008, 0.02), 0, 0.8);
    }, ...box(s, t, 0.2));
  }

  wetAt(p) {
    const S = this.horizontal(p, false);
    if (!S) return 0;
    const { s, t } = S.st(p);
    const i = S.cell(s, t);
    return i < 0 ? 0 : S.wet[i] * (1 - S.dryness(s, t));
  }
  /** by: whose body is soaking it up - pickedOwn says whether what it got came off that very body. */
  pickup(p, amount, by = null) {
    const S = this.horizontal(p, false);
    this.pickedOwn = false;
    if (!S) return 0;
    const { s, t } = S.st(p);
    const i = S.cell(s, t);
    if (i < 0) return 0;
    this.pickedOwn = !!by && S.own[i] === ownId(by);
    // drying blood gets tacky: less and less of it comes away
    const got = Math.min(S.wet[i] * (1 - S.dryness(s, t)), amount);
    S.wet[i] -= got;
    this.picked = S.inkc[i];
    return got;
  }

  /**
   * Draw the frame's queued smears on S: every stroke of overlapping dabs first, then all the
   * streaks pulled back out of them in one destination-out pass (switching compositing per
   * smear stalls the canvas pipeline).
   */
  flushSmears(S) {
    const Q = S.smears;
    S.smears = [];
    S.paint((g) => {
      for (let q = 0; q < Q.length; q += 7) {
        const as = Q[q], at = Q[q + 1], ds = Q[q + 2] - as, dt = Q[q + 3] - at, width = Q[q + 4], load = Q[q + 5];
        const len = Math.hypot(ds, dt), ang = Math.atan2(dt, ds);
        const step = Math.max(0.006, width * 0.18);
        INK = Q[q + 6];
        for (let d = 0; d <= len; d += step) {
          const k = d / len;
          dab(g, as + ds * k, at + dt * k, width * 0.6, width * 0.5, ang, (0.16 + 0.22 * load) * rnd(0.85, 1.1));
        }
      }
      // streaks: pull density back out along the drag direction. Hairs are sorted into a few
      // alpha/width buckets and each bucket is stroked as one path.
      g.globalCompositeOperation = 'destination-out';
      penSync(g);
      g.lineCap = 'round';
      const buckets = new Map();
      for (let q = 0; q < Q.length; q += 7) {
        const as = Q[q], at = Q[q + 1], bs = Q[q + 2], bt = Q[q + 3], width = Q[q + 4], load = Q[q + 5];
        const len = Math.hypot(bs - as, bt - at);
        const nS = -(bt - at) / len, nT = (bs - as) / len;
        const hairs = Math.round(3 + width * 40);
        for (let i = 0; i < hairs; i++) {
          const o = rnd(-0.45, 0.45) * width;
          const al = Math.round(rnd(0.05, 0.25) * (1.3 - load) * 40) / 40;
          const lw = Math.round(rnd(0.002, 0.006) * 1000);
          if (al <= 0) continue;
          const key = al * 100 + lw;
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = { al, lw: lw / 1000, seg: [] }));
          b.seg.push(as + nS * o, at + nT * o, bs + nS * o, bt + nT * o);
        }
      }
      for (const b of buckets.values()) {
        g.strokeStyle = `rgba(0,0,0,${b.al})`;
        g.lineWidth = b.lw;
        g.beginPath();
        for (let k = 0; k < b.seg.length; k += 4) { g.moveTo(b.seg[k], b.seg[k + 1]); g.lineTo(b.seg[k + 2], b.seg[k + 3]); }
        g.stroke();
      }
    }, ...qbox(Q, 7));
    INK = 0;
  }

  /** Wipe every stain off the floor and furniture. */
  /** The level's walls and blocks to stain (again, when the map changes: everything on the old ones goes). */
  rebuild() {
    if (this.all.length) this.clear();
    this.boxes = this.colliders.solids.filter((s) => s.type === 'box').map((b) => ({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minY: b.y - b.h / 2, maxY: b.y + b.h / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
      topOnly: !!b.topOnly,
    }));
    this.grid = new ShapeGrid(this.boxes, (b) => [b.minX, b.minZ, b.maxX, b.maxZ]);
  }

  clear() {
    for (const S of this.all) S.dispose();
    this.all = [];
    this.tiles.clear();
    this.faces.clear();
    this.smearing.clear();
  }

  update(dt) {
    this.cull(dt);
    for (const S of this.smearing) {
      if (S.smears?.length) this.flushSmears(S);
      if (S.tracks?.length) this.flushTracks(S);
    }
    this.smearing.clear();
    this.time += dt;
    this.ageT += dt;
    const aging = this.ageT >= AGE_DT;
    if (aging) this.ageT = 0;
    let uploads = 0;
    for (const S of this.all) {
      if (aging) S.age();
      const shown = S.mesh.visible;
      if (S.dryDirty && shown && uploads < this.uploads) { S.dryTex.needsUpdate = true; S.dryDirty = false; uploads++; }
      S.wetT += dt;
      if (S.wetT > 0.5) {
        const k = DRY * S.wetT;
        if (S.live) for (let i = 0; i < S.wet.length; i++) if (S.wet[i] > 0) S.wet[i] = Math.max(0, S.wet[i] - k);
        S.wetT = 0;
      }
      // a big canvas re-upload is the expensive part: each surface at most 30 times a second
      S.upT -= dt;
      if (S.dirty && shown && S.upT <= 0 && uploads < this.uploads) { S.tex.needsUpdate = true; S.dirty = false; S.upT = this.upRate; uploads++; }
    }
  }
}
