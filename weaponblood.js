import { settings } from './settings.js';
import * as THREE from 'three';
import { INK_KEYS_GLSL, inkMat, noInk, RAINBOW_GLSL, INK_PEARL, PRISM_GLSL, INK_FX_GLSL, INK_T } from './inks.js';

/*
  Blood on a melee weapon. Every blow that draws blood leaves a splat on the business end
  (weapon frame: +Y along the shaft, +Z the striking side), drawn straight into the weapon's own
  materials by a small shader patch - glossy red while it's wet, drying to a dull brown crust.
  Wet blood creeps downhill along the shaft, beads at whatever point of it hangs lowest and
  drips off from there a drop at a time, and a hard swing flings a spatter of it off the end.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const MAX = 6;
const DRY = 45;              // seconds for wet blood to go tacky and stop running
const _v = V(), _w = V(), _g = V(), _q = new THREE.Quaternion(), _iq = new THREE.Quaternion();

let BEAD_GEO = null;

function patch(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBS = U.uBS;
    sh.uniforms.uBW = U.uBW;
    sh.uniforms.uBInv = U.uBInv;
    sh.uniforms.uInkT = INK_T;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBW;
uniform vec4 uBS[${MAX}];
uniform float uBW[${MAX}];
uniform mat4 uBInv;
${INK_KEYS_GLSL}
${RAINBOW_GLSL}
${PRISM_GLSL}
${INK_FX_GLSL}
float bHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bHash(i), bHash(i + vec3(1,0,0)), f.x), mix(bHash(i + vec3(0,1,0)), bHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bHash(i + vec3(0,0,1)), bHash(i + vec3(1,0,1)), f.x), mix(bHash(i + vec3(0,1,1)), bHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 bp = (uBInv * vec4(vBW, 1.0)).xyz;
float bn = bNoise(bp * 70.0) * 0.6 + bNoise(bp * 190.0) * 0.4;
float bMask = 0.0, bWet = 0.0;
vec3 bKey = vec3(0.0);
float bPm = 0.0, bPh = 0.0; // (prism: the hue of the splash most over this spot - its own)
for (int i = 0; i < ${MAX}; i++) {
  vec4 s = uBS[i];
  if (s.w <= 0.0) continue;
  // (uBW = wetness + 2 x its ink)
  float bi = floor(uBW[i] * 0.5 + 0.001), bw = uBW[i] - 2.0 * bi;
  // streaked along the shaft (it runs), ragged at the edge
  vec3 d = bp - s.xyz; d.y *= 0.55;
  float m = 1.0 - smoothstep(s.w * 0.35, s.w, length(d) + (bn - 0.5) * s.w * 0.9);
  bMask = max(bMask, m);
  bWet = max(bWet, m * bw);
  bKey += m * INK_KEY[int(bi)];
  float pm = m * inkPrism(INK_KEY[int(bi)]);
  if (pm > bPm) { bPm = pm; bPh = prHash(floor(s.xyz * 4000.0)); }
}
bKey /= max(max(bKey.r, bKey.g), max(bKey.b, 1e-3));
vec3 bCol = mix(vec3(0.16, 0.035, 0.02), vec3(0.34, 0.012, 0.02), bWet);
float bPearl = 0.3;
#ifndef FLAT_SHADED
bPearl = ${INK_PEARL};
#endif
bCol = mix(bKey * bCol.r + vec3(bCol.g), inkRainbowCol(bCol, bp * 4.0, 1.0 - bWet, bPearl), inkRainbow(bKey));
bCol = mix(bCol, inkPrismCol(vec3(0.16, 0.035, 0.0) + vec3(0.18, -0.023, 0.0) * bWet, bPh, 1.0 - bWet), inkPrism(bKey));
float bSk = inkSeek(bKey), bGx = inkGalaxy(bKey);
if (bSk > 0.01) bCol = mix(bCol, seekCol(bp * 2.0, 0.7, (1.0 - bWet) * 0.5, 0.0), bSk);
if (bGx > 0.01) bCol = mix(bCol, galaxyCol(bp, 0.5, (1.0 - bWet) * 0.5, 0.0), bGx);
float bMx = inkMatrix(bKey);
if (bMx > 0.01) bCol = mix(bCol, matrixCol(bp * 2.0, 0.7, (1.0 - bWet) * 0.5, 0.0), bMx);
diffuseColor.rgb = mix(diffuseColor.rgb, bCol, bMask * 0.92);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, mix(0.75, 0.12, bWet), bMask);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.0, bMask * 0.9);`);
  };
  mat.customProgramCacheKey = () => 'weaponblood';
  mat.needsUpdate = true;
}

export class WeaponBlood {
  /** mesh = the weapon group; def = its WEAPONS entry; blood = the BloodSystem. */
  constructor(mesh, def, blood) {
    this.mesh = mesh;
    this.def = def;
    this.blood = blood;
    this.splats = []; // { p: weapon-frame point, r, wet, amt }
    this.U = {
      uBS: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uBW: { value: new Array(MAX).fill(0) },
      uBInv: { value: new THREE.Matrix4() },
    };
    mesh.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) patch(o.material, this.U); });
    this.bead = null;
    this.beadR = 0;
    this.beadAt = null;
    this.beadWait = 0;
  }

  get wet() { let w = 0; for (const s of this.splats) w += s.wet * s.amt; return w; }
  /** The ink (inks.js) most of the wet blood on it is. */
  get ink() {
    const w = new Map();
    for (const s of this.splats) w.set(s.ink || 0, (w.get(s.ink || 0) || 0) + s.wet * s.amt);
    let best = 0, bw = 0;
    for (const [k, v] of w) if (v > bw) { bw = v; best = k; }
    return best;
  }

  /** Blood onto the weapon at world point p (where it went in), amount ~0..1, in ink (inks.js). */
  add(p, amount, ink = 0) {
    if (noInk(ink)) return; // (a bloodless body leaves nothing on the blade)
    if (!settings.blood || !settings.weaponBlood) return;
    amount *= Math.min(2, settings.bloodAmount);
    if (!(amount > 0.02)) return;
    this.mesh.updateMatrixWorld(true);
    const lp = this.mesh.worldToLocal(p.clone());
    const [y0, y1] = this.def.seg;
    lp.set(lp.x * 0.3, clamp(lp.y, y0, y1 + 0.02), lp.z * 0.6);
    // a second blow on the same spot soaks it rather than adding a splat
    const near = this.splats.find((s) => s.p.distanceTo(lp) < s.r * 0.6);
    if (near) {
      near.r = Math.min(0.12, near.r + amount * 0.02);
      near.wet = 1; near.amt = Math.min(1.5, near.amt + amount); near.ink = ink;
      return;
    }
    if (this.splats.length >= MAX) this.splats.shift();
    this.splats.push({ p: lp, r: 0.035 + amount * 0.045, wet: 1, amt: amount, ink });
  }

  clear() {
    this.splats.length = 0;
    this.bead?.removeFromParent();
    this.beadR = 0;
    this.sync();
  }

  sync() {
    const S = this.U.uBS.value, W = this.U.uBW.value;
    for (let i = 0; i < MAX; i++) {
      const s = this.splats[i];
      if (s) { S[i].set(s.p.x, s.p.y, s.p.z, s.r); W[i] = clamp(s.wet, 0, 1) + 2 * (s.ink || 0); }
      else { S[i].set(0, 0, 0, 0); W[i] = 0; }
    }
  }

  /** Each frame. vel = the weapon's velocity (m/s), tipVel = the business end's. */
  update(dt, vel, tipVel) {
    const M = this.mesh;
    M.updateMatrixWorld(true);
    this.U.uBInv.value.copy(M.matrixWorld).invert();
    if (!this.splats.length) return;
    M.getWorldQuaternion(_q);
    _iq.copy(_q).invert();
    // "down" in the weapon's frame: wet blood creeps that way along the shaft
    _g.set(0, -1, 0).applyQuaternion(_iq);
    const [y0, y1] = this.def.seg;
    let wetTotal = 0;
    for (const s of this.splats) {
      if (s.wet <= 0) continue;
      s.wet = Math.max(0, s.wet - dt / DRY);
      const run = s.wet * s.amt * 0.012 * dt;
      s.p.y = clamp(s.p.y + _g.y * run, y0 - 0.06, y1 + 0.03);
      s.p.z = clamp(s.p.z + _g.z * run * 0.5, -0.05, 0.05);
      wetTotal += s.wet * s.amt;
    }
    // a hard swing throws it off the end: cast-off
    const ts = tipVel ? tipVel.length() : 0;
    if (ts > 6.5 && wetTotal > 0.08 && this.blood) {
      const s = this.pickWet();
      if (s && Math.random() < dt * 30) {
        const at = M.localToWorld(_v.copy(s.p));
        const dir = _w.copy(tipVel).normalize();
        this.blood.inked(s.ink || 0).spray(at, dir, ts * 0.8, 2 + Math.round(Math.random() * 2), 0.12, 0.8);
        s.amt = Math.max(0, s.amt - 0.03);
      }
    }
    this.drip(dt, vel);
    this.sync();
  }

  pickWet() {
    let best = null, bw = 0;
    for (const s of this.splats) { const w = s.wet * s.amt * Math.random(); if (w > bw) { bw = w; best = s; } }
    return best;
  }

  /** Beads at the lowest wet point and lets go of it a drop at a time. */
  drip(dt, vel) {
    const M = this.mesh;
    // the lowest point of any wet splat (it hangs off the edge that faces the floor)
    let low = null, ly = Infinity, ls = null;
    for (const s of this.splats) {
      if (s.wet * s.amt < 0.05) continue;
      for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, 0, 0]]) {
        _v.set(s.p.x, s.p.y + dy * s.r * 0.8, s.p.z + dz * s.r * 0.45);
        const w = M.localToWorld(_v);
        if (w.y < ly) { ly = w.y; low = (low || V()).copy(w); ls = s; }
      }
    }
    if (!low) { if (this.bead) this.bead.visible = false; this.beadR = 0; return; }
    this.beadWait -= dt;
    if (this.beadWait > 0) { if (this.bead) this.bead.visible = false; return; }
    const wet = ls.wet * ls.amt;
    this.beadR += dt * 0.0035 * clamp(wet, 0.15, 1.2);
    if (!this.bead) {
      BEAD_GEO ||= new THREE.SphereGeometry(1, 8, 6);
      this.bead = new THREE.Mesh(BEAD_GEO, inkMat(0x5a0306, 0));
    }
    this.bead.material = inkMat(0x5a0306, ls.ink || 0);
    if (this.bead.parent !== M.parent && M.parent) M.parent.add(this.bead);
    const r = Math.min(this.beadR, 0.0055);
    this.bead.visible = true;
    this.bead.position.copy(low).y -= r * 0.9;
    this.bead.scale.set(r, r * 1.35, r);
    // heavy enough (or shaken loose): it falls
    const shake = vel ? vel.length() : 0;
    if (this.beadR >= 0.005 || (shake > 2.5 && this.beadR > 0.0025)) {
      this.blood?.inked(ls.ink || 0).drip(this.bead.position, (vel ? _w.copy(vel).multiplyScalar(0.5) : _w.set(0, 0, 0)).add(_v.set(0, -0.2, 0)), Math.max(0.003, r));
      ls.amt = Math.max(0, ls.amt - 0.025);
      this.beadR = 0;
      this.bead.visible = false;
      // the wetter it is, the quicker the next one forms
      this.beadWait = rnd(0.25, 0.8) / clamp(wet, 0.2, 1.2);
    }
  }
}
