import { settings } from './settings.js';
import * as THREE from 'three';
import { shadeGLSL, RAINBOW, RAINBOW_GLSL, INK_PEARL, PRISM, PRISM_GLSL, INK_FX_GLSL, inkFx, INK_T } from './inks.js';
import { PSY_GLSL, PSY_T } from './psy.js';
import { VolDry } from './dry.js';
import { rimGLSL } from './rim.js';

/*
  Stains that live IN the body surface rather than on top of it.

  Every body part owns a small 3D volume texture laid over its rest-pose shape. Each vertex of
  the part's meshes carries its rest position in that volume (`stainPos`), so a stain painted
  into the volume sticks to exactly that spot of the surface however the part moves, bends or
  skins - no decal meshes, no floating, nothing showing through.

  Channels:  R = liquid blood on the surface      G = bruise
             B = raw wound (scrape .. deep gash)   A = blood soaked into fabric

  Cloth wicks: blood soaks into the fabric shell (A) and slowly creeps outward through it,
  further downhill than up. Skin shows R as a glossy liquid film with a crisp wet edge.

  Blood dries (dry.js): over DRY_T seconds it darkens to a matte brown crust, stops coming off
  on what it touches, and is then baked out of R/A into a separate dried volume, where nothing
  can smear, wick or wipe it again.
*/

const MAXVOX = 150000;
const HOLES = 24; // bullet holes through the clothes, per volume
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const BLANK = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
BLANK.format = THREE.RGBAFormat;
BLANK.needsUpdate = true;

export class StainVol {
  /** min/max: bounds in volume space (meters). cloth: [{pos: Float32Array stainPos, index}] */
  constructor(min, max) {
    const pad = 0.012;
    this.min = min.clone().subScalar(pad);
    const size = max.clone().addScalar(pad).sub(this.min);
    const vol = size.x * size.y * size.z;
    this.vox = Math.max(0.0035, Math.cbrt(vol / MAXVOX));
    this.nx = Math.max(2, Math.ceil(size.x / this.vox));
    this.ny = Math.max(2, Math.ceil(size.y / this.vox));
    this.nz = Math.max(2, Math.ceil(size.z / this.vox));
    this.size = new THREE.Vector3(this.nx, this.ny, this.nz).multiplyScalar(this.vox);
    this.u = {
      stainVol: { value: BLANK },
      // (1 once the volume has data: until then nothing is sampled, so an empty volume reads as no
      // stain whatever a driver returns for the 1-texel placeholder)
      stainOn: { value: 0 },
      foOn: { value: 0 },
      stainMin: { value: this.min },
      stainInv: { value: new THREE.Vector3(1 / this.size.x, 1 / this.size.y, 1 / this.size.z) },
      // (what's on this body that isn't its own blood: see addForeign)
      foVol: { value: BLANK },
      // bullet holes torn through the fabric (stain space centre, radius): see hole()
      uHoles: { value: Array.from({ length: HOLES }, () => new THREE.Vector4()) },
      // (the skin that shows in a hole: the body's own skin colour - set by wounds.js)
      uHoleSkin: { value: new THREE.Color(0xd49a78) },
      // (how many of uHoles are in use: the rest are never looked at)
      uHoleN: { value: 0 },
    };
    this.holeN = 0;
    this.fo = null;
    this.data = null;
    this.cloth = [];      // cloth triangles to build the wicking mask from
    this.dirty = false;
    this.upT = 0;
    this.soakT = 0;
    this.soaking = 0;     // seconds of wicking left
    this.down = new THREE.Vector3(0, -1, 0); // world down in volume space (set by owner)
    // drying blocks of ~2.5 cm; R (film) and A (soak) are the liquid channels
    this.dry = new VolDry(this.nx, this.ny, this.nz, Math.max(2, Math.round(0.025 / this.vox)), 4, [0, 3]);
    Object.assign(this.u, this.dry.u);
  }

  alloc() {
    if (this.data) return;
    const n = this.nx * this.ny * this.nz;
    this.data = new Uint8Array(n * 4);
    this.tex = new THREE.Data3DTexture(this.data, this.nx, this.ny, this.nz);
    this.tex.format = THREE.RGBAFormat;
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.unpackAlignment = 1;
    this.tex.needsUpdate = true;
    this.u.stainVol.value = this.tex;
    this.u.stainOn.value = 1;
    // the fabric shell: voxels the cloth surface passes through (dilated by one)
    if (this.cloth.length) {
      const m = (this.mask = new Uint8Array(n));
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
      const step = this.vox * 0.7;
      for (const { pos, index } of this.cloth) {
        for (let t = 0; t < index.length; t += 3) {
          a.fromArray(pos, index[t] * 3); b.fromArray(pos, index[t + 1] * 3); c.fromArray(pos, index[t + 2] * 3);
          const k = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), a.distanceTo(c), b.distanceTo(c)) / step));
          for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
            p.copy(a).multiplyScalar(1 - (i + j) / k).addScaledVector(b, i / k).addScaledVector(c, j / k);
            const x = Math.floor((p.x - this.min.x) / this.vox), y = Math.floor((p.y - this.min.y) / this.vox), z = Math.floor((p.z - this.min.z) / this.vox);
            for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const X = x + dx, Y = y + dy, Z = z + dz;
              if (X >= 0 && Y >= 0 && Z >= 0 && X < this.nx && Y < this.ny && Z < this.nz) m[(Z * this.ny + Y) * this.nx + X] = 1;
            }
          }
        }
      }
      this.cloth = null;
    }
  }

  /** Soft spherical brush: add amt (0..1) to channel ch within radius r of volume point p. */
  add(p, r, ch, amt) {
    // (settings: blood / bruises / wound marks each switched off on their own)
    if (amt > 0) {
      if (ch === 0 || ch === 3) { if (this.bloodless || !settings.blood || !settings.bodyBlood) return; amt *= Math.min(1.6, settings.bloodAmount); if (!(amt > 0)) return; }
      else if (ch === 1) { if (!settings.bruises) return; }
      else if (ch === 2 && !settings.wounds) return;
    }
    this.alloc();
    r = Math.max(r, this.vox * 0.9);
    const v = this.vox, D = this.data;
    const x0 = Math.max(0, Math.floor((p.x - r - this.min.x) / v)), x1 = Math.min(this.nx - 1, Math.floor((p.x + r - this.min.x) / v));
    const y0 = Math.max(0, Math.floor((p.y - r - this.min.y) / v)), y1 = Math.min(this.ny - 1, Math.floor((p.y + r - this.min.y) / v));
    const z0 = Math.max(0, Math.floor((p.z - r - this.min.z) / v)), z1 = Math.min(this.nz - 1, Math.floor((p.z + r - this.min.z) / v));
    const r2 = r * r, a = amt * 255;
    const mx = this.min.x, my = this.min.y, mz = this.min.z, px = p.x, py = p.y, pz = p.z, nx = this.nx, ny = this.ny;
    for (let z = z0; z <= z1; z++) {
      const dz = mz + (z + 0.5) * v - pz;
      for (let y = y0; y <= y1; y++) {
        const dy = my + (y + 0.5) * v - py;
        // (only the voxels the sphere can reach: a row whose y, z already put it outside is skipped,
        // and each row walked just over its chord, a voxel to spare each end - every voxel still
        // passes the same exact test below, so nothing painted changes)
        const yz = dy * dy + dz * dz;
        if (yz >= r2) continue;
        const w = Math.sqrt(r2 - yz);
        const xa = Math.max(x0, Math.floor((px - w - mx) / v - 0.5) - 1), xb = Math.min(x1, Math.ceil((px + w - mx) / v - 0.5) + 1);
        let i = ((z * ny + y) * nx + xa) * 4 + ch;
        for (let x = xa; x <= xb; x++, i += 4) {
          const dx = mx + (x + 0.5) * v - px;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r2) continue;
          const f = 1 - d2 / r2;
          const nv = D[i] + a * f * f;
          D[i] = nv > 255 ? 255 : nv < 0 ? 0 : nv;
        }
      }
    }
    this.dirty = true;
    if ((ch === 0 || ch === 3) && amt > 0) this.dry.touch(x0, y0, z0, x1, y1, z1);
    if (ch === 0 && amt > 0) {
      this.soaking = Math.max(this.soaking, 6);
      this.grow(x0, y0, z0, x1, y1, z1);
    }
  }
  /** Grow the box of voxels that hold any liquid/soak (all the wicking pass has to look at). */
  grow(x0, y0, z0, x1, y1, z1) {
    const b = (this.wb ||= [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    if (x0 < b[0]) b[0] = x0; if (y0 < b[1]) b[1] = y0; if (z0 < b[2]) b[2] = z0;
    if (x1 > b[3]) b[3] = x1; if (y1 > b[4]) b[4] = y1; if (z1 > b[5]) b[5] = z1;
  }

  /**
   * Something on the body that isn't its own blood - someone else's (any colour), vomit - in a
   * second, coarser volume of its own: RGB the colour it shows (times A), A how thick it lies. Colours
   * running into each other blend by how much of each there is. col: [r, g, b] 0..1.
   */
  addForeign(p, r, col, amt) {
    if (!(amt > 0) || !settings.blood || !settings.bodyBlood) return;
    amt *= Math.min(1.6, settings.bloodAmount);
    if (!this.fo) {
      const nx = (this.fx = Math.max(2, Math.ceil(this.nx / 2))), ny = (this.fy = Math.max(2, Math.ceil(this.ny / 2))), nz = (this.fz = Math.max(2, Math.ceil(this.nz / 2)));
      this.fo = new Uint8Array(nx * ny * nz * 4);
      this.foTex = new THREE.Data3DTexture(this.fo, nx, ny, nz);
      this.foTex.format = THREE.RGBAFormat;
      this.foTex.minFilter = this.foTex.magFilter = THREE.LinearFilter;
      this.foTex.unpackAlignment = 1;
      this.foTex.needsUpdate = true;
      this.u.foVol.value = this.foTex;
      this.u.foOn.value = 1;
      // (a texel of this one spans two of the main volume's: the same box, half as fine)
      this.fvox = [this.size.x / nx, this.size.y / ny, this.size.z / nz];
    }
    const [vx, vy, vz] = this.fvox, D = this.fo, nx = this.fx, ny = this.fy, nz = this.fz;
    r = Math.max(r, Math.max(vx, vy, vz) * 0.9);
    const x0 = Math.max(0, Math.floor((p.x - r - this.min.x) / vx)), x1 = Math.min(nx - 1, Math.floor((p.x + r - this.min.x) / vx));
    const y0 = Math.max(0, Math.floor((p.y - r - this.min.y) / vy)), y1 = Math.min(ny - 1, Math.floor((p.y + r - this.min.y) / vy));
    const z0 = Math.max(0, Math.floor((p.z - r - this.min.z) / vz)), z1 = Math.min(nz - 1, Math.floor((p.z + r - this.min.z) / vz));
    const r2 = r * r, R = col[0] * 255, G = col[1] * 255, B = col[2] * 255;
    for (let z = z0; z <= z1; z++) {
      const dz = this.min.z + (z + 0.5) * vz - p.z;
      for (let y = y0; y <= y1; y++) {
        const dy = this.min.y + (y + 0.5) * vy - p.y;
        let i = ((z * ny + y) * nx + x0) * 4;
        for (let x = x0; x <= x1; x++, i += 4) {
          const dx = this.min.x + (x + 0.5) * vx - p.x;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r2) continue;
          // (stored premultiplied - colour x thickness - so it filters cleanly into bare skin)
          const f = 1 - d2 / r2, w = amt * f * f * 255, a = D[i + 3];
          const na = Math.min(255, a + w), t = w / (a + w), k = na / 255, ia = a > 0 ? 255 / a : 0;
          D[i] = (D[i] * ia + (R - D[i] * ia) * t) * k;
          D[i + 1] = (D[i + 1] * ia + (G - D[i + 1] * ia) * t) * k;
          D[i + 2] = (D[i + 2] * ia + (B - D[i + 2] * ia) * t) * k;
          D[i + 3] = na;
        }
      }
    }
    this.foDirty = true;
  }

  /**
   * Rubbed against the ground: blood (film, soak, someone else's) comes off within radius r of
   * volume point p - wet or dried, a little more each rub, so a body dragged along long enough
   * ends up clean there. amt: 0..1 of a full stain taken per call. Wounds and bruises stay.
   */
  wipe(p, r, amt) {
    if (!(amt > 0)) return;
    if (this.data) {
      const v = this.vox, D = this.data, nx = this.nx, ny = this.ny;
      r = Math.max(r, v * 0.9);
      const x0 = Math.max(0, Math.floor((p.x - r - this.min.x) / v)), x1 = Math.min(nx - 1, Math.floor((p.x + r - this.min.x) / v));
      const y0 = Math.max(0, Math.floor((p.y - r - this.min.y) / v)), y1 = Math.min(ny - 1, Math.floor((p.y + r - this.min.y) / v));
      const z0 = Math.max(0, Math.floor((p.z - r - this.min.z) / v)), z1 = Math.min(this.nz - 1, Math.floor((p.z + r - this.min.z) / v));
      const r2 = r * r, a = amt * 255;
      let hit = false;
      for (let z = z0; z <= z1; z++) {
        const dz = this.min.z + (z + 0.5) * v - p.z;
        for (let y = y0; y <= y1; y++) {
          const dy = this.min.y + (y + 0.5) * v - p.y;
          let i = ((z * ny + y) * nx + x0) * 4;
          for (let x = x0; x <= x1; x++, i += 4) {
            if (!D[i] && !D[i + 3]) continue;
            const dx = this.min.x + (x + 0.5) * v - p.x;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r2) continue;
            const k = a * (1 - d2 / r2) + 1;
            D[i] = D[i] > k ? D[i] - k : 0;
            D[i + 3] = D[i + 3] > k ? D[i + 3] - k : 0;
            hit = true;
          }
        }
      }
      if (hit) this.dirty = true;
    }
    if (this.fo) {
      const [vx, vy, vz] = this.fvox, D = this.fo, nx = this.fx, ny = this.fy, nz = this.fz;
      const R = Math.max(r, Math.max(vx, vy, vz) * 0.9), r2 = R * R, a = amt * 255;
      const x0 = Math.max(0, Math.floor((p.x - R - this.min.x) / vx)), x1 = Math.min(nx - 1, Math.floor((p.x + R - this.min.x) / vx));
      const y0 = Math.max(0, Math.floor((p.y - R - this.min.y) / vy)), y1 = Math.min(ny - 1, Math.floor((p.y + R - this.min.y) / vy));
      const z0 = Math.max(0, Math.floor((p.z - R - this.min.z) / vz)), z1 = Math.min(nz - 1, Math.floor((p.z + R - this.min.z) / vz));
      let hit = false;
      for (let z = z0; z <= z1; z++) {
        const dz = this.min.z + (z + 0.5) * vz - p.z;
        for (let y = y0; y <= y1; y++) {
          const dy = this.min.y + (y + 0.5) * vy - p.y;
          let i = ((z * ny + y) * nx + x0) * 4;
          for (let x = x0; x <= x1; x++, i += 4) {
            const al = D[i + 3];
            if (!al) continue;
            const dx = this.min.x + (x + 0.5) * vx - p.x;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r2) continue;
            // (premultiplied: the colour thins with the thickness)
            const na = Math.max(0, al - (a * (1 - d2 / r2) + 1)), s = na / al;
            D[i] *= s; D[i + 1] *= s; D[i + 2] *= s; D[i + 3] = na;
            hit = true;
          }
        }
      }
      if (hit) this.foDirty = true;
    }
  }

  /** A line of brush dabs from a to b (volume space). */
  line(a, b, r, ch, amt) {
    r = Math.max(r, this.vox * 0.9);
    const len = a.distanceTo(b);
    const step = r * 0.5;
    const n = Math.max(1, Math.ceil(len / step));
    // overlapping dabs: scale so a long stroke peaks near amt instead of piling up
    const per = n > 1 ? amt * 0.45 : amt;
    const p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) this.add(p.lerpVectors(a, b, i / n), r, ch, per);
  }

  /** Channel value (0..1) at volume point p (nearest voxel). Liquid channels: only what is still wet. */
  sample(p, ch) {
    if (!this.data) return 0;
    const x = Math.floor((p.x - this.min.x) / this.vox), y = Math.floor((p.y - this.min.y) / this.vox), z = Math.floor((p.z - this.min.z) / this.vox);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    const v = this.data[((z * this.ny + y) * this.nx + x) * 4 + ch] / 255;
    // drying blood gets tacky: less and less of it comes away
    return ch === 0 || ch === 3 ? v * (1 - this.dry.dryness(x, y, z)) : v;
  }

  /** Wipe the blood only (wet, soaked, dried and anyone else's) - wounds and bruises stay. */
  clearBlood() {
    if (this.data) {
      const D = this.data;
      for (let i = 0; i < D.length; i += 4) { D[i] = 0; D[i + 3] = 0; }
      this.tex.needsUpdate = true;
    }
    if (this.fo) { this.fo.fill(0); this.foTex.needsUpdate = true; }
    this.soaking = 0;
    this.dirty = false;
    this.wb = null;
    this.dry.clear();
  }

  /**
   * A hole torn through the fabric at stain point sp, radius r (m): the clothes are simply gone
   * there and the skin underneath shows. Full: it merges into whichever hole is nearest.
   */
  hole(sp, r) {
    const H = this.u.uHoles.value;
    if (this.holeN < H.length) { H[this.holeN++].set(sp.x, sp.y, sp.z, r); this.u.uHoleN.value = this.holeN; return; }
    let best = H[0], bd = Infinity;
    for (const h of H) { const d = (h.x - sp.x) ** 2 + (h.y - sp.y) ** 2 + (h.z - sp.z) ** 2; if (d < bd) { bd = d; best = h; } }
    const d = Math.sqrt(bd);
    best.set((best.x + sp.x) / 2, (best.y + sp.y) / 2, (best.z + sp.z) / 2, Math.min(0.06, d / 2 + Math.max(best.w, r)));
  }

  /** Wipe everything (respawn). */
  clear() {
    for (const h of this.u.uHoles.value) h.set(0, 0, 0, 0);
    this.holeN = 0;
    this.u.uHoleN.value = 0;
    if (this.data) { this.data.fill(0); this.tex.needsUpdate = true; }
    if (this.fo) { this.fo.fill(0); this.foTex.needsUpdate = true; }
    this.soaking = 0;
    this.dirty = false;
    this.wb = null;
    this.dry.clear();
  }

  /** Fabric wicking: soaked blood creeps outward through the cloth shell, mostly downhill. */
  soak() {
    const D = this.data, M = this.mask, B = this.wb;
    if (!D || !M || !B) return;
    const nx = this.nx, ny = this.ny, nz = this.nz, n = nx * ny * nz;
    // everything outside the wet box is dry: only walk the box (plus the one voxel it can
    // spread into this pass). Same result as a full pass, a fraction of the voxels.
    const x0 = Math.max(1, B[0] - 1), y0 = Math.max(1, B[1] - 1), z0 = Math.max(1, B[2] - 1);
    const x1 = Math.min(nx - 2, B[3] + 1), y1 = Math.min(ny - 2, B[4] + 1), z1 = Math.min(nz - 2, B[5] + 1);
    if (x0 > x1 || y0 > y1 || z0 > z1) { this.soaking = 0; return; }
    const A = (this._a ||= new Uint8Array(n));
    // snapshot the soak channel over the box and its 1-voxel rim (the neighbours we read)
    for (let z = z0 - 1; z <= z1 + 1; z++) for (let y = y0 - 1; y <= y1 + 1; y++) {
      let i = (z * ny + y) * nx + x0 - 1;
      for (let x = x0 - 1; x <= x1 + 1; x++, i++) A[i] = D[i * 4 + 3];
    }
    // receive factor from each of the 6 neighbours: blood flows toward "down"
    const d = this.down;
    const k = (g) => clamp(0.8 - 0.16 * g, 0.62, 0.95);
    // (the six neighbours written out, in the same order: +x -x +y -y +z -z)
    const nxy = nx * ny;
    const K0 = k(d.x), K1 = k(-d.x), K2 = k(d.y), K3 = k(-d.y), K4 = k(d.z), K5 = k(-d.z);
    let changed = false;
    let bx0 = x1, by0 = y1, bz0 = z1, bx1 = x0, by1 = y0, bz1 = z0;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
      let i = (z * ny + y) * nx + x0;
      for (let x = x0; x <= x1; x++, i++) {
        if (!M[i]) continue;
        const R = D[i * 4];
        let best = Math.max(A[i], R * 0.95), v;
        if (M[i + 1]) { v = A[i + 1] * K0 - 3; if (v > best) best = v; }
        if (M[i - 1]) { v = A[i - 1] * K1 - 3; if (v > best) best = v; }
        if (M[i + nx]) { v = A[i + nx] * K2 - 3; if (v > best) best = v; }
        if (M[i - nx]) { v = A[i - nx] * K3 - 3; if (v > best) best = v; }
        if (M[i + nxy]) { v = A[i + nxy] * K4 - 3; if (v > best) best = v; }
        if (M[i - nxy]) { v = A[i - nxy] * K5 - 3; if (v > best) best = v; }
        if (best > A[i] + 0.5) {
          D[i * 4 + 3] = best; changed = true;
          this.dry.seep(x, y, z);
          if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (z < bz0) bz0 = z;
          if (x > bx1) bx1 = x; if (y > by1) by1 = y; if (z > bz1) bz1 = z;
        }
      }
    }
    if (changed) { this.dirty = true; this.grow(bx0, by0, bz0, bx1, by1, bz1); }
    else this.soaking = 0;
  }

  update(dt, budget) {
    if (this.dry.update(dt, this.data)) this.dirty = true;
    this.dry.upload(budget);
    this.upT -= dt;
    if (this.mask && this.soaking > 0) {
      this.soaking -= dt;
      this.soakT -= dt;
      if (this.soakT <= 0) { this.soakT = 0.12; this.soak(); }
    }
    if (this.foDirty && this.upT <= 0 && budget.n > 0) {
      this.foTex.needsUpdate = true;
      this.foDirty = false;
      this.upT = 1 / 20;
      budget.n--;
    }
    if (this.dirty && this.upT <= 0 && budget.n > 0) {
      this.tex.needsUpdate = true;
      this.dirty = false;
      this.upT = 1 / 20;
      budget.n--;
    }
  }
}


/** Swap a mesh's material for a stainable clone reading `vol` (ink: the body's blood colour, inks.js). */
export function stainMaterial(base, vol, cloth, ink = 0) {
  const mat = base.clone();
  // (the same Color as the base: the wardrobe, the FUN menu and pallor recolour M.top / M.skin...
  // and every stained copy of it follows)
  mat.color = base.color;
  // (psy.js: a living fractal skin, hue offset userData.psy; rainbow blood, inks.js)
  const psy = typeof base.userData.psy === 'number' ? base.userData.psy : null;
  const rain = ink === RAINBOW, prism = ink === PRISM, fx = inkFx(ink);
  // (a two-tone shirt, costumes.js: the right half - x < 0 in the body's own frame - this colour)
  const split = typeof base.userData.split === 'number' ? new THREE.Color(base.userData.split) : null;
  // (rim.js: a colour its edges shade off into)
  const rim = Array.isArray(base.userData.rim) ? base.userData.rim : null;
  // (character.js: the face's tint - lips, nostrils, cheeks - a per-vertex attribute; 0 elsewhere)
  const tint = !!base.userData.tint;
  if (tint) mat.defaultAttributeValues = { ...(mat.defaultAttributeValues || {}), tint: [0, 0, 0] };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, vol.u);
    if (psy !== null) sh.uniforms.uPsyT = PSY_T;
    if (fx) sh.uniforms.uInkT = INK_T;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 stainPos;\nuniform vec3 stainMin;\nuniform vec3 stainInv;\nvarying vec3 vStainUvw;\nvarying vec3 vStainP;' + (tint ? '\nattribute vec3 tint;\nvarying vec3 vTint;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStainUvw = (stainPos - stainMin) * stainInv;\nvStainP = stainPos;' + (tint ? '\nvTint = tint;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform highp sampler3D stainVol, dryVol, ageVol, foVol;\nuniform float stainOn, foOn;\nuniform vec3 ageScale;\nvarying vec3 vStainUvw;\nvarying vec3 vStainP;${tint ? '\nvarying vec3 vTint;' : ''}${cloth ? `\nuniform vec4 uHoles[${HOLES}];\nuniform vec3 uHoleSkin;\nuniform float uHoleN;` : ''}
        float bloodRelief = 0.0;
        vec3 perturbBloodNormal(vec3 surfPos, vec3 surfNorm, vec2 heightGrad) {
          vec3 sigmaX = dFdx(surfPos), sigmaY = dFdy(surfPos);
          vec3 r1 = cross(sigmaY, surfNorm), r2 = cross(surfNorm, sigmaX);
          float det = dot(sigmaX, r1);
          vec3 grad = sign(det) * (heightGrad.x * r1 + heightGrad.y * r2);
          return normalize(abs(det) * surfNorm - grad);
        }
        ${psy !== null ? PSY_GLSL : ''}
        ${rain ? RAINBOW_GLSL : ''}
        ${prism ? PRISM_GLSL : ''}
        ${fx ? INK_FX_GLSL : ''}`)
      .replace('#include <map_fragment>', shadeGLSL(`#include <map_fragment>
        ${tint ? 'diffuseColor.rgb *= max(vec3(0.0), 1.0 + vTint);' : ''}
        ${psy !== null ? `diffuseColor.rgb = psyCol(vStainP, uPsyT, ${psy.toFixed(3)});` : ''}
        ${split ? `if (vStainP.x < 0.0) diffuseColor.rgb = vec3(${split.r.toFixed(4)}, ${split.g.toFixed(4)}, ${split.b.toFixed(4)});` : ''}
        vec4 st = stainOn > 0.5 ? texture(stainVol, vStainUvw) : vec4(0.0);
        vec2 sd = stainOn > 0.5 ? texture(dryVol, vStainUvw).rg : vec2(0.0);   // baked, dried blood: film, soak
        float age = smoothstep(0.0, 1.0, texture(ageVol, vStainUvw * ageScale).r);
        float stainWet = 0.0, stainCover = 0.0;
        ${cloth ? `
        // bullet holes: the fabric torn away (a ragged edge), singed and frayed dark round it
        // In the hole: the skin underneath, wounded (the fabric IS the body's surface there - there's
        // nothing under it to show - so the hole is drawn as skin, never cut out of the body).
        // (straight-line code, no branching or discard inside the loop: some GPU drivers - ANGLE
        // on Direct3D - fail to compile a discard / continue in a loop, and then every piece of
        // clothing, the shirt and shorts that ARE the torso, simply doesn't draw)
        float holeRim = 0.0, holeCut = 0.0, holeIn = 0.0;
        for (int hi = 0; hi < ${HOLES}; hi++) {
          vec4 H = uHoles[hi];
          vec3 hd = vStainP - H.xyz;
          float hr = length(hd);
          vec3 hn = hd / max(hr, 1e-4);
          // (only the slots in use; epsilons that survive mediump - 1e-6 flushes to 0 there, and an
          // empty all-zero slot then reads as a hole over the whole garment)
          float on = step(float(hi) + 0.5, uHoleN) * step(1e-4, H.w);
          float jag = H.w * (0.78 + 0.22 * sin(hn.x * 23.0 + hn.y * 17.0) * cos(hn.z * 19.0 - hn.y * 11.0));
          float inside = on * (1.0 - step(jag, hr));
          holeCut = max(holeCut, inside);
          holeIn = max(holeIn, inside * clamp(1.0 - hr / max(jag, 1e-4), 0.0, 1.0));
          holeRim = max(holeRim, on * (1.0 - smoothstep(jag, H.w * 1.9 + 1e-4, hr)));
        }
        // fabric: blood soaks in - fuzzy edge, darker and browner where it's heavy; drying, it
        // goes a stiff matte brown-black
        float s = max(st.a, st.r), sD = max(sd.g, sd.r);
        float e = smoothstep(0.05, 0.3, s), eD = smoothstep(0.05, 0.3, sD);
        vec3 wetCol = mix(vec3(0.34, 0.03, 0.035), vec3(0.13, 0.008, 0.012), smoothstep(0.35, 1.0, s));
        vec3 dryCol = mix(vec3(0.17, 0.035, 0.025), vec3(0.075, 0.016, 0.012), smoothstep(0.35, 1.0, max(s, sD)));
        wetCol = mix(wetCol, dryCol, age);
        vec3 dCol = mix(vec3(0.17, 0.035, 0.025), vec3(0.075, 0.016, 0.012), smoothstep(0.35, 1.0, sD));
        vec3 base = diffuseColor.rgb;
        // the dye still shows faintly through a light stain
        wetCol = mix(wetCol, wetCol * (0.6 + base), 0.35 * (1.0 - smoothstep(0.3, 0.8, s)));
        dCol = mix(dCol, dCol * (0.6 + base), 0.3 * (1.0 - smoothstep(0.3, 0.8, sD)));
        diffuseColor.rgb = mix(base, dCol, eD * 0.94);
        diffuseColor.rgb = mix(diffuseColor.rgb, wetCol, e * 0.94);
        // soaked fabric around the stain is darker too
        diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.02, 0.12, max(s, sD)) * (1.0 - max(e, eD));
        diffuseColor.rgb *= 1.0 - 0.7 * holeRim * holeRim * (1.0 - holeCut);
        // skin at the torn edge (a little bruised), the wound raw red, a dark wet hole in the middle
        vec3 holeCol = mix(uHoleSkin * vec3(0.85, 0.7, 0.68), vec3(0.42, 0.04, 0.05), smoothstep(0.25, 0.55, holeIn));
        holeCol = mix(holeCol, vec3(0.05, 0.0, 0.004), smoothstep(0.6, 0.8, holeIn));
        diffuseColor.rgb = mix(diffuseColor.rgb, holeCol, holeCut);
        stainWet = e * smoothstep(0.2, 0.9, st.r) * (1.0 - age);
        stainWet = max(stainWet, holeCut * 0.7 * smoothstep(0.25, 0.55, holeIn));
        stainCover = max(e, eD);
        ` : `
        // bruise: dull purple under the skin
        float br = smoothstep(0.04, 0.7, st.g);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.56, 0.36, 0.52), br * 0.85);
        // raw wound: scraped pink-red, deep gash nearly black
        float wr = smoothstep(0.12, 0.35, st.b);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.07, 0.07), wr * 0.8);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.0, 0.004), smoothstep(0.55, 0.85, st.b));
        // dried crust under any fresh film
        float eD = smoothstep(0.13, 0.2, sd.r);
        vec3 dc = mix(vec3(0.19, 0.035, 0.024), vec3(0.085, 0.014, 0.01), smoothstep(0.25, 0.95, sd.r));
        diffuseColor.rgb = mix(diffuseColor.rgb, dc, eD);
        // liquid blood film with a crisp wet edge, browning as it dries
        float e = smoothstep(0.13, 0.2, st.r);
        vec3 bc = mix(vec3(0.46, 0.018, 0.026), vec3(0.2, 0.006, 0.01), smoothstep(0.25, 0.95, st.r));
        bc *= 1.0 - 0.18 * (1.0 - age) * (1.0 - smoothstep(0.13, 0.26, st.r));
        bc = mix(bc, mix(vec3(0.19, 0.035, 0.024), vec3(0.085, 0.014, 0.01), smoothstep(0.25, 0.95, st.r)), age);
        diffuseColor.rgb = mix(diffuseColor.rgb, bc, e);
        stainWet = max(e * (1.0 - age), wr * 0.5);
        stainCover = max(max(e, eD), wr * 0.8);
        bloodRelief = smoothstep(0.13, 0.95, st.r) * (1.0 - age) * 0.006;
        `}`, ink) + (rain ? `
        // rainbow blood: whatever came out magenta (the ink's marker) goes pearly rainbow
        {
          vec3 k = diffuseColor.rgb;
          float mg = clamp((min(k.r, k.b) - k.g) * 6.0, 0.0, 1.0) * stainCover;
          float rDry = mix(1.0, age, clamp(stainWet * 2.0, 0.0, 1.0));
          #ifndef FLAT_SHADED
          float rPearl = ${INK_PEARL};
          #else
          float rPearl = 0.3;
          #endif
          vec3 rc = inkRainbowCol(vec3(max(k.r, k.b) - k.g, k.g, 0.0), vStainP * 3.0, rDry, rPearl);
          diffuseColor.rgb = mix(k, rc, mg);
        }` : '') + (prism ? `
        // prism blood: whatever came out cyan (the marker) takes the colour of its spot - one
        // random hue per wound-sized patch - going round the wheel as it dries; fresh, it glows
        vec3 prGlow = vec3(0.0);
        {
          vec3 k = diffuseColor.rgb;
          float cy = clamp((min(k.g, k.b) - k.r) / max(max(k.g, k.b), 1e-3) * 3.0, 0.0, 1.0) * stainCover;
          if (cy > 0.0) {
            float pDry = age;
            vec3 pc = inkPrismCol(vec3(min(k.g, k.b) - k.r, k.r, 0.0), prismCell(vStainP, 0.14), pDry);
            diffuseColor.rgb = mix(k, pc, cy);
            prGlow = pc * cy * 0.35 * (1.0 - pDry);
          }
        }` : '') + (fx ? `
        // seek / galaxy / matrix blood (inks.js): all the blood on this body is drawn as it
        if (stainCover > 0.01) {
          float fxThick = smoothstep(0.15, 0.9, max(st.r, sd.r));
          float fxDry = mix(1.0, age, clamp(stainWet * 2.0 + 0.3, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, ${fx === 'seek' ? 'seekCol' : fx === 'matrix' ? 'matrixCol' : 'galaxyCol'}(vStainP, fxThick, fxDry * 0.5, 0.0), stainCover * 0.96);
        }` : '') + `
        // what isn't this body's own (StainVol.addForeign): someone else's blood, vomit - in its
        // own colour, darker where it's thick; soaked into cloth it's fuzzier and duller
        {
          vec4 fo = foOn > 0.5 ? texture(foVol, vStainUvw) : vec4(0.0);
          float fe = smoothstep(${cloth ? '0.04, 0.25' : '0.1, 0.22'}, fo.a);
          if (fe > 0.001) {
            vec3 fc = fo.rgb / max(fo.a, 1e-3) * mix(1.0, 0.62, smoothstep(0.3, 1.0, fo.a));
            ${cloth ? 'fc = mix(fc, fc * (0.6 + diffuseColor.rgb), 0.3) * 0.85;' : ''}
            diffuseColor.rgb = mix(diffuseColor.rgb, fc, fe * 0.95);
            stainWet = max(stainWet, fe * ${cloth ? '0.4' : '0.85'});
            stainCover = max(stainCover, fe);
            ${cloth ? '' : 'bloodRelief = max(bloodRelief, fe * 0.005);'}
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, ${cloth ? '0.36' : '0.08'}, stainWet);
        ${rain || prism ? 'roughnessFactor = mix(roughnessFactor, 0.12, stainCover * 0.8);' : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${cloth ? '' : 'normal = perturbBloodNormal(-vViewPosition, normal, vec2(dFdx(bloodRelief), dFdy(bloodRelief)));'}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${psy !== null ? 'totalEmissiveRadiance += diffuseColor.rgb * (0.05 + 0.45 * psyGlow) * (1.0 - stainCover);' : ''}
        ${prism ? 'totalEmissiveRadiance += prGlow;' : ''}`)
      // (blood over a metal skin - gold - is not metal)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n        metalnessFactor *= 1.0 - stainCover;');
    if (rim) sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', rimGLSL(rim[0], rim[1]));
  };
  mat.customProgramCacheKey = () => (cloth ? 'stain-cloth' : 'stain-skin') + '-' + ink + (psy !== null ? '-psy' + psy : '') + (split ? '-split' + split.getHexString() : '') + (rim ? '-rim' + rim.join('_') : '') + (tint ? '-tint' : '');
  return mat;
}
