import { settings } from './settings.js';
import * as THREE from 'three';
import { inHull, inCabin, cabinFloor } from './carmodel.js';
import { VolDry } from './dry.js';

/*
  Blood on cars, painted INTO the car the same way stain.js paints bodies: one small 3D volume
  over the car in its own frame (every car mesh is modelled in that frame, so the vertex
  position is the lookup), so a splat sits exactly on the panel, glass or seat it hit and rides
  along with the car wherever it goes. Allocated on the first drop.

  Heavy splats on steep panels start runs that crawl down the skin over the next few seconds.
  Glass turns opaque where the blood is; chrome and paint lose their metal under it.

  Blood dries (dry.js): over DRY_T seconds it browns to a matte crust, then is baked into a
  dried volume that nothing can wash, run or pick up again. Fresh blood lands on top.

  Tyres: every wheel keeps how much blood is on each of 24 sectors round its tread, so a wheel
  that rolled through a pool carries a band that turns with it and prints repeating tracks
  (see tyres.js).
*/

const VOX = 0.022;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _p = V(), _t = V(), _n = V(), _vt = V();

export class CarStain {
  constructor(car) {
    this.car = car;
    const S = this.S = car.S;
    this.min = V(-S.W / 2 - 0.25, 0, -S.hl - 0.08);
    const max = V(S.W / 2 + 0.25, S.roof + 0.32, S.hl + 0.08);
    const size = max.clone().sub(this.min);
    this.nx = Math.ceil(size.x / VOX); this.ny = Math.ceil(size.y / VOX); this.nz = Math.ceil(size.z / VOX);
    this.u = {
      carStain: { value: null },
      carStainMin: { value: this.min },
      carStainInv: { value: V(1 / (this.nx * VOX), 1 / (this.ny * VOX), 1 / (this.nz * VOX)) },
    };
    this.dry = new VolDry(this.nx, this.ny, this.nz, 6, 1, [0]);
    Object.assign(this.u, this.dry.u);
    this.data = null;
    this.dirty = false;
    this.upT = 0;
    this.runs = [];
  }

  alloc() {
    if (this.data) return;
    this.data = new Uint8Array(this.nx * this.ny * this.nz);
    const t = this.tex = new THREE.Data3DTexture(this.data, this.nx, this.ny, this.nz);
    t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    this.u.carStain.value = t;
    // the car's own meshes switch to stainable copies of their materials
    for (const m of this.car.m.stainable) m.material = stainMat(m.material, this.u);
  }

  /** Soft spherical brush in the car frame. */
  add(p, r, amt) {
    this.alloc();
    r = Math.max(r, VOX * 0.9);
    const D = this.data, mn = this.min;
    const x0 = Math.max(0, Math.floor((p.x - r - mn.x) / VOX)), x1 = Math.min(this.nx - 1, Math.floor((p.x + r - mn.x) / VOX));
    const y0 = Math.max(0, Math.floor((p.y - r - mn.y) / VOX)), y1 = Math.min(this.ny - 1, Math.floor((p.y + r - mn.y) / VOX));
    const z0 = Math.max(0, Math.floor((p.z - r - mn.z) / VOX)), z1 = Math.min(this.nz - 1, Math.floor((p.z + r - mn.z) / VOX));
    const r2 = r * r, a = amt * 255;
    for (let z = z0; z <= z1; z++) {
      const dz = mn.z + (z + 0.5) * VOX - p.z;
      for (let y = y0; y <= y1; y++) {
        const dy = mn.y + (y + 0.5) * VOX - p.y;
        let i = (z * this.ny + y) * this.nx + x0;
        for (let x = x0; x <= x1; x++, i++) {
          const dx = mn.x + (x + 0.5) * VOX - p.x;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r2) continue;
          const f = 1 - d2 / r2;
          const nv = D[i] + a * f * f;
          D[i] = nv > 255 ? 255 : nv;
        }
      }
    }
    this.dirty = true;
    this.dry.touch(x0, y0, z0, x1, y1, z1);
  }
  line(a, b, r, amt) {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / (Math.max(r, VOX) * 0.5)));
    const per = n > 1 ? amt * 0.45 : amt;
    for (let i = 0; i <= n; i++) this.add(_t.lerpVectors(a, b, i / n), r, per);
  }

  /** Rough outward normal of the skin at p (car frame). */
  normal(p, out) {
    const S = this.S, d = 0.035;
    out.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      _p.copy(p); _p.setComponent(k, p.getComponent(k) + d);
      const a = inHull(S, _p) ? 1 : 0;
      _p.setComponent(k, p.getComponent(k) - d);
      const b = inHull(S, _p) ? 1 : 0;
      out.setComponent(k, b - a);
    }
    if (out.lengthSq() < 0.5) out.set(0, 1, 0);
    return out.normalize();
  }

  /**
   * A drop landing on the skin at p with velocity v (both car frame): a body stretched along
   * the slide, specks thrown ahead, and on a steep panel a run that crawls downhill.
   */
  splat(p, v, size, amount) {
    if (!settings.blood || !settings.bloodFloor) return;
    const n = this.normal(p, _n);
    const r = clamp(size * 1.25, VOX * 0.9, 0.07);
    this.add(p, r, 0.55 + 0.4 * amount);
    _vt.copy(v).addScaledVector(n, -v.dot(n));
    const sp = _vt.length();
    if (sp > 0.8) {
      _vt.divideScalar(sp);
      const L = Math.min(0.22, sp * 0.014);
      this.line(p, _t.copy(p).addScaledVector(_vt, L), r * 0.6, 0.5 * amount);
      for (let i = 0, k = Math.min(4, Math.floor(sp / 2)); i < k; i++) {
        const q = p.clone().addScaledVector(_vt, L + rnd(0.02, 0.08));
        this.add(q, VOX * rnd(0.8, 1.1), 0.7);
      }
    }
    if (Math.abs(n.y) < 0.75 && amount > 0.5 && this.runs.length < 24 && Math.random() < 0.35 + amount * 0.3) {
      this.runs.push({ p: p.clone().addScaledVector(n, -0.004), n: n.clone(), left: rnd(0.06, 0.3) * amount, r: VOX * rnd(0.75, 0.95), t: 0 });
    }
  }
  /** Blood falling inside the cabin: onto a seat or the carpet, soaking in wider. */
  soak(p, amount) {
    this.add(p, rnd(0.03, 0.05), 0.35 + amount * 0.3);
  }

  clear() {
    if (!this.data) return;
    this.data.fill(0);
    this.runs.length = 0;
    this.dirty = true;
    this.dry.clear();
  }

  update(dt, budget) {
    const S = this.S;
    if (this.data && this.dry.update(dt, this.data)) this.dirty = true;
    this.dry.upload(budget);
    // runs: creep down the panel, hugging the skin, thinning out as they go
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const R = this.runs[i];
      const step = Math.min(R.left, dt * rnd(0.03, 0.07));
      const a = _t.copy(R.p);
      R.p.y -= step;
      // keep it on the surface: back inside if it slid off an overhang, out if it sank in
      for (let k = 0; k < 4 && !inHull(S, R.p); k++) R.p.addScaledVector(R.n, -0.008);
      for (let k = 0; k < 4 && inHull(S, _p.copy(R.p).addScaledVector(R.n, 0.012)); k++) R.p.addScaledVector(R.n, 0.006);
      this.line(a, R.p, R.r, 0.4);
      R.left -= step;
      R.r *= 1 - dt * 0.08;
      if (R.left <= 0 || R.p.y < S.sill) { this.add(R.p, R.r * 1.3, 0.5); this.runs.splice(i, 1); }
    }
    this.upT -= dt;
    if (this.dirty && this.upT <= 0 && budget.n > 0) {
      this.tex.needsUpdate = true;
      this.dirty = false;
      this.upT = 1 / 12;
      budget.n--;
    }
  }
}

/**
 * Does the drop moving a -> b (world) hit this car? Paints it and returns true if so.
 * The segment is taken into the car frame and the crossing of the skin found by bisection:
 * from outside it lands on the outside; spray from someone inside lands on the inside of the
 * glass or doors, and drips inside fall onto the seats and carpet. With the windshield gone,
 * drops pass through the hole.
 */
const _a = V(), _b = V(), _lo = V(), _hi = V(), _mid = V(), _v = V(), _iq = new THREE.Quaternion();
export function dropHitsCar(car, a, b, vel, size, amount) {
  const S = car.S;
  const dx = b.x - car.p.x, dz = b.z - car.p.z, R = S.hl + 0.4;
  if (dx * dx + dz * dz > R * R || b.y > car.p.y + 2.2) return false;
  _iq.copy(car.q).invert();
  _b.copy(b).sub(car.p).applyQuaternion(_iq);
  _a.copy(a).sub(car.p).applyQuaternion(_iq);
  const bIn = inHull(S, _b), aIn = inHull(S, _a);
  if (!aIn && !bIn) return false;
  if (aIn && bIn) {
    if (!inCabin(S, _b)) return false;
    const fy = cabinFloor(S, _b.x, _b.z);
    if (_b.y > fy) return false;
    _b.y = fy;
    (car.stain ||= new CarStain(car)).soak(_b, amount);
    return true;
  }
  if (aIn && !inCabin(S, _a)) return false;
  // bisect for the crossing: _hi ends on the inside
  _lo.copy(aIn ? _b : _a); _hi.copy(aIn ? _a : _b);
  for (let k = 0; k < 6; k++) {
    _mid.lerpVectors(_lo, _hi, 0.5);
    if (inHull(S, _mid)) _hi.copy(_mid); else _lo.copy(_mid);
  }
  const p = _hi;
  if (!car.m.windshield.visible && p.z > S.rf[0] && p.z < S.ws[0] - 0.03 && p.y > S.belt + 0.03 && Math.abs(p.x) < S.gx - 0.1) return false;
  // velocity relative to the car, in its frame
  _v.copy(vel).sub(car.velAt(b, _v2)).applyQuaternion(_iq);
  (car.stain ||= new CarStain(car)).splat(p, _v, size, amount);
  return true;
}
const _v2 = V();

// ---------------------------------------------------------------- materials
const CHUNK = `
  float cst = texture(carStain, vCarUvw).r;
  float cDry = texture(dryVol, vCarUvw).r;   // baked, dried blood
  float cAge = smoothstep(0.0, 1.0, texture(ageVol, vCarUvw * ageScale).r);
  float cEdge = smoothstep(0.12, 0.2, cst), cEdgeD = smoothstep(0.12, 0.2, cDry);
  vec3 cWet = mix(vec3(0.24, 0.012, 0.015), vec3(0.075, 0.003, 0.005), smoothstep(0.3, 1.0, cst));
  cWet *= 1.0 - 0.25 * (1.0 - cAge) * (1.0 - smoothstep(0.12, 0.28, cst));
  // drying: a matte brown-black crust
  vec3 cCrust = mix(vec3(0.14, 0.03, 0.02), vec3(0.06, 0.012, 0.009), smoothstep(0.3, 1.0, cst));
  cWet = mix(cWet, cCrust, cAge);
  vec3 cDried = mix(vec3(0.14, 0.03, 0.02), vec3(0.06, 0.012, 0.009), smoothstep(0.3, 1.0, cDry));
  // a faint dark mist of spatter around the edge
  float cMist = smoothstep(0.03, 0.12, max(cst, cDry)) * (1.0 - max(cEdge, cEdgeD));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.3, 0.3), 0.45 * cMist);
  diffuseColor.rgb = mix(diffuseColor.rgb, cDried, cEdgeD);
  diffuseColor.rgb = mix(diffuseColor.rgb, cWet, cEdge);
  float cCover = max(cEdge, cEdgeD);           // how much the skin is covered
  float cGloss = cEdge * (1.0 - cAge);         // how much of that is still liquid
`;
function stainMat(base, u) {
  const glass = base.transparent;
  const mat = base.clone();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 carStainMin;\nuniform vec3 carStainInv;\nvarying vec3 vCarUvw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarUvw = (position - carStainMin) * carStainInv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler3D carStain, dryVol, ageVol;\nuniform vec3 ageScale;\nvarying vec3 vCarUvw;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CHUNK}\n${glass ? 'diffuseColor.a = mix(diffuseColor.a, 0.94, cCover);' : ''}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, mix(0.85, 0.2, cGloss / max(cCover, 1e-3)), cCover);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, cCover);');
  };
  mat.customProgramCacheKey = () => 'carstain' + (glass ? '-g' : '');
  return mat;
}

/** A per-wheel copy of the wheel material with a blood band on the tread (24 sectors). */
export const TYRE_SECTORS = 24;
export function tyreMat(base, sectors, ages, dried, r, rim) {
  const mat = base.clone();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tyreBlood = { value: sectors };
    sh.uniforms.tyreAge = { value: ages };
    sh.uniforms.tyreDried = { value: dried };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTyre;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTyre = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTyre;\nuniform float tyreBlood[${TYRE_SECTORS}], tyreAge[${TYRE_SECTORS}], tyreDried[${TYRE_SECTORS}];`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tr = length(vTyre.yz);
        if (tr > ${(rim * 1.04).toFixed(4)}) {
          float a = (atan(vTyre.y, vTyre.z) / 6.2831853 + 0.5) * ${TYRE_SECTORS}.0;
          int i0 = int(floor(a)) % ${TYRE_SECTORS};
          int i1 = (i0 + 1) % ${TYRE_SECTORS};
          float f = fract(a);
          float b = mix(tyreBlood[i0], tyreBlood[i1], f);
          float bd = mix(tyreDried[i0], tyreDried[i1], f);
          float age = smoothstep(0.0, 1.0, mix(tyreAge[i0], tyreAge[i1], f));
          // broken up by the tread blocks
          float blocks = 0.75 + 0.25 * sin(a * 18.0) * sin(vTyre.x * 90.0);
          // thickest on the tread, reaching up the sidewall where there is a lot
          float onT = smoothstep(${(rim + (r - rim) * 0.35).toFixed(4)}, ${(r * 0.97).toFixed(4)}, tr + b * 0.06);
          float onD = smoothstep(${(rim + (r - rim) * 0.35).toFixed(4)}, ${(r * 0.97).toFixed(4)}, tr + bd * 0.06);
          float e = smoothstep(0.08, 0.3, b * onT * blocks);
          float eD = smoothstep(0.08, 0.3, bd * onD * blocks);
          vec3 crust = mix(vec3(0.13, 0.03, 0.02), vec3(0.06, 0.013, 0.01), smoothstep(0.4, 1.0, max(b, bd)));
          vec3 bc = mix(mix(vec3(0.34, 0.015, 0.02), vec3(0.14, 0.004, 0.006), smoothstep(0.4, 1.0, b)), crust, age);
          diffuseColor.rgb = mix(diffuseColor.rgb, crust, eD);
          diffuseColor.rgb = mix(diffuseColor.rgb, bc, e);
        }`);
  };
  mat.customProgramCacheKey = () => 'tyre-blood';
  return mat;
}
