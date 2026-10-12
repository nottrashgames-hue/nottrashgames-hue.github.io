import { settings } from './settings.js';
import * as THREE from 'three';
import { StainVol, stainMaterial } from './stain.js';
import { DRY_T } from './dry.js';
import { inkOf, inkMat, noInk, rollPrism, inkFilm, isVomit } from './inks.js';
import { dentMeshes, undent, fallDent, crunch } from './dent.js';
import { freshMatrices } from './slice.js';

/*
  Injuries on one character, painted INTO the body surface (see stain.js), so every mark sits
  exactly on the skin or fabric it landed on and rides it through any pose:
    - impacts (momentum change of a part while touching the level) -> bruise, then cut + spray
    - sliding contact -> scrapes along the direction of the slide
    - bleeding wounds well up around themselves; clothes soak it up and wick it outward
    - drips crawl downhill over the actual surface (re-found every frame on the posed mesh) and
      fall off undersides as drops; on fabric they soak in instead of running
    - wherever the surface actually touches the floor it picks fresh blood up, and lays down
      the blood that is on that very spot as a smear when it drags; feet print shoe tracks
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const G = 9.81;
const DOWN = V(0, -1, 0);

// approximate contact radius per part kind
const RADIUS = { pelvis: 0.1, spine: 0.1, chest: 0.11, head: 0.1, thigh: 0.07, shin: 0.05, foot: 0.04, upper: 0.045, fore: 0.04 };
const TOUCH = 0.014;   // a surface point this close to the floor is in contact
const SPACING = 0.024; // rough spacing of contact sample points

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _a = V(), _b = V(), _c = V(), _w = V(), _n = V();
const _A = V(), _B = V(), _C = V(), _bary = V(), _tri = new THREE.Triangle();
const ray = new THREE.Raycaster();

const TORSO = ['pelvis', 'spine', 'chest'];
const TORSO_C = { pelvis: V(0, -0.03, 0), spine: V(0, 0.1, 0), chest: V(0, 0.13, 0) };

let BEAD_GEO = null;
/** A wardrobe variant (sleeve, trouser leg, hairstyle) that isn't being worn right now. */
const shown = (m) => !m.userData.wardrobe || m.visible;

// how hard a round-cut artery jets out of the wounds
const ARTERY_JET = { femoral: 1.3, carotid: 1.4, brachial: 0.9, iliac: 0.8, aorta: 0.6, popliteal: 0.8 };

export class Wounds {
  constructor(actor, sys) {
    this.actor = actor;
    this.sys = sys;
    this.floor = sys.floor;
    const h = actor.hero;
    h.root.updateMatrixWorld(true);
    for (const g of Object.values(actor.groups)) g.updateWorldMatrix(true, true);
    const CLOTH = new Set([h.mat.top, h.mat.shorts, h.mat.hair]);

    // meshes that belong to each physical part (stop at the next part's group)
    const groupSet = new Set(Object.values(actor.groups));
    this.dry = noInk(inkOf(actor)); // a body with no blood in it (special.js)
    this.parts = {};
    for (const [name, grp] of Object.entries(actor.groups)) {
      const meshes = [];
      const walk = (o) => {
        for (const c of o.children) {
          if (groupSet.has(c)) continue;
          if (c.isMesh && !c.userData.decal) meshes.push(c);
          walk(c);
        }
      };
      walk(grp);
      this.parts[name] = {
        name, kind: name.replace(/[LR]$/, ''), group: grp, meshes,
        lastV: null, wet: 0, cool: 0, slide: 0, dmg: 0,
      };
    }
    // the torso is skinned meshes on the root (shorts, shirt): they belong to pelvis/spine/chest
    this.skinned = h.root.children.filter((c) => c.isSkinnedMesh && !c.userData.decal);
    const sk = this.skinned[0];

    // ---- one stain volume per rigid part; the torso shares one in its bind space ----
    this.vols = [];
    const build = (names, meshes, group) => {
      const entries = [];
      const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
      for (const m of meshes) {
        if (!m.isSkinnedMesh) m.geometry = m.geometry.clone(); // shared geometries get their own stain coords
        const g = m.geometry, pos = g.attributes.position;
        const sp = new Float32Array(pos.count * 3);
        let M = null;
        if (!m.isSkinnedMesh) {
          // mesh -> its part group, and for the torso on into the skinned mesh's bind space
          const owner = ownerOf(m, names.map((n) => this.parts[n].group), names);
          const grp = this.parts[owner].group;
          M = new THREE.Matrix4().copy(grp.matrixWorld).invert().multiply(m.matrixWorld);
          if (sk && TORSO.includes(owner)) {
            const bi = TORSO.indexOf(owner);
            M.premultiply(_m4.copy(sk.skeleton.boneInverses[bi]).invert()).premultiply(sk.bindMatrixInverse);
          }
        }
        for (let i = 0; i < pos.count; i++) {
          _a.fromBufferAttribute(pos, i);
          if (M) _a.applyMatrix4(M);
          _a.toArray(sp, i * 3);
          lo.min(_a); hi.max(_a);
        }
        g.setAttribute('stainPos', new THREE.BufferAttribute(sp, 3));
        entries.push({ m, sp, cloth: CLOTH.has(m.material) || !!m.material.userData.cloth });
      }
      const vol = new StainVol(lo, hi);
      vol.bloodless = noInk(inkOf(actor)); // (bruises and cuts still show; never any blood)
      const samples = [];
      for (const e of entries) {
        const count = e.sp.length / 3;
        if (e.cloth) vol.cloth.push({ pos: e.sp, index: e.m.geometry.index ? e.m.geometry.index.array : [...Array(count).keys()] });
        e.m.material = stainMaterial(e.m.material, vol, e.cloth, inkOf(actor));
        e.m.userData.stain = { vol, cloth: e.cloth };
        // contact samples (small bits like eyes don't touch the floor)
        if (count < 60) continue;
        for (let i = 0; i < count; i += 3) {
          const s = V().fromArray(e.sp, i * 3);
          const part = names.length > 1 ? (s.y < 0.1 ? 'pelvis' : s.y < 0.3 ? 'spine' : 'chest') : names[0];
          samples.push({ m: e.m, i, sp: s, cloth: e.cloth, part, anchor: null });
        }
      }
      const V_ = { vol, names, group, samples, skinned: meshes.some((m) => m.isSkinnedMesh) };
      this.vols.push(V_);
      for (const n of names) this.parts[n].vol = V_;
    };
    const torsoMeshes = [...this.skinned, ...TORSO.flatMap((n) => this.parts[n].meshes)];
    build(TORSO, torsoMeshes, this.parts.chest.group);
    for (const n of Object.keys(this.parts)) if (!TORSO.includes(n)) build([n], this.parts[n].meshes, this.parts[n].group);
    for (const n of TORSO) this.parts[n].meshes.push(...this.skinned);

    this.wounds = [];
    this.lost = 0;     // blood volume lost since last asked (fraction)
    this.drips = [];   // running drips
    this.blooms = [];  // bruises coming up
    this.feet = [{ n: 'L', side: 1, down: false, wet: 0 }, { n: 'R', side: -1, down: false, wet: 0 }];
    if (!BEAD_GEO) {
      BEAD_GEO = new THREE.SphereGeometry(1, 10, 8);
    }
  }

  takeLost() { const l = this.lost; this.lost = 0; return l; }

  /** Wipe every wound, stain and drip off the body (respawn). */
  heal() {
    for (const d of this.drips) d.bead && this.sys.scene.remove(d.bead);
    this.wounds = [];
    this.drips = [];
    this.blooms = [];
    this.lost = 0;
    for (const d of this.actor.dressings || []) d.removeFromParent(); // (bandages, tourniquets: med.js)
    this.actor.dressings = [];
    for (const p of Object.values(this.parts)) { p.wet = 0; p.ink = undefined; p.cool = 0; p.slide = 0; p.dmg = 0; p.lastV = null; }
    for (const f of this.feet) { f.wet = 0; f.down = false; }
    for (const { vol } of this.vols) vol.clear();
    undent(this.allMeshes());
  }

  allMeshes() { return [...new Set(Object.values(this.parts).flatMap((p) => p.meshes))]; }

  /**
   * Crush part `name` in at world `point` (n = into the body) with impactor o (dent.js).
   * Returns how deep it went (m). Every copy of the body that sees the same hit gets the same dent.
   */
  dent(name, point, n, o) {
    const part = this.parts[name];
    if (!part || !o) return 0;
    const hit = this.surface(part, point, n.clone().negate());
    const P = hit ? hit.point.clone() : point.clone();
    const meshes = TORSO.includes(name) ? [...new Set(TORSO.flatMap((t) => this.parts[t].meshes))] : part.meshes;
    const d = dentMeshes(meshes, P, n.clone().normalize(), o);
    if (d > 0.006) crunch(P, d);
    // (the posed copies used for raycasts rebuild from the new shape)
    if (this._posed) for (const c of this._posed.values()) c.frame = -1;
    return d;
  }

  /** Which torso part a point on the skinned torso belongs to. */
  torsoPart(p) {
    let best = 'chest', bd = Infinity;
    for (const n of TORSO) {
      const d = this.parts[n].group.localToWorld(_a.copy(TORSO_C[n])).distanceTo(p);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** A static copy of a skinned mesh in its current pose (rebuilt at most once per frame). */
  posed(mesh) {
    const c = (this._posed ||= new Map()).get(mesh);
    if (c && c.frame === this.frame) return c.mesh;
    const g = mesh.geometry, pos = g.attributes.position;
    let m = c?.mesh;
    if (!m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
      geo.setAttribute('normal', g.attributes.normal);
      if (g.index) geo.setIndex(g.index);
      m = new THREE.Mesh(geo);
      m.userData.skinSrc = mesh;
    }
    const arr = m.geometry.attributes.position.array;
    const v = V();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeBoundingSphere();
    m.geometry.boundingBox = null;
    m.matrixWorld.copy(mesh.matrixWorld);
    this._posed.set(mesh, { mesh: m, frame: this.frame });
    return m;
  }
  /** A part's meshes as raycast targets (skinned ones swapped for posed copies). */
  rayMeshes(part) {
    // (the player's wardrobe keeps every outfit variant built; only what's worn gets hit)
    return part.meshes.filter((m) => m.isSkinnedMesh || shown(m)).map((m) => (m.isSkinnedMesh ? this.posed(m) : m));
  }
  /** World position of vertex i of a body mesh in its current pose. */
  vertexWorld(m, i, out) {
    // skin just this one vertex (same bone matrices the posed copy uses) - no full re-skin
    if (m.isSkinnedMesh) return m.applyBoneTransform(i, out.fromBufferAttribute(m.geometry.attributes.position, i)).applyMatrix4(m.matrixWorld);
    return out.fromBufferAttribute(m.geometry.attributes.position, i).applyMatrix4(m.matrixWorld);
  }

  // ---------- surface points ----------
  /**
   * A point on the body surface: the mesh + triangle + barycentric weights (stable under any
   * pose), plus its current world point/normal and its place in the stain volume.
   */
  makeHit(h) {
    const src = h.object.userData.skinSrc || h.object;
    const f = h.face;
    const hit = { mesh: src, a: f.a, b: f.b, c: f.c, bary: V(), point: V(), normal: V(), sp: V(), vol: src.userData.stain?.vol };
    this.triWorld(hit);
    _tri.set(_A, _B, _C).getBarycoord(h.point, hit.bary);
    this.resolve(hit);
    return hit;
  }
  triWorld(hit) {
    this.vertexWorld(hit.mesh, hit.a, _A);
    this.vertexWorld(hit.mesh, hit.b, _B);
    this.vertexWorld(hit.mesh, hit.c, _C);
  }
  /** Refresh a hit's world point/normal (current pose) and stain position from its triangle. */
  resolve(hit) {
    this.triWorld(hit);
    const k = hit.bary;
    hit.point.set(0, 0, 0).addScaledVector(_A, k.x).addScaledVector(_B, k.y).addScaledVector(_C, k.z);
    hit.normal.subVectors(_C, _B).cross(_a.subVectors(_A, _B)).normalize();
    if (hit.mesh.matrixWorld.determinant() < 0) hit.normal.negate(); // mirrored hands
    const S = hit.mesh.geometry.attributes.stainPos;
    hit.sp.set(0, 0, 0)
      .addScaledVector(_a.fromBufferAttribute(S, hit.a), k.x)
      .addScaledVector(_a.fromBufferAttribute(S, hit.b), k.y)
      .addScaledVector(_a.fromBufferAttribute(S, hit.c), k.z);
    return hit;
  }
  /** A world direction at a hit, carried into stain space through the triangle itself. */
  stainDir(hit, d, out = V()) {
    this.triWorld(hit);
    const e1 = _B.sub(_A), e2 = _C.sub(_A);
    const a11 = e1.dot(e1), a12 = e1.dot(e2), a22 = e2.dot(e2);
    const det = a11 * a22 - a12 * a12;
    const S = hit.mesh.geometry.attributes.stainPos;
    const s0 = _a.fromBufferAttribute(S, hit.a), s1 = _b.fromBufferAttribute(S, hit.b).sub(s0), s2 = _c.fromBufferAttribute(S, hit.c).sub(s0);
    if (Math.abs(det) < 1e-14) return out.copy(s1).normalize();
    const r1 = d.dot(e1), r2 = d.dot(e2);
    const al = (r1 * a22 - r2 * a12) / det, be = (r2 * a11 - r1 * a12) / det;
    out.copy(s1).multiplyScalar(al).addScaledVector(s2, be);
    if (out.lengthSq() < 1e-12) out.copy(s1);
    return out.normalize();
  }

  /** Closest surface of a part's meshes near p, casting in along -n (then a few fallbacks). */
  surface(part, p, n) {
    if (!part.meshes.length) return null;
    // (the body where it's drawn now - limbs included, they aren't under the root: a puppet
    // posed since the last render would take the wound a frame off, beside the skin)
    freshMatrices(this.actor);
    let ctr;
    if (TORSO_C[part.name]) ctr = part.group.localToWorld(_w.copy(TORSO_C[part.name]));
    else {
      const m0 = part.meshes[0];
      if (!m0.geometry.boundingSphere) m0.geometry.computeBoundingSphere();
      ctr = _w.copy(m0.geometry.boundingSphere.center).applyMatrix4(m0.matrixWorld);
    }
    const radial = V().subVectors(p, ctr);
    if (radial.lengthSq() > 1e-8) radial.normalize();
    let best = null, bd = Infinity;
    for (const dn of [n, radial]) {
      if (!dn || dn.lengthSq() < 1e-6) continue;
      ray.set(_c.copy(p).addScaledVector(dn, 0.3), _b.copy(dn).negate());
      ray.far = 0.6;
      const h = ray.intersectObjects(this.rayMeshes(part), false)[0];
      if (!h) continue;
      const d = h.point.distanceTo(p);
      if (d < bd) { bd = d; best = h; }
      if (d < 0.03) break;
    }
    if (!best || bd > 0.2) return null;
    return this.makeHit(best);
  }

  // ---------- painting ----------
  /**
   * Paint a mark of `kind` onto part `name` near world point p. `n` = outward normal guess,
   * `along` = world direction the mark's long axis follows. Returns the surface hit or null.
   */
  stamp(name, p, n, along, kind, sx, sy = sx, opacity = 1) {
    const hit = this.surface(this.parts[name], p, n);
    if (!hit || !hit.vol) return null;
    this.paint(hit, along, kind, sx, sy, opacity);
    return hit;
  }
  /**
   * Something that isn't this body's own blood landing on it - someone else's blood, vomit (ink:
   * whose): a splash of it in its own colour (StainVol.addForeign), a blob and a few flecks.
   */
  splashForeign(name, p, n, along, ink, sx, amt = 0.8) {
    const hit = this.surface(this.parts[name], p, n);
    if (!hit?.vol) return null;
    const col = inkFilm(ink), vol = hit.vol, sp = hit.sp;
    let wd = along && along.lengthSq() > 1e-8 ? along.clone() : V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
    wd.addScaledVector(hit.normal, -wd.dot(hit.normal));
    if (wd.lengthSq() < 1e-8) wd = V(1, 0, 0).addScaledVector(hit.normal, -hit.normal.x);
    wd.normalize();
    const u = this.stainDir(hit, wd), side = this.stainDir(hit, V().crossVectors(hit.normal, wd).normalize());
    vol.addForeign(sp, sx * 0.4, col, amt);
    for (let i = 0; i < 4; i++) {
      const q = rnd(0, Math.PI * 2), d = rnd(0.25, 0.6) * sx;
      vol.addForeign(sp.clone().addScaledVector(u, Math.cos(q) * d * 1.3).addScaledVector(side, Math.sin(q) * d), sx * rnd(0.1, 0.2), col, amt * 0.7);
    }
    return hit;
  }
  paint(hit, along, kind, sx, sy = sx, opacity = 1) {
    const vol = hit.vol, sp = hit.sp;
    let wd = along && along.lengthSq() > 1e-8 ? along.clone() : V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
    wd.addScaledVector(hit.normal, -wd.dot(hit.normal));
    if (wd.lengthSq() < 1e-8) wd = V(1, 0, 0).addScaledVector(hit.normal, -hit.normal.x);
    wd.normalize();
    const u = this.stainDir(hit, wd);
    const side = this.stainDir(hit, V().crossVectors(hit.normal, wd).normalize());
    const at = (x, y) => sp.clone().addScaledVector(u, x).addScaledVector(side, y);
    if (kind === 'bruise') {
      this.blooms.push({ vol, sp: sp.clone(), r: Math.max(sx, sy) * 0.6, amt: opacity * 0.9, t: 0 });
    } else if (kind === 'scratch') {
      const k = Math.round(2 + Math.random() * 2);
      for (let i = 0; i < k; i++) {
        const o = rnd(-0.4, 0.4) * sy;
        vol.line(at(-sx * 0.5, o), at(sx * 0.5, o + rnd(-0.004, 0.004)), 0.0025, 2, 0.4 * opacity);
      }
      for (let i = 0; i < 3; i++) vol.add(at(rnd(-0.4, 0.4) * sx, rnd(-0.3, 0.3) * sy), 0.004, 0, 0.35 * opacity);
    } else if (kind === 'cut') {
      vol.add(sp, sx * 0.4, 2, 0.3);
      vol.line(at(-sx * 0.35, 0), at(sx * 0.35, rnd(-0.003, 0.003)), Math.max(0.003, sy * 0.22), 2, 1.1);
      vol.add(sp, sx * 0.55, 0, 0.5);
    } else if (kind === 'splash') {
      vol.add(sp, sx * 0.3, 0, 0.6 * opacity);
      for (let i = 0; i < 6; i++) {
        const q = rnd(0, Math.PI * 2), d = rnd(0.2, 0.55) * sx;
        vol.add(at(Math.cos(q) * d, Math.sin(q) * d * (sy / sx)), sx * rnd(0.08, 0.18), 0, rnd(0.4, 0.7) * opacity);
      }
    } else if (kind === 'smudge') {
      vol.line(at(-sx * 0.4, 0), at(sx * 0.4, 0), sy * 0.35, 0, 0.3 * opacity);
    }
  }

  // ---------- injuries ----------
  /** A hit on part `name`: sev ~0..2, n = surface normal (pointing out of what we hit, into the body), vIn = velocity before. */
  injure(name, point, n, vIn, sev) {
    rollPrism(this.actor); // (prism blood: a new colour for a new injury)
    const part = this.parts[name];
    part.dmg += sev;
    this.actor.organs?.impact(name, sev);
    const out = n.clone().negate(); // from the body toward the surface it hit
    const along = vIn.clone().addScaledVector(n, -vIn.dot(n));
    // bruise at every solid hit
    this.stamp(name, point, out, along, 'bruise', 0.06 + sev * 0.05, 0.05 + sev * 0.04, clamp(0.5 + sev * 0.4, 0, 1));
    const head = part.kind === 'head';
    if (sev > 0.85 || (part.dmg > 3 && sev > 0.35) || (head && sev > 0.55)) {
      const bleed = clamp(sev * (head ? 0.9 : 0.45), 0.1, 0.8);
      const hit = this.stamp(name, point, out, along, 'cut', 0.05 + sev * 0.03, 0.035 + sev * 0.02);
      if (hit) {
        const w = this.addWound(name, hit, bleed, 0.1);
        w.clot = head ? 28 : 18; // split skin, not a severed vessel: it stops on its own
        this.paint(hit, along, 'splash', 0.05 + sev * 0.035, 0.05 + sev * 0.035, 0.75);
      }
      // gush: reflected off what we hit, plus scatter along the slide
      const refl = vIn.clone().reflect(n.clone().normalize()).multiplyScalar(0.35).addScaledVector(n, 1.5);
      if (refl.lengthSq() < 1e-4) refl.copy(n);
      const sp = clamp(vIn.length() * 0.45 + 0.8, 1, 5);
      this.sys.inked(this.actor).spray(point, refl.normalize(), sp * 0.8, Math.round(2 + sev * 10), 0.5, 0.8 + sev * 0.3);
      // blood slapped onto the floor right where the hit happened
      const gy = this.sys.colliders.groundAt(point.x, point.z, point.y + 0.05);
      if (point.y - gy < 0.25) { const fp = V(point.x, gy, point.z); this.floor.inked(this.actor).by(this.actor).splat(this.floor.horizontal(fp), fp, vIn, 0.03 + sev * 0.04, 0.8); }
      this.wetPart(part, 0.15 + sev * 0.2);
    }
  }

  /**
   * Bitten on part `name` at `point` (n into the body): a ragged, torn bite that bleeds hard and
   * clots slowly. show = only the look of it (someone else's body: its owner loses the blood).
   */
  bite(name, point, n, sev, show = false) {
    rollPrism(this.actor); // (prism blood: a new colour for a new injury)
    const part = this.parts[name];
    if (!part) return null;
    part.dmg += sev * 0.8;
    const out = n.clone().negate();
    const along = V(rnd(-1, 1), rnd(-0.3, 0.3), rnd(-1, 1));
    this.stamp(name, point, out, along, 'bruise', 0.07 + sev * 0.03, 0.06 + sev * 0.03, 0.9);
    const hit = this.stamp(name, point, out, along, 'cut', 0.045 + sev * 0.02, 0.03 + sev * 0.015);
    let w = null;
    if (hit) {
      this.paint(hit, V(0, -1, 0), 'splash', 0.08 + sev * 0.04, 0.1 + sev * 0.05, 0.9);
      // (torn flesh: the teeth marks either side of it)
      for (const k of [-1, 1]) this.paint(hit, along, 'cut', 0.012, 0.01, 0.9);
      if (!show) {
        // the throat (a bite low on the head) is the worst of it
        const throat = part.kind === 'head' && point.y < part.group.getWorldPosition(V()).y - 0.02;
        w = this.addWound(name, hit, clamp(0.7 + sev * 0.8, 0.6, 1.8) * (throat ? 1.8 : 1), 0.08, 'cut');
        w.clot = throat ? 60 : 38;
      }
    }
    this.sys.inked(this.actor).spray(point, out.clone().addScaledVector(V(0, 1, 0), 0.3).normalize(), rnd(0.8, 1.8), Math.round(6 + sev * 8), 0.5, 0.9);
    this.wetPart(part, 0.3 + sev * 0.2);
    return w;
  }

  /**
   * A blade chopped into part `name` at `point`, travelling along n (into the body) at vel;
   * `axis` = the blade's length (the gash runs along it). Returns the wound or null.
   */
  chop(name, point, n, vel, axis, sev) {
    rollPrism(this.actor); // (prism blood: a new colour for a new injury)
    const part = this.parts[name];
    part.dmg += sev * 1.2;
    const out = n.clone().negate();
    const hit = this.surface(part, point, out);
    let w = null;
    if (hit && hit.vol) {
      // the gash is where the blade's plane (its length + the way it was travelling) meets the
      // skin: a chop opens a line along the edge, a draw across the body slices along the stroke
      const plane = axis ? axis.clone().cross(vel) : V();
      let along = plane.lengthSq() > 1e-6 ? hit.normal.clone().cross(plane.normalize()) : (axis ? axis.clone() : vel.clone().cross(n));
      along.addScaledVector(hit.normal, -along.dot(hit.normal));
      if (along.lengthSq() < 1e-8) along = vel.clone().cross(hit.normal);
      along.normalize();
      // a slicing stroke (the edge dragged along its length, or across a curved limb) opens up longer
      const draw = axis ? Math.abs(vel.clone().normalize().dot(axis)) : 0;
      const len = (0.09 + sev * 0.08) * (1 + draw * 0.8);
      w = this.slice(part, hit, along, len, sev);
      this.paint(hit, vel, 'splash', 0.1 + sev * 0.06, 0.08 + sev * 0.05, 0.9);
    }
    // how deep it bit decides what it opened up inside
    const entry = hit ? hit.point : point;
    const depth = 0.03 + 0.05 * clamp(sev, 0, 1.5);
    const organs = this.actor.organs?.shot(entry, n.clone().normalize(), entry.clone().addScaledVector(n, depth));
    if (organs) {
      if (w) { w.bleed *= Math.min(organs.bleed, 4); w.clot = 40 + 30 * (organs.bleed - 1); }
      if (organs.lethal) this.actor.organs.die();
    }
    // blood thrown the way the blade was going: a fan off the length of the gash, carried
    // with the stroke and lifted a little off the skin, then a weaker spit back out of it
    const fling = vel.clone().normalize();
    const sp = clamp(vel.length() * 0.55, 2.5, 9);
    const ends = w?.slice || [entry, entry];
    const lift = (hit ? hit.normal : out).clone();
    const nStreak = Math.round(5 + sev * 5);
    for (let i = 0; i < nStreak; i++) {
      const at = ends[0].clone().lerp(ends[1], Math.random());
      const d = fling.clone().addScaledVector(lift, rnd(0.1, 0.45)).normalize();
      this.sys.inked(this.actor).spray(at, d, sp, Math.round(2 + sev * 2), 0.14, rnd(0.7, 1.2) + sev * 0.3);
    }
    this.sys.inked(this.actor).spray(entry, fling.clone().add(lift).normalize(), sp * 0.4, Math.round(4 + sev * 6), 0.45, 0.9);
    this.sys.inked(this.actor).spray(entry, out, 1.4, 4, 0.6, 0.7);
    this.wetPart(part, 0.35 + sev * 0.15);
    return w;
  }

  /**
   * A blade driven in point first (the hunting knife): a short slit where it went in, and a
   * deep track inside - it reaches organs a slash never would. Bleeds hard, spits little.
   */
  stab(name, point, n, vel, axis, sev) {
    rollPrism(this.actor); // (prism blood: a new colour for a new injury)
    const part = this.parts[name];
    part.dmg += sev * 1.4;
    const out = n.clone().negate();
    const hit = this.surface(part, point, out);
    let w = null;
    if (hit && hit.vol) {
      // the slit runs the way the edge faces (across the blade's flat)
      let along = axis ? axis.clone().cross(vel) : vel.clone().cross(n);
      along.addScaledVector(hit.normal, -along.dot(hit.normal));
      if (along.lengthSq() < 1e-8) along = V(0, 1, 0).cross(hit.normal);
      along.normalize();
      const a = hit.sp, len = 0.018 + sev * 0.01;
      this.stamp(name, point, out, along, 'bruise', 0.035 + sev * 0.02, 0.03 + sev * 0.015, 0.6);
      this.paint(hit, along, 'cut', len, 0.006 + sev * 0.002, 1);
      this.paint(hit, V(0, -1, 0), 'splash', 0.04 + sev * 0.03, 0.07 + sev * 0.04, 0.85);
      w = this.addWound(name, hit, clamp(1 + sev * 0.7, 0.9, 2.2), 0.05, 'cut');
      w.clot = 45;
    }
    const entry = hit ? hit.point : point;
    const dir = (vel.lengthSq() > 1e-6 ? vel.clone() : n.clone()).normalize();
    const depth = 0.07 + 0.07 * clamp(sev, 0, 1.5);
    const organs = this.actor.organs?.shot(entry, dir, entry.clone().addScaledVector(dir, depth));
    if (organs) {
      if (w) { w.bleed *= Math.min(organs.bleed, 4); w.clot = 50 + 30 * (organs.bleed - 1); }
      if (organs.lethal) this.actor.organs.die();
    }
    this.sys.inked(this.actor).spray(entry, out.clone().addScaledVector(V(0, -1, 0), 0.3).normalize(), 1.6, Math.round(4 + sev * 5), 0.4, 0.9);
    this.wetPart(part, 0.3 + sev * 0.15);
    return w;
  }

  /**
   * An open slice through the skin of `part`, centred on hit, running along world dir `along`
   * for `len` metres: followed over the curve of the body a step at a time, deepest in the middle
   * and tapering to hairline ends, with a bleeding wound at the centre and weeping ones along it.
   */
  slice(part, hit, along, len, sev) {
    const N = 7, pts = [];
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1) - 0.5) * len;
      if (i === (N - 1) / 2) { pts.push(hit); continue; }
      // step along the skin from the centre, re-found on the surface (it curves away)
      const p = hit.point.clone().addScaledVector(along, s);
      const h = this.surface(part, p, hit.normal);
      pts.push(h && h.vol && h.point.distanceTo(p) < 0.05 ? h : null);
    }
    const good = pts.map((h, i) => [h, i]).filter(([h]) => h);
    for (let k = 0; k + 1 < good.length; k++) {
      const [a, i] = good[k], [b, j] = good[k + 1];
      if (j - i > 2 || a.vol !== b.vol) continue; // gap: the skin fell away there (edge of the limb), or skin -> cloth
      const mid = ((i + j) / 2) / (N - 1) - 0.5;          // -0.5..0.5 along the cut
      const t = 1 - Math.pow(Math.abs(mid) * 2, 1.6);      // 1 in the middle, 0 at the ends
      const wd = Math.max(0.0025, (0.004 + sev * 0.004) * (0.25 + t));
      a.vol.line(a.sp, b.sp, wd, 2, 0.7 + t * 0.5);      // the opening
      a.vol.line(a.sp, b.sp, wd * 2.4, 0, 0.35 + t * 0.3); // blood welling along its lips
    }
    hit.vol.add(hit.sp, 0.02 + sev * 0.01, 0, 0.45);
    const w = this.addWound(part.name, hit, clamp(0.8 + sev * 0.6, 0.7, 1.9), 0.05, 'cut');
    // the length of it weeps too: a couple of smaller wounds out toward the ends
    for (const k of [1, N - 2]) if (pts[k]) this.addWound(part.name, pts[k], clamp(0.2 + sev * 0.2, 0.15, 0.5), 0.2, 'cut').clot = 25;
    const e0 = good[0][0].point.clone(), e1 = good[good.length - 1][0].point.clone();
    w.slice = [e0, e1];
    return w;
  }

  /**
   * More blood on a part: ours (ink omitted) or picked up off the floor (its ink). Whichever
   * makes up most of what's on it now is the colour it prints, smears and drips.
   */
  wetPart(part, amt, ink = inkOf(this.actor)) {
    if (!(amt > 0) || noInk(ink)) return;
    if (part.ink === undefined || amt >= part.wet * 0.5) part.ink = ink;
    part.wet = Math.min(1, part.wet + amt);
  }

  addWound(name, hit, bleed, next, kind) {
    const part = this.parts[name];
    const local = part.group.worldToLocal(hit.point.clone());
    const nLocal = hit.normal.clone().applyQuaternion(part.group.getWorldQuaternion(_q).invert());
    const w = { part: name, local, nLocal, hit, bleed, t: 0, next, kind, wellT: 0 };
    this.wounds.push(w);
    return w;
  }

  /** A bullet through part `name`, entering at `point` travelling along `dir`. Returns { entry wound, organs hit }. */
  gunshot(name, point, dir) {
    rollPrism(this.actor); // (prism blood: a new colour for a new injury)
    const part = this.parts[name];
    const head = part.kind === 'head';
    part.dmg += 1.5;
    const d = dir.clone().normalize();
    const back = d.clone().negate();
    const addWound = (hit, bleed, size, kind) => {
      this.paint(hit, null, 'cut', size, size * 0.9);
      this.paint(hit, d, 'splash', size * 2.6, size * 2.2, 0.85);
      return this.addWound(name, hit, bleed, 0.05, kind);
    };
    const entryHit = this.surface(part, point, back);
    const entry = entryHit && entryHit.vol ? addWound(entryHit, head ? 1.4 : 1.1, 0.022, 'entry') : null;
    // exit: cast back from beyond the far side toward the entry
    ray.set(_c.copy(point).addScaledVector(d, 0.45), _b.copy(back));
    ray.far = 0.45;
    const ex = ray.intersectObjects(this.rayMeshes(part), false)[0];
    let exitAt = point.clone().addScaledVector(d, 0.1), exitW = null;
    if (ex) {
      const hit = this.makeHit(ex);
      exitAt = hit.point.clone();
      if (hit.vol) exitW = addWound(hit, head ? 1.3 : 1, 0.034, 'exit');
    }
    // what it tore through inside decides how hard (and how long) the holes bleed
    const organs = this.actor.organs?.shot(entryHit ? entryHit.point : point, d, ex ? exitAt : null) || { bleed: 1, hits: [] };
    for (const w of [entry, exitW]) {
      if (!w) continue;
      w.bleed *= organs.bleed;
      w.clot = 50 + 30 * (organs.bleed - 1);
    }
    // a cut artery pumps out of the holes (deep ones, like the aorta, mostly bleed inside)
    const art = organs.hits.map((n) => ARTERY_JET[n.replace(/[LR]$/, '')]).filter(Boolean);
    if (art.length && this.sys.arteries) {
      const k = Math.max(...art);
      if (entry) this.sys.arteries.wound(this.actor, part.group, entry, k * 0.8);
      if (exitW) this.sys.arteries.wound(this.actor, part.group, exitW, k);
    }
    // the exit sprays forward along the bullet; a fine mist puffs back toward the shooter
    this.sys.inked(this.actor).spray(exitAt, d, head ? 7 : 5.5, head ? 38 : 20, 0.28, 1);
    this.sys.inked(this.actor).spray(point, back, 1.6, 5, 0.5, 0.6);
    this.wetPart(part, 0.4);
    return { entry, organs };
  }

  // ---------- per frame ----------
  update(dt, budget) {
    this.frame = (this.frame || 0) + 1;
    const A = this.actor;
    A.hero.root.updateMatrixWorld(true);
    for (const b of this.blooms) {
      // bruises come up over a couple of seconds
      const k = Math.min(dt, 2.5 - b.t) / 2.5;
      b.t += dt;
      if (k > 0) b.vol.add(b.sp, b.r, 1, b.amt * k);
    }
    this.blooms = this.blooms.filter((b) => b.t < 2.5);
    // floor contact sampling runs at ~30 Hz (it's hundreds of surface points per body)
    this.contactAcc = (this.contactAcc || 0) + dt;
    const cdt = this.contactAcc >= 1 / 30 ? this.contactAcc : 0;
    if (cdt) this.contactAcc = 0;
    if (A.mode === 'ragdoll') { this.sensePhysical(dt); if (cdt) this.contacts(cdt, false); }
    else {
      for (const p of Object.values(this.parts)) p.lastV = null;
      if (cdt) this.contacts(cdt, true);
      this.senseFeet(dt);
    }
    this.bleed(dt);
    this.runDrips(dt);
    // what a part or shoe carries dries out too: it stops shedding drops and printing
    for (const p of Object.values(this.parts)) if (p.wet > 0) p.wet = Math.max(0, p.wet - dt / DRY_T);
    for (const f of this.feet) if (f.wet > 0) f.wet = Math.max(0, f.wet - dt / DRY_T);
    for (const v of this.vols) {
      if (!v.vol.data) continue;
      // fabric wicks downhill: world down in the volume's frame
      v.vol.down.copy(DOWN).applyQuaternion(v.group.getWorldQuaternion(_q).invert());
      v.vol.update(dt, budget);
    }
  }

  sensePhysical(dt) {
    const rd = this.actor.rd;
    for (const p of rd.list) {
      const part = this.parts[p.name];
      // (a ghost past a cut feels nothing; its own piece flies separately)
      if (p.gone) { part.lastV = null; continue; }
      const lv = p.body.linvel();
      const v = V(lv.x, lv.y, lv.z);
      part.cool = Math.max(0, part.cool - dt);
      if (part.lastV && p.touch) {
        // momentum change of this part in one frame (gravity removed) = how hard it hit
        const dv = _a.subVectors(v, part.lastV);
        dv.y += G * dt;
        const mag = dv.length();
        const r = RADIUS[part.kind];
        const com = rd.point(p.name, p.def.com, V());
        // (a stump is light and twitchy on the floor: it takes a real blow to count)
        const stump = p.cutY !== undefined;
        const need = stump ? 5 : 2.8;
        if (mag > need && !part.cool && part.kind !== 'foot') {
          const n = dv.clone().normalize();
          const point = com.clone().addScaledVector(n, -r);
          const sev = (mag - need) / 5.5 * (part.kind === 'head' ? 1.3 : 1);
          this.injure(p.name, point, n, part.lastV.clone(), sev);
          part.cool = stump ? 0.8 : 0.25;
          // hit the ground hard enough and the body flattens against it (and everyone sees it)
          const fd = !stump && fallDent(part.kind, mag);
          if (fd && this.dent(p.name, point, n, fd) > 0) this.actor.onDent?.(p.name, point, n, fd);
        }
        // grazes from sliding along the ground
        const gy = this.sys.colliders.groundAt(com.x, com.z, com.y);
        const hs = Math.hypot(v.x, v.z);
        if (com.y - r - gy < 0.08 && hs > 1.8) {
          part.slide += hs * dt;
          if (part.slide > 0.12) {
            part.slide = 0;
            this.stamp(p.name, V(com.x, com.y - r, com.z), DOWN, v, 'scratch', 0.07 + hs * 0.01, 0.035, clamp(0.4 + hs * 0.1, 0, 1));
            part.dmg += 0.04;
            if (hs > 3.5 && Math.random() < 0.15) this.wetPart(part, 0.1);
          }
        }
      }
      part.lastV = v;
    }
  }

  /**
   * Exact floor contact: every sample point of the body surface that is actually down on the
   * floor soaks up the fresh blood under it, and drags the blood sitting on that very spot of
   * the body across the floor as it slides.
   */
  contacts(dt, feetOnly) {
    const C = this.sys.colliders, F = this.floor;
    for (const V_ of this.vols) {
      if (feetOnly && !V_.names[0].startsWith('foot')) continue;
      // (cut off: that limb is flying about on its own now, not on this body)
      if (this.actor.rd?.parts[V_.names[0]]?.gone) continue;
      const gp = V_.group.getWorldPosition(_w);
      if (gp.y - C.groundAt(gp.x, gp.z, gp.y) > 0.75) { for (const s of V_.samples) s.anchor = null; continue; }
      const vol = V_.vol;
      // every sample's world point first, then the level shapes under all of them fetched once
      const S = V_.samples, n = S.length;
      const P = (V_._wp ||= new Float64Array(n * 3));
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < n; k++) {
        const w = this.vertexWorld(S[k].m, S[k].i, _n);
        P[k * 3] = w.x; P[k * 3 + 1] = w.y; P[k * 3 + 2] = w.z;
        if (w.x < x0) x0 = w.x; if (w.x > x1) x1 = w.x;
        if (w.z < z0) z0 = w.z; if (w.z > z1) z1 = w.z;
      }
      const reg = C.region(x0, z0, x1, z1, this._reg ||= { boxes: [], circles: [] });
      for (let k = 0; k < n; k++) {
        const s = S[k];
        if (s.part && this.actor.rd?.parts[s.part]?.gone) { s.anchor = null; continue; } // (cut off)
        const w = _n.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
        const gy = C.groundAtIn(reg, w.x, w.z, w.y + 0.03);
        if (w.y - gy > TOUCH) { s.anchor = null; continue; }
        const fp = _c.set(w.x, gy, w.z);
        // pick up what's under this spot
        const wet = F.wetAt(fp);
        if (wet > 0.02) {
          let got = F.pickup(fp, Math.min(wet, 0.4 * dt + 0.004), this.actor);
          // its own blood (what it bled or smeared there) still drags along with it, but only a
          // little of it soaks back in each time - the wiping wins, and it comes up clean in the end
          if (F.pickedOwn) got *= 0.6;
          if (got > 0.001) {
            // (someone else's blood or vomit, off the floor, in its own colour; ours as ours)
            if (F.picked !== inkOf(this.actor)) vol.addForeign(s.sp, SPACING * (s.cloth ? 1.1 : 0.9), inkFilm(F.picked), Math.min(0.6, got * 7));
            else vol.add(s.sp, SPACING * (s.cloth ? 0.9 : 0.75), 0, Math.min(0.6, got * 7));
            const part = this.parts[s.part];
            // (someone else's blood, off the floor: the part carries their colour, not ours)
            this.wetPart(part, got * 1.5, F.picked);
          }
        }
        // lay down what this spot carries
        if (s.anchor) {
          const len = s.anchor.distanceTo(fp);
          if (len > 0.012) {
            const load = Math.max(vol.sample(s.sp, 0), s.cloth ? vol.sample(s.sp, 3) * 0.45 : 0);
            if (load > 0.1) {
              F.inked(this.parts[s.part]?.ink ?? inkOf(this.actor)).by(this.actor).smear(s.anchor, fp, SPACING * rnd(1.2, 1.7), clamp(load * 1.15, 0, 1));
              vol.add(s.sp, SPACING * 0.7, 0, -Math.min(0.3, len * 1.2) * load);
            }
            // rubbed along the ground: the blood on this spot slowly wears off too (wet or
            // dried, ours or anyone's) - a few metres of dragging and it comes up clean
            vol.wipe(s.sp, SPACING * 0.8, Math.min(0.06, len * 0.2));
            s.anchor.copy(fp);
          }
        } else s.anchor = fp.clone();
      }
    }
  }

  /** Walking: shoe prints when a foot plants, carrying blood picked up from the floor. */
  senseFeet(dt) {
    const h = this.actor.hero;
    h.legs.forEach((l, i) => {
      const f = this.feet[i];
      const wp = l.foot.getWorldPosition(_a);
      const sp = f.last ? Math.hypot(wp.x - f.last.x, wp.z - f.last.z) / Math.max(dt, 1e-3) : 0;
      (f.last ||= V()).copy(wp);
      // planted: low and (nearly) still; lifted: clearly up or moving
      const hy = wp.y - this.sys.colliders.groundAt(wp.x, wp.z, wp.y + 0.05);
      const down = f.down ? !(hy > 0.13 || sp > 1.6) : hy < 0.1 && sp < 0.7;
      if (down && !f.down) {
        // heel strike: print what we carry, then soak up what's here
        const dir = _b.set(0, 0, 1).applyQuaternion(l.foot.getWorldQuaternion(_q));
        const yaw = Math.atan2(dir.x, dir.z);
        const fp = V(wp.x + dir.x * 0.05, 0, wp.z + dir.z * 0.05);
        fp.y = this.sys.colliders.groundAt(fp.x, fp.z, wp.y + 0.05);
        const part = this.parts['foot' + f.n];
        const load = Math.max(f.wet, part.wet);
        // (the print is the colour of what the shoe carries: the floor's, or our own bleeding)
        const own = inkOf(this.actor);
        const ink = f.wet >= part.wet ? (f.ink ?? own) : (part.ink ?? own);
        if (load > 0.03) this.floor.inked(ink).footprint(fp, yaw, f.side, load);
        const got = this.floor.pickup(fp, 0.6) * 1.4, kept = load * 0.78;
        f.ink = got > kept ? this.floor.picked : ink;
        part.ink = undefined;
        f.wet = kept + got;
        part.wet = 0;
        f.wet = Math.min(1, f.wet);
      }
      f.down = down;
    });
  }

  bleed(dt) {
    // (settings: the look of it - drips, welling, pools - not the blood actually lost)
    const show = settings.blood && settings.bleeding && settings.bloodAmount > 0 && !this.dry;
    for (const w of this.wounds) {
      w.t += dt;
      w.bleed *= Math.exp(-dt / (w.clot || 50)); // clotting
      if (!this.dry) this.lost += w.bleed * dt * 0.0022; // blood out of the body (if it has any)
      if (w.bleed < 0.05 || !show) continue;
      const part = this.parts[w.part];
      this.wetPart(part, w.bleed * dt * 0.05);
      const hit = this.resolve(w.hit);
      // blood wells up around the wound (fabric soaks it up and spreads it)
      w.wellT -= dt;
      if (w.wellT <= 0) {
        w.wellT = 0.3;
        const r = 0.008 + Math.min(0.03, Math.sqrt(w.t) * 0.004) * Math.min(1, w.bleed);
        hit.vol.add(hit.sp, r, 0, 0.1 * Math.min(1, w.bleed));
      }
      // resting on the floor: it pools underneath instead of running
      const wp = hit.point;
      const wgy = this.sys.colliders.groundAt(wp.x, wp.z, wp.y + 0.05);
      if (wp.y - wgy < 0.14 && this.actor.mode === 'ragdoll') {
        w.pooled = (w.pooled || 0) + w.bleed * dt;
        w.poolT = (w.poolT || 0) - dt;
        if (w.poolT <= 0) {
          w.poolT = 0.4;
          // (it creeps outward as the blood keeps coming: a small spot at first, filling in thinly
          // each time, a wide puddle only after a long while lying in it)
          const r = Math.min(0.34, 0.02 + Math.sqrt(w.pooled) * 0.035);
          this.floor.inked(this.actor).by(this.actor).pool(V(wp.x + rnd(-0.02, 0.02), wgy, wp.z + rnd(-0.02, 0.02)), r, Math.min(1, w.bleed * 0.8 + 0.15), 0.35);
        }
      }
      w.next -= dt;
      if (w.next <= 0 && this.drips.length < 7) {
        w.next = rnd(1.8, 4) / w.bleed / Math.max(0.2, settings.bloodAmount);
        const vol = rnd(0.6, 1) * Math.min(1, w.bleed);
        // start a little off the wound so each drip finds its own line
        const d = { ...hit, bary: hit.bary.clone(), point: hit.point.clone(), normal: hit.normal.clone(), sp: hit.sp.clone() };
        d.bary.x = Math.max(0, d.bary.x + rnd(-0.2, 0.2)); d.bary.y = Math.max(0, d.bary.y + rnd(-0.2, 0.2));
        d.bary.z = Math.max(0, d.bary.z + rnd(-0.2, 0.2));
        d.bary.divideScalar(d.bary.x + d.bary.y + d.bary.z || 1);
        const bead = new THREE.Mesh(BEAD_GEO, inkMat(0x5a0207, inkOf(this.actor)));
        this.sys.scene.add(bead);
        this.drips.push({ part: w.part, hit: d, vol, len: 0, bead, painted: null });
      }
    }
    this.wounds = this.wounds.filter((w) => w.bleed >= 0.05 || w.t < 1);
  }

  /** Drips crawl down the real surface under gravity, following the body, and fall off undersides. */
  runDrips(dt) {
    const A = this.actor;
    const keep = [];
    // the crawl (a raycast onto the posed surface) steps at 20 Hz for all drips at once, so a
    // skinned torso is re-posed at most that often; beads still follow the body every frame
    this.dripAcc = (this.dripAcc || 0) + dt;
    const stepDt = this.dripAcc >= 0.05 ? this.dripAcc : 0;
    if (stepDt) this.dripAcc = 0;
    for (const d of this.drips) {
      const part = this.parts[d.part];
      const hit = this.resolve(d.hit);
      const cloth = !!hit.mesh.userData.stain?.cloth;
      const r = cloth ? 0.006 + d.vol * 0.004 : 0.0028 + d.vol * 0.0016;
      if (stepDt) {
        const dt = stepDt;
        // reached an underside: it gathers into a hanging drop and falls
        if (hit.normal.y < -0.6) { this.fall(d, hit.point); continue; }
        // paint the trail it leaves behind
        if (!d.painted) { hit.vol.add(hit.sp, r * 1.3, 0, 0.6); d.painted = hit.sp.clone(); }
        else if (d.painted.distanceTo(hit.sp) > r * 0.5) {
          hit.vol.line(d.painted, hit.sp, r, 0, 0.55 + d.vol * 0.25);
          d.painted.copy(hit.sp);
        }
        // gravity along the surface
        const t = _n.copy(DOWN).addScaledVector(hit.normal, -hit.normal.dot(DOWN));
        const steep = t.length();
        // runs quicker on steep skin and while it still has volume; creeps to a stop as it
        // thins. fabric drinks it: it barely runs before it's soaked in
        const reach = cloth ? 0.02 + d.vol * 0.04 : 0.12 + d.vol * 0.3;
        const left = 1 - d.len / reach;
        const sp = (cloth ? 0.015 : 0.045) * clamp(steep, 0, 1) * (0.5 + d.vol) * clamp(left * 1.5, 0.15, 1);
        d.len += sp * dt + (steep < 0.08 ? dt * 0.01 : 0);
        if (left <= 0) { this.stop(d); continue; }
        if (steep > 0.08) {
          // step down the slope, then find the surface again right there
          const np = _w.copy(hit.point).addScaledVector(t.normalize(), sp * dt);
          ray.set(_c.copy(np).addScaledVector(hit.normal, 0.04), _b.copy(hit.normal).negate());
          ray.far = 0.08;
          const h = ray.intersectObjects(this.rayMeshes(part), false)[0];
          if (!h || h.point.distanceTo(np) > 0.02) { this.fall(d, hit.point); continue; }
          const nh = this.makeHit(h);
          if (nh.vol !== hit.vol) d.painted = null;
          d.hit = nh;
        }
      }
      const b = d.hit;
      const br = cloth ? 0 : r * 0.9;
      d.bead.visible = br > 0;
      d.bead.position.copy(b.point).addScaledVector(b.normal, br * 0.3);
      d.bead.quaternion.setFromUnitVectors(_a.set(0, 1, 0), b.normal);
      d.bead.scale.set(br, br * 0.5, br);
      keep.push(d);
    }
    this.drips = keep;
    // soaked parts shed drops too, harder when the body is moving fast
    if (A.mode === 'ragdoll') {
      for (const p of A.rd.list) {
        const part = this.parts[p.name];
        if (part.wet < 0.5) continue;
        const lv = p.body.linvel();
        const sp = Math.hypot(lv.x, lv.y, lv.z);
        if (Math.random() < dt * (0.3 + sp * 0.8) * part.wet) {
          const at = A.rd.point(p.name, p.def.com, V());
          this.sys.inked(part.ink ?? inkOf(this.actor)).drip(at, V(lv.x, lv.y, lv.z).multiplyScalar(0.8), 0.005);
          part.wet -= 0.02;
        }
      }
    }
  }

  stop(d) { d.bead.removeFromParent(); }

  fall(d, at) {
    this.stop(d);
    // leaves the body with that part's velocity
    const A = this.actor;
    const v = V();
    if (A.mode === 'ragdoll') { const lv = A.rd.parts[d.part].body.linvel(); v.set(lv.x, lv.y, lv.z); }
    else v.copy(A.hero.vel);
    this.sys.inked(this.actor).drip(at.clone(), v, 0.004 + d.vol * 0.003);
  }
}

/** Name of the innermost of `groups` that contains o. */
function ownerOf(o, groups, names) {
  for (let p = o.parent; p; p = p.parent) {
    const i = groups.indexOf(p);
    if (i >= 0) return names[i];
  }
  return names[0];
}
