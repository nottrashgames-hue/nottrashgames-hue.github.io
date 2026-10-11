import * as THREE from 'three';

/*
  Drying for blood painted INTO a 3D volume (bodies: stain.js, cars: carstain.js) - the same
  rule the floor follows (bloodsurf.js).

  The volume is split into blocks of B^3 voxels; each block remembers when fresh blood last
  reached it. A small age volume (0 fresh .. 1 dry, one texel per block) lets the shader darken
  the blood to a matte brown-black as it ages. Once a block is fully dry it is baked: its liquid
  channels are copied into a separate dried volume and cleared from the live one, so nothing
  can smear, wick, pick up or wipe it any more. Fresh blood lands on top.
*/

export const DRY_T = 30;   // s until blood is dry and baked
const AGE_DT = 0.5;        // s between drying passes
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let BLANK = null;
const blank = () => {
  if (!BLANK) { BLANK = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1); BLANK.format = THREE.RedFormat; BLANK.needsUpdate = true; }
  return BLANK;
};

export class VolDry {
  /**
   * nx,ny,nz: live volume size in voxels; B: block edge in voxels;
   * stride: bytes per live voxel; chans: live channels that hold liquid blood (each gets its own
   * channel in the dried volume, in order).
   */
  constructor(nx, ny, nz, B, stride, chans) {
    this.nx = nx; this.ny = ny; this.nz = nz; this.B = B; this.stride = stride; this.chans = chans;
    this.bx = Math.ceil(nx / B); this.by = Math.ceil(ny / B); this.bz = Math.ceil(nz / B);
    const nb = this.bx * this.by * this.bz;
    this.bt = new Float32Array(nb).fill(-1);
    this.live = 0;
    this.time = 0;
    this.ageT = 0;
    this.ageData = new Uint8Array(nb);
    this.ageTex = new THREE.Data3DTexture(this.ageData, this.bx, this.by, this.bz);
    this.ageTex.format = THREE.RedFormat;
    this.ageTex.minFilter = this.ageTex.magFilter = THREE.LinearFilter;
    this.ageTex.unpackAlignment = 1;
    this.ageTex.needsUpdate = true;
    this.dry = null; this.dryTex = null;
    this.dryDirty = false;
    this.u = {
      dryVol: { value: blank() },
      ageVol: { value: this.ageTex },
      // live uvw -> age uvw (the block grid overhangs the volume)
      ageScale: { value: new THREE.Vector3(nx / (this.bx * B), ny / (this.by * B), nz / (this.bz * B)) },
    };
  }

  /** Fresh blood reached voxels x0..x1, y0..y1, z0..z1: those blocks start drying again. */
  touch(x0, y0, z0, x1, y1, z1) {
    const B = this.B;
    const i0 = Math.max(0, Math.floor(x0 / B)), i1 = Math.min(this.bx - 1, Math.floor(x1 / B));
    const j0 = Math.max(0, Math.floor(y0 / B)), j1 = Math.min(this.by - 1, Math.floor(y1 / B));
    const k0 = Math.max(0, Math.floor(z0 / B)), k1 = Math.min(this.bz - 1, Math.floor(z1 / B));
    let changed = false;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
      let b = (k * this.by + j) * this.bx + i0;
      for (let i = i0; i <= i1; i++, b++) {
        if (this.bt[b] < 0) this.live++;
        this.bt[b] = this.time;
        if (this.ageData[b]) { this.ageData[b] = 0; changed = true; }
      }
    }
    if (changed) this.ageTex.needsUpdate = true;
  }
  /** Blood crept (wicked, ran) into voxel x,y,z: start its block drying if it had nothing wet. */
  seep(x, y, z) {
    const b = (Math.floor(z / this.B) * this.by + Math.floor(y / this.B)) * this.bx + Math.floor(x / this.B);
    if (this.bt[b] < 0) { this.bt[b] = this.time; this.live++; }
  }
  /** 0 (fresh) .. 1 (dry) at voxel x,y,z. */
  dryness(x, y, z) {
    const b = this.bt[(Math.floor(z / this.B) * this.by + Math.floor(y / this.B)) * this.bx + Math.floor(x / this.B)];
    return b < 0 ? 1 : clamp((this.time - b) / DRY_T, 0, 1);
  }

  /** Advance the clock; every AGE_DT age the wet blocks and bake the dry ones. True if `data` changed. */
  update(dt, data) {
    this.time += dt;
    if (!this.live || (this.ageT += dt) < AGE_DT) return false;
    this.ageT = 0;
    let baked = false;
    for (let b = 0; b < this.bt.length; b++) {
      const t = this.bt[b];
      if (t < 0) continue;
      const a = (this.time - t) / DRY_T;
      if (a >= 1) { this.bake(b, data); this.ageData[b] = 0; baked = true; }
      else this.ageData[b] = Math.round(a * 255);
    }
    this.ageTex.needsUpdate = true;
    return baked;
  }

  bake(b, D) {
    this.bt[b] = -1;
    this.live--;
    const nc = this.chans.length;
    const B = this.B, bi = b % this.bx, bj = Math.floor(b / this.bx) % this.by, bk = Math.floor(b / (this.bx * this.by));
    const x0 = bi * B, x1 = Math.min(this.nx, x0 + B);
    const y0 = bj * B, y1 = Math.min(this.ny, y0 + B);
    const z0 = bk * B, z1 = Math.min(this.nz, z0 + B);
    // after DRY_T the stain is gone (not kept as dried blood)
    const st = this.stride, C = this.chans;
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) {
      let v = (z * this.ny + y) * this.nx + x0;
      for (let x = x0; x < x1; x++, v++) {
        for (let c = 0; c < nc; c++) D[v * st + C[c]] = 0;
      }
    }
  }

  /** Upload the dried volume if it changed (costs one of the frame's uploads). */
  upload(budget) {
    if (this.dryDirty && budget.n > 0) { this.dryTex.needsUpdate = true; this.dryDirty = false; budget.n--; }
  }

  clear() {
    this.bt.fill(-1);
    this.live = 0;
    this.ageData.fill(0);
    this.ageTex.needsUpdate = true;
    if (this.dry) { this.dry.fill(0); this.dryTex.needsUpdate = true; }
    this.dryDirty = false;
  }
}
