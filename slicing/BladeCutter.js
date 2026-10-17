import * as THREE from 'three';
import { capsuleOf } from '../strike.js';
import { Sliceable, TISSUE, limbOf, BONE_SHARE } from './Sliceable.js';
import { dismemberOn } from './GoreSettings.js';
import { limbLost } from './LimbHealth.js';
import { openGash, updateGash, closeGash, dropGash } from '../gash.js';

/*
  BladeCutter - the cutting edge of a held weapon (the machete).

  The edge runs from BladeBase to BladeTip (two Object3Ds on the weapon's mesh) and has a
  thickness. Every step it's swept from where it was last step to where it is now - the quad
  between the two edge lines - and that swept quad is sampled (SAMPLES lines across it) against
  everything sliceable near it: people's body parts (their capsules), loose cut-off body parts
  (slice.js chunks: their colliders) and Sliceable meshes (props, pieces: their triangles).

  Each thing the edge meets gets its own cut, followed for as long as the edge is in it:
    enter  - only if the EDGE leads (not the flat, the back or the handle), the blade is going
             fast enough for that tissue, and it isn't going in point first (that's a stab).
             Otherwise it's a blunt hit, and nothing more until the blade leaves it.
    drag   - every step inside: the cut plane of that step (it holds the edge direction and the
             way that point of the edge is moving) is added to the path, and the tissue takes
             its toll on the swing's push (resistance x distance, bone where the path crosses
             it). Out of push: the blade stalls in it.
    exit   - out the far side: cut along the plane fitted to the whole path it took (normals
             averaged by how far each step went, through the middle of the contact points), so
             the angle, the direction and the curve of the real swing are what decide the cut.
  A thin thing passed clean through within one step is entered and exited in that same step.
  Cuts are independent, so one swing can go through several limbs (or bodies, or pieces) and a
  piece cut off can be cut again by the same blade.

  The cut itself: a body part goes to slice.js (Dismember.sever / split: the game's own body
  pipeline - stump, ragdoll, artery, death, multiplayer); a Sliceable mesh goes to SlicePieces
  (MeshSlicer). Feedback (blood, sound, haptics) goes to ctx.sliceFx; debug traces to this.trace.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SAMPLES = 6;          // lines across the swept quad per step
const EDGE_LEAD = 0.45;     // cos: how squarely the edge must lead the motion to cut
const STAB_ALONG = 0.72;    // cos: motion this close to the blade's own axis = point first
const STAB_LATERAL = 2.2;   // m/s: at most this much sideways for it to count as a stab
const TORSO = new Set(['pelvis', 'spine', 'chest']);
const SUB_LEN = 0.035;      // m: a step whose edge travels further than this is swept in substeps
const SUB_ANG = 0.12;       // rad: ...or that turns the blade more than this
const SUB_MAX = 10;
const _wp = V(), _wq = new THREE.Quaternion(), _ws = V(), _sp = V(), _sq = new THREE.Quaternion(), _sm = new THREE.Matrix4(), _eo = V();

const _A = V(), _B = V(), _c1 = V(), _c2 = V(), _d = V(), _e = V(), _v = V(), _q = new THREE.Quaternion(), _p = V();
const _pa = V(), _pb = V(), _ray = new THREE.Raycaster(), _hits = [], _inv = new THREE.Matrix4();
let cutIds = 0;
const _dirOut = new THREE.Vector3(0.5773, 0.5774, 0.5773).normalize();

/** Closest points of segments p1q1 / p2q2 (into c1 / c2, s along the first); returns the distance. */
function closest(p1, q1, p2, q2, c1, c2, out) {
  const d1 = _d.subVectors(q1, p1), d2 = _e.subVectors(q2, p2), r = _v.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
    s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  } else if (e > 1e-9) t = clamp(f / e, 0, 1);
  else if (a > 1e-9) s = clamp(-d1.dot(r) / a, 0, 1);
  c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t);
  if (out) { out.s = s; out.t = t; }
  return c1.distanceTo(c2);
}

/*
  What a cut is measured against: the thing being cut, not the world. The plane and the contact
  points are gathered over several steps, and the target can turn under the blade meanwhile (a
  person turning, a ragdoll rolling, a piece spinning) - kept in its own frame, they still
  describe the stroke as it went through IT, and the cut comes out where the opening was.
*/
const _m3 = new THREE.Matrix3();
function frameOf(T) {
  const f = T.kind === 'actor' ? T.A.groups?.[T.part] : T.kind === 'chunk' ? T.c.group : T.kind === 'mesh' ? T.obj : null;
  if (f) f.updateWorldMatrix(true, false);
  return f || null;
}
const nToLocal = (f, n) => (f ? n.applyMatrix3(_m3.setFromMatrix4(f.matrixWorld).transpose()).normalize() : n);
const nToWorld = (f, n) => (f ? n.applyMatrix3(_m3.getNormalMatrix(f.matrixWorld)).normalize() : n);
const pToLocal = (f, p) => (f ? f.worldToLocal(p) : p);
const pToWorld = (f, p) => (f ? f.localToWorld(p) : p);
/** At most max entries of a path, evenly picked, first and last kept. */
function thin(path, max) {
  if (!path || path.length <= max) return path ? path.slice() : null;
  const out = [];
  for (let i = 0; i < max; i++) out.push(path[Math.round((i / (max - 1)) * (path.length - 1))]);
  return out;
}

export class BladeCutter {
  /**
   * weapon: the Melee holding it (mesh, def, owner, ctx). opts: base / tip (along the weapon's
   * +Y), thickness (m), edges (1: +Z only, 2: both), power (how hard it bites), minSpeed (m/s).
   */
  constructor(weapon, { base, tip, thickness = 0.012, edges = 1, power = 1, minSpeed = 3 } = {}) {
    this.w = weapon;
    this.thickness = thickness; this.edges = edges; this.power = power; this.minSpeed = minSpeed;
    // the cutting edge, as two transforms on the weapon (moved / tuned like any other child)
    this.bladeBase = new THREE.Object3D(); this.bladeBase.name = 'BladeBase'; this.bladeBase.position.set(0, base, 0);
    this.bladeTip = new THREE.Object3D(); this.bladeTip.name = 'BladeTip'; this.bladeTip.position.set(0, tip, 0);
    weapon.mesh.add(this.bladeBase, this.bladeTip);
    this.a = V(); this.b = V(); this.a0 = null; this.b0 = V();
    this.baseVel = V(); this.tipVel = V(); this.handVel = V();
    this.cuts = new Map();      // target key -> cut in progress
    this.holdDir = V();         // the way into what's holding it back (hold)
    this.drag = 0;              // 0..1 how hard the blade's being held back right now (BladeCutter.resist)
    this.trace = { sweeps: [], planes: [], points: [] }; // (Debug.js)
  }

  get ctx() { return this.w.ctx; }
  reset() { this.a0 = null; this.p0 = null; this.cuts.clear(); this.drag = 0; }

  /** 0..1: how much of the stroke the flesh it's in is holding back right now. */
  hold() {
    let h = 0;
    for (const C of this.cuts.values()) if (C.mode === 'cut' && C.T.kind === 'actor' && C.hold && C.hold >= h) { h = C.hold; if (C.inW) this.holdDir.copy(C.inW); }
    return h;
  }

  /** The edge's world-space direction the weapon cuts toward (+Z of the weapon). */
  edgeDir(out) { return this.edgeAt ? out.copy(this.edgeAt) : out.set(0, 0, 1).transformDirection(this.w.mesh.matrixWorld); }

  /**
   * One step: read the edge, sweep it, follow every cut. live: the blade's being swung / held
   * (false: carried, dropped). handVel: the holding hand's velocity, if known.
   */
  step(dt, { live = true, handVel = null } = {}) {
    const m = this.w.mesh;
    m.updateMatrixWorld(true);
    m.matrixWorld.decompose(_wp, _wq, _ws);
    this.bladeBase.getWorldPosition(this.a); this.bladeTip.getWorldPosition(this.b);
    if (handVel) this.handVel.copy(handVel);
    if (!this.a0 || !this.p0 || dt <= 0) { this.remember(); return; }
    const a1 = this.a.clone(), b1 = this.b.clone(), p1 = _wp.clone(), q1 = _wq.clone(), sc = _ws.clone();
    this.drag = Math.max(0, this.drag - dt * 6);
    // a fast stroke covers a lot of ground (and turns a lot) between two frames: it's swept in
    // substeps along the weapon's own motion - its position eased, its rotation slerped - so the
    // edge follows the real arc, and every cut gets a plane, a contact and a path point per bit
    // of it rather than one straight chord across the whole frame
    const travel = Math.max(this.a0.distanceTo(a1), this.b0.distanceTo(b1));
    const N = clamp(Math.ceil(Math.max(travel / SUB_LEN, this.q0.angleTo(q1) / SUB_ANG)), 1, SUB_MAX);
    const h = dt / N, on = live && dismemberOn();
    const pa = this.a0.clone(), pb = this.b0.clone();
    for (let i = 1; i <= N; i++) {
      if (i === N) { this.a.copy(a1); this.b.copy(b1); this.edgeAt = null; }
      else {
        const t = i / N;
        _sp.lerpVectors(this.p0, p1, t); _sq.slerpQuaternions(this.q0, q1, t);
        _sm.compose(_sp, _sq, sc);
        this.a.copy(this.bladeBase.position).applyMatrix4(_sm);
        this.b.copy(this.bladeTip.position).applyMatrix4(_sm);
        this.edgeAt = _eo.set(0, 0, 1).applyQuaternion(_sq);
      }
      this.baseVel.subVectors(this.a, pa).divideScalar(h).clampLength(0, 45);
      this.tipVel.subVectors(this.b, pb).divideScalar(h).clampLength(0, 45);
      if (on) {
        const seen = new Set();
        this.sweepActors(pa, pb, this.a, this.b, h, seen);
        this.sweepChunks(pa, pb, this.a, this.b, h, seen);
        this.sweepMeshes(pa, pb, this.a, this.b, h, seen);
        // anything that was being cut but wasn't met at all this substep: the blade's left it
        for (const [k, C] of this.cuts) if (!seen.has(k)) this.exit(C, h);
        if (this.ctx.debugSlice) this.trace.sweeps.push([pa.clone(), pb.clone(), this.a.clone(), this.b.clone()]);
      } else for (const C of this.cuts.values()) this.exit(C, h, true);
      pa.copy(this.a); pb.copy(this.b);
      // (stalled / stabbed in: it's stuck in them now, fixed to the part - no more sweeping)
      if (this.w.stuckIn || !this.a0) break;
      if (!on) break;
    }
    this.edgeAt = null;
    // (where the weapon really is now, for the next step)
    m.updateMatrixWorld(true);
    m.matrixWorld.decompose(_wp, _wq, _ws);
    this.bladeBase.getWorldPosition(this.a); this.bladeTip.getWorldPosition(this.b);
    if (this.a0) this.remember();
  }

  remember() {
    (this.a0 ||= V()).copy(this.a); this.b0.copy(this.b);
    (this.p0 ||= V()).copy(_wp); (this.q0 ||= new THREE.Quaternion()).copy(_wq);
  }

  /** The velocity of the edge at s (0 base .. 1 tip). */
  velAt(s, out) { return out.lerpVectors(this.baseVel, this.tipVel, s); }

  // ---- what's being swept: people ----
  sweepActors(a0, b0, a1, b1, dt, seen) {
    const self = this.w.owner, r0 = this.thickness * 0.5, res = {};
    for (const A of this.ctx.actors || []) {
      if (A === self || !A.rd || !A.groups || A.hero.shown === false || A.god) continue;
      const c = A.mode === 'ragdoll' ? A.rd.pos('pelvis', _p) : _p.copy(A.hero.pos).setY(A.hero.pos.y + 0.9);
      if (c.distanceToSquared(a1) > 4 && c.distanceToSquared(b1) > 4) continue;
      if (A.mode !== 'ragdoll') A.hero.root.updateMatrixWorld(true);
      for (const name of A.rd.names) {
        const P = A.rd.parts[name];
        if (P.gone) continue;
        const cap = capsuleOf(A, name);
        if (!cap) continue;
        if (A.mode === 'ragdoll' && !A.remote) { A.rd.pos(name, _p); A.rd.quat(name, _q); }
        else { const g = A.groups[name]; g.getWorldPosition(_p); g.getWorldQuaternion(_q); }
        _pa.copy(cap.a).applyQuaternion(_q).add(_p);
        _pb.copy(cap.b).applyQuaternion(_q).add(_p);
        const R = cap.r + r0;
        // first line across the sweep that meets it; and whether the current edge is still in it
        let first = -1, s = 0, hitAt = null, axisAt = null;
        for (let i = 0; i <= SAMPLES; i++) {
          const k = i / SAMPLES;
          _A.lerpVectors(a0, a1, k); _B.lerpVectors(b0, b1, k);
          if (closest(_A, _B, _pa, _pb, _c1, _c2, res) < R) { first = k; s = res.s; hitAt = _c1.clone(); axisAt = _c2.clone(); break; }
        }
        if (first < 0) continue;
        const d = closest(a1, b1, _pa, _pb, _c1, _c2, res);
        const insideNow = d < R;
        // where the edge is in it: on the current edge line if it's still in, else where it met it
        const contact = insideNow ? _c1.clone() : hitAt;
        const axisPt = insideNow ? _c2.clone() : axisAt;
        if (insideNow) s = res.s;
        const part = TORSO.has(name) ? this.torsoPart(A, name, contact) : name;
        const key = (A._cutId ||= ++cutIds) + ':' + part;
        seen.add(key);
        this.touch(key, {
          kind: 'actor', A, part, contact, s, insideNow, first, dt,
          radius: cap.r, axisDist: d, axisPt, sl: limbOf(name),
        });
      }
    }
  }

  torsoPart(A, name, point) {
    const sp = A.groups.spine;
    if (!sp) return name;
    sp.updateWorldMatrix(true, false);
    return sp.worldToLocal(point.clone()).y > 0.235 ? 'chest' : 'spine';
  }

  // ---- loose body parts lying / flying about (slice.js chunks) ----
  sweepChunks(a0, b0, a1, b1, dt, seen) {
    const D = this.ctx.dismember;
    if (!D?.chunks?.length) return;
    for (const c of D.chunks) {
      if (!c.body || !c.cols?.length) continue;
      const t = c.body.translation();
      _p.set(t.x, t.y, t.z);
      if (_p.distanceToSquared(a1) > 1.5 && _p.distanceToSquared(b1) > 1.5) continue;
      const hit = this.castSweep(a0, b0, a1, b1, (from, dir, len) => {
        let best = null;
        for (const k of c.cols) {
          const toi = k.castRay({ origin: from, dir }, len, true);
          if (toi >= 0 && (!best || toi < best)) best = toi;
        }
        return best;
      });
      if (!hit) continue;
      const key = c;
      seen.add(key);
      const v = c.body.linvel();
      this.touch(key, { kind: 'chunk', c, contact: hit.point, s: hit.s, insideNow: hit.now, first: hit.k, dt,
        radius: 0.06, bodyVel: V(v.x, v.y, v.z), sl: limbOf(c.part) || limbOf('fore') });
    }
  }

  // ---- Sliceable meshes (props, sliced pieces) ----
  sweepMeshes(a0, b0, a1, b1, dt, seen) {
    for (const obj of Sliceable.all) {
      if (!obj.parent || !obj.geometry) { Sliceable.all.delete(obj); continue; }
      if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      obj.updateWorldMatrix(true, false);
      const bs = obj.geometry.boundingSphere, sc = obj.matrixWorld.getMaxScaleOnAxis();
      _p.copy(bs.center).applyMatrix4(obj.matrixWorld);
      const R = bs.radius * sc + this.thickness;
      // cheap reject: the sphere against the swept area's two edge lines and the tip's path
      if (closest(a0, b0, _p, _p, _c1, _c2) > R && closest(a1, b1, _p, _p, _c1, _c2) > R && closest(b0, b1, _p, _p, _c1, _c2) > R) continue;
      const cast = (from, dir, len) => {
        const h = this.rayMesh(obj, from, dir, len);
        return h.length ? h[0] : null;
      };
      // the edge line at moments across the step, and each point of the edge along its own path
      // (what catches the surface when the edge meets it face-on, or runs along inside it)
      const hit = this.castSweep(a0, b0, a1, b1, cast) || this.castPaths(a0, b0, a1, b1, cast);
      const S = Sliceable.of(obj), B = obj.userData.sliceBody;
      const C = this.cuts.get(obj);
      // inside: the edge line crosses its surface, or (already cutting) the edge is still within it
      let now = !!hit?.now;
      if (!now && (C || hit)) { _v.lerpVectors(a1, b1, C ? C.s : hit.s); now = this.inside(obj, _v, bs.radius * sc); }
      if (!hit && !now) continue;
      seen.add(obj);
      const v = B ? B.linvel() : null;
      this.touch(obj, { kind: 'mesh', obj, contact: hit ? hit.point : _v.clone(), s: hit ? hit.s : C.s, insideNow: now, first: hit ? hit.k : 1, dt,
        radius: bs.radius * sc, bodyVel: v ? V(v.x, v.y, v.z) : null, sl: S });
    }
  }

  /** Every distance along a ray at which it crosses obj's surface (either face), nearest first. */
  rayMesh(obj, from, dir, len) {
    _ray.set(from, dir); _ray.far = len; _hits.length = 0;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mt of mats) { mt.userData._side ??= mt.side; mt.side = THREE.DoubleSide; }
    obj.raycast(_ray, _hits);
    for (const mt of mats) mt.side = mt.userData._side;
    const out = [];
    for (const h of _hits) if (!out.some((d) => Math.abs(d - h.distance) < 1e-4)) out.push(h.distance); // (shared edges: once)
    return out.sort((x, y) => x - y);
  }

  /** Is world point pW inside obj's (closed) mesh? Parity: a ray out crosses the surface an odd number of times. */
  inside(obj, pW, radius) {
    return this.rayMesh(obj, pW, _dirOut, radius * 2.5).length % 2 === 1;
  }

  /** Rays along the paths points of the edge took this step (base, ..., tip). Same result as castSweep. */
  castPaths(a0, b0, a1, b1, cast) {
    let best = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const s = i / SAMPLES;
      _A.lerpVectors(a0, b0, s); _B.lerpVectors(a1, b1, s);
      const len = _A.distanceTo(_B);
      if (len < 1e-4) continue;
      const dir = _d.subVectors(_B, _A).divideScalar(len).clone();
      const t = cast(_A.clone(), dir, len);
      if (t === null || (best && t / len >= best.k)) continue;
      best = { point: _A.clone().addScaledVector(dir, t), s, k: t / len, now: false };
    }
    return best;
  }

  /**
   * Rays along the edge at SAMPLES moments across the step (base->tip, and tip->base for a
   * blade that starts inside). cast(from, dir, len) -> distance or null.
   * Returns { point, s, k (first moment that hit), now (the current edge hits) } or null.
   */
  castSweep(a0, b0, a1, b1, cast) {
    let first = null, now = false;
    for (let i = SAMPLES; i >= 0; i--) {
      const k = i / SAMPLES;
      _A.lerpVectors(a0, a1, k); _B.lerpVectors(b0, b1, k);
      const len = _A.distanceTo(_B);
      if (len < 1e-4) continue;
      const dir = _d.subVectors(_B, _A).divideScalar(len).clone();
      let t = cast(_A.clone(), dir, len), s;
      if (t === null) { const t2 = cast(_B.clone(), dir.clone().negate(), len); if (t2 !== null) t = len - t2; }
      if (t === null) continue;
      s = t / len;
      if (i === SAMPLES) now = true;
      first = { point: _A.clone().addScaledVector(dir, t), s, k, now };
    }
    if (first) first.now = now;
    return first;
  }

  // ---- the cut state machine ----
  touch(key, T) {
    const sl = T.sl;
    let C = this.cuts.get(key);
    const vel = this.velAt(T.s, V());
    if (T.bodyVel) vel.sub(T.bodyVel);
    const sp = vel.length();
    const axis = V().subVectors(this.b, this.a).normalize();
    if (!C) {
      // what kind of contact this is: a cut, a stab, or just a blunt knock
      const vd = sp > 1e-4 ? vel.clone().divideScalar(sp) : V();
      const edgeW = this.edgeDir(V());
      const lead = this.edges === 2 ? Math.abs(vd.dot(edgeW)) : vd.dot(edgeW);
      const along = vd.dot(axis), lateral = vel.clone().addScaledVector(axis, -along * sp).length();
      const mode = !sl || !sl.canBeCut || sl.exhausted ? 'blunt'
        : along > STAB_ALONG && lateral < STAB_LATERAL && sp > 1.2 ? 'stab'
        : lead < EDGE_LEAD ? 'blunt'
        : sp < Math.max(this.minSpeed, sl.minCutVelocity) ? 'blunt' : 'cut';
      const F = frameOf(T);
      C = { key, T, mode, F, entry: T.contact.clone(), last: T.contact.clone(), pts: [pToLocal(F, T.contact.clone())], nSum: V(), nLast: null, nLastL: null,
        path: [], push: sp * this.power * (0.6 + 0.4 * Math.max(0, lead)), used: 0, dist: 0, vel: vel.clone(), speed: sp, s: T.s, age: 0 };
      this.cuts.set(key, C);
      const info = sl ? sl.info : TISSUE.flesh;
      if (mode === 'cut') this.ctx.sliceFx?.enter(this, C, info, sp);
      else if (mode === 'stab') this.w.cutterStab?.(C, vel);
      else { this.ctx.sliceFx?.blunt(this, C, info, sp); this.knock(T, vel); }
      if (this.ctx.debugSlice) this.trace.points.push(T.contact.clone());
    }
    C.T = T; C.age += T.dt; C.s = T.s; C.s0 ??= T.s;
    if (C.mode !== 'cut') return;
    // this step's plane: the edge's direction and the way that point of it is moving
    const n = V().crossVectors(axis, vel);
    // how far the edge advanced through it this step: its own motion (relative to the target),
    // across the blade - sliding along its length doesn't take it any deeper
    const across = vel.clone().addScaledVector(axis, -vel.dot(axis)).length();
    // (only the part of the step it was in: from the moment it met it, on the first; about half,
    // on the one it came out)
    const inside = C.age <= T.dt * 1.01 ? 1 - T.first : T.insideNow ? 1 : 0.5;
    const step = across * T.dt * inside;
    // (meshes: the point of the edge that went in, where it is now - it doesn't slide along)
    if (T.kind === 'mesh' || T.kind === 'chunk') T.contact = V().lerpVectors(this.a, this.b, C.s0 ?? T.s);
    const F = C.F;
    if (F?.parent) F.updateWorldMatrix(true, false);
    if (n.lengthSq() > 1e-6) {
      n.normalize();
      // (in the target's own frame: it may have turned since the last step)
      const nL = nToLocal(F, n.clone());
      if (C.nLastL && nL.dot(C.nLastL) < 0) { n.negate(); nL.negate(); } // (one consistent side)
      C.nSum.addScaledVector(nL, Math.max(step, 1e-3));
      C.nLast = n; C.nLastL = nL;
    }
    C.pts.push(pToLocal(F, T.contact.clone()));
    C.last.copy(T.contact);
    C.dist += step;
    C.vel.lerp(vel, 0.5); C.speed = sp;
    if (T.kind === 'actor') {
      const g = T.A.groups[T.part];
      if (g) {
        g.updateWorldMatrix(true, false);
        const la = g.worldToLocal(this.a.clone()), lb = g.worldToLocal(this.b.clone());
        C.path.push({ c: g.worldToLocal(T.contact.clone()), a: lb.sub(la).normalize() });
      }
    }
    // the tissue takes its toll (bone where the edge is close to the part's axis)
    const share = T.kind === 'actor' ? (BONE_SHARE[T.part.replace(/[LR]$/, '')] || 0.3) : 0;
    const bone = T.kind === 'actor' && T.axisDist < T.radius * share;
    const res = sl.resistance + (bone ? TISSUE.bone.resistance : 0);
    C.used += res * step / 0.1 * (T.kind === 'actor' ? (TORSO.has(T.part) ? 1.6 : 1.25) : 1);
    if (bone && !C.bone && T.kind === 'actor') this.ctx.sliceFx?.bone(this, C, T.contact);
    C.bone ||= bone;
    this.drag = Math.max(this.drag, clamp(res / (T.kind === 'actor' ? 9 : 20), 0.1, 1));
    this.ctx.sliceFx?.drag(this, C, sl.info, sp, res);
    this.w.cutterDrag?.(res);
    if (T.kind === 'actor') {
      // held back: flesh takes about a third of the stroke, bone most of it (vr.js / melee.js)
      C.hold = clamp(res / 7, 0.5, 0.95);
      this.openUp(C, T, axis);
      // out of push (or the hand's stopped in it) short of going through: it stays stuck in them
      if (!C.through && C.mode === 'cut' && T.insideNow && C.age > T.dt * 1.5 &&
        (C.used > C.push || (sp < sl.minCutVelocity * 0.5 && C.age > 0.06))) {
        C.mode = 'stalled';
        this.ctx.sliceFx?.stall(this, C, sl.info);
        this.w.cutterStall?.(C);
      }
      return;
    }
    if (T.insideNow && (C.used > C.push || (sp < sl.minCutVelocity * 0.4 && C.age > 0.05))) { C.mode = 'stalled'; this.ctx.sliceFx?.stall(this, C, sl.info); this.w.cutterStall?.(C); return; }
    // a thin thing gone clean through within this one step (in at one moment, out by the last)
    if (!T.insideNow && C.age <= T.dt * 1.01) this.exit(C, T.dt);
  }

  /**
   * Inside a person: how deep the edge is now (along the way in, from where it entered toward
   * and past the bone line), and the body opened up that far, live, along the blade's own path
   * (gash.js: the part's meshes really split and pulled apart into a wound, deeper each step).
   * The path bends: when the swing has turned away from the plane the current opening lies in,
   * that one stays as it is and a new one carries on from here, in the new direction - so the
   * wound follows the curve of the stroke. All the way through: off it comes, there and then.
   */
  openUp(C, T, axis) {
    const A = T.A, g = A.groups[T.part], R = Math.max(T.radius, TORSO.has(T.part) ? 0.11 : 0);
    if (!g) return;
    // the way in: from the entry point toward the bone line (fixed at entry)
    if (!C.inW) {
      C.inW = T.axisPt ? V().subVectors(T.axisPt, C.entry) : C.vel.clone();
      // (met already deep in, a fast swing: the way in is the way the edge was going)
      if (C.inW.length() < T.radius * 0.5) C.inW.copy(C.vel.lengthSq() > 1e-6 ? C.vel : C.inW);
      if (C.inW.lengthSq() < 1e-8) C.inW.set(0, -1, 0);
      C.inW.normalize();
      // the cut starts on the skin: back from the bone line along the way in, one radius
      if (T.axisPt) C.entry = T.axisPt.clone().addScaledVector(C.inW, -R);
      C.depth = 0; C.slits = [];
    }
    // (measured at the point of the edge that went in, where it is now: still right once the
    // edge has come out the far side within a step)
    // (carve: driven on while stuck - the depth's counted shove by shove instead)
    const at = V().lerpVectors(this.a, this.b, C.s0 ?? T.s);
    if (!C.manual) C.depth = Math.max(C.depth, V().subVectors(at, C.entry).dot(C.inW) + this.thickness * 0.5);
    const noCut = !!this.w.def?.noCut;
    const maxK = noCut ? (this.w.def?.maxCut ?? 0.9) : 1;
    const k = clamp(C.depth / (R * 2), 0, maxK);
    const n = C.nLast;
    if (!n || A.remote) { if (k >= 0.92 && !noCut) this.throughNow(C); return; }
    g.updateWorldMatrix(true, false);
    let S = C.slits[C.slits.length - 1];
    // one opening per cut, and it follows the blade: the plane it's on is the stroke's so far
    // (averaged, in the part's frame), bent along the path the edge took through it. When the
    // blade turns in the wound, the opening is re-cut along the new path - one smooth curving
    // cut, the very surface the cut through will follow, never a fan of separate slits
    const nowT = performance.now();
    const turned = S?.gash && C.nLastL && C.F === g && C.path.length > 1 && (S.rebuilds || 0) < 60 &&
      nowT - (S.builtAt || 0) > (S.torso ? 90 : 45) && Math.abs(C.nLastL.dot(S.nTip)) < 0.9985;
    if ((!S || turned) && C.depth > 0.01) {
      const q = g.getWorldQuaternion(new THREE.Quaternion()).invert();
      // the plane: the whole stroke's (local: the part may have turned too), through where it went in
      const nL = C.F === g && C.nSum.lengthSq() > 1e-8 ? C.nSum.clone().normalize() : n.clone().applyQuaternion(q);
      const inL = C.inW.clone().applyQuaternion(q);
      inL.addScaledVector(nL, -inL.dot(nL));
      if (inL.lengthSq() < 1e-6) inL.copy(C.inW).applyQuaternion(q);
      const old = A._slits?.[T.part];
      if (old && !C.slits.includes(old)) { try { closeGash(old); } catch (e) { /* gone */ } delete A._slits[T.part]; }
      const prev = S;
      if (prev?.gash) { try { dropGash(prev); } catch (e) { /* gone */ } }
      S = { A, part: T.part, gen: A.cutGen || 0, k: prev?.k || 0, nextGroove: 0, torso: TORSO.has(T.part), r: R, open: 0.55, kerf: 0.009,
        pL: prev ? prev.pL.clone() : g.worldToLocal(C.entry.clone()), nL, inL: inL.normalize(), nW: n.clone(), k0: k,
        path: thin(C.path, 16), nTip: (C.nLastL || nL).clone(), builtAt: nowT, rebuilds: (prev?.rebuilds || 0) + (prev ? 1 : 0) };
      S.gash = undefined;
      if (openGash(S)) { C.slits = [S]; (A._slits ||= {})[T.part] = S; if (prev) S.shown = false; }
      else { C.slits = []; if (A._slits?.[T.part] === prev) delete A._slits[T.part]; S = null; }
    }
    // this opening as deep as the edge has gone since it began
    if (S?.gash) {
      // (the mesh is cut just as far as the edge has gone, no further - a slit the blade's width)
      const nk = clamp(k, 0.03, noCut ? maxK : 0.95);
      if (nk - S.k > 0.004 || !S.shown) { S.k = Math.max(S.k, nk); S.shown = true; try { updateGash(S); } catch (e) { /* the part's gone */ } }
    }
    // deep enough to open a vessel: it pumps out of the wound with every heartbeat from now on
    if (k > 0.35 && !C.artery && S?.gash && this.ctx.blood?.arteries) {
      C.artery = true;
      this.ctx.blood.arteries.add(A, g, S.pL, S.inL.clone().negate(), 0.45 + k * 0.5, 60);
    }
    // and it pours while the blade's in it
    const now = performance.now();
    if (now - (C.pourT || 0) > 400 && k > 0.1) { C.pourT = now; this.ctx.sliceFx?.bleed(T, T.contact, n, V(0, -1, 0), 0.15 + k * 0.15); }
    // blood out of the opening as the edge goes deeper (every couple of cm of new depth)
    if (C.depth - (C.bledAt || 0) > 0.04) {
      C.bledAt = C.depth;
      this.ctx.sliceFx?.deeper(this, C, T.contact, n, k);
    }
    if (k >= 0.92 && !noCut) this.throughNow(C);
  }

  /**
   * Stuck in them (a stalled cut, or a stab) and shoved on: the weapon's already been moved dd
   * further, edge first (melee.js shove) - the cut goes on that far, the mesh opened to match,
   * and off it comes when it's all the way through. C: the stalled cut, or null (a stab: the
   * cut starts from where the blade is). Returns the cut to carry on with, or null (through / gone).
   */
  carve(C, A, part, dd) {
    this.w.mesh.updateMatrixWorld(true);
    this.bladeBase.getWorldPosition(this.a); this.bladeTip.getWorldPosition(this.b);
    const axis = V().subVectors(this.b, this.a).normalize(), edge = this.edgeDir(V());
    if (!C) {
      if (!A.groups?.[part]) return null;
      const cap = capsuleOf(A, part), mid = V().lerpVectors(this.a, this.b, 0.7);
      C = { key: (A._cutId ||= ++cutIds) + ':' + part, mode: 'cut', entry: mid.clone(), last: mid.clone(), pts: [], nSum: V(), nLast: null, path: [],
        push: 0, used: 0, dist: 0, vel: V(), speed: 1, s: 0.7, s0: 0.7, age: 1, inW: edge.clone(), depth: 0, slits: [],
        T: { kind: 'actor', A, part, contact: mid, s: 0.7, insideNow: true, first: 0, dt: 1 / 60, radius: cap?.r || 0.06, axisDist: 1, sl: limbOf(part) } };
    }
    const T = C.T, g = T.A.groups?.[T.part];
    if (!g || T.A.rd?.parts[T.part]?.gone) return null;
    C.manual = true;
    T.contact = V().lerpVectors(this.a, this.b, C.s0 ?? T.s);
    const n = V().crossVectors(axis, edge);
    if (n.lengthSq() < 1e-8) return C;
    n.normalize();
    if (C.nLast && n.dot(C.nLast) < 0) n.negate();
    C.nLast = n;
    C.depth = (C.depth || 0) + dd;
    C.vel.copy(edge).multiplyScalar(3);
    C.last.copy(T.contact);
    // (the body's moved since the swing: the cut's plane and point as they are now, in the part's frame)
    g.updateWorldMatrix(true, false);
    C.F = g;
    C.pts = [g.worldToLocal(T.contact.clone())]; C.dist = Math.max(C.dist, 1);
    const S = C.slits?.[C.slits.length - 1];
    C.nSum.copy(S?.nL ? S.nL : nToLocal(g, n.clone()));
    C.nLastL = nToLocal(g, n.clone());
    const la = g.worldToLocal(this.a.clone()), lb = g.worldToLocal(this.b.clone());
    C.path.push({ c: g.worldToLocal(T.contact.clone()), a: lb.sub(la).normalize() });
    const keep = C.mode;
    C.mode = 'cut';
    this.ctx.sliceFx?.deeper(this, C, T.contact, n, clamp(C.depth / (Math.max(T.radius, 0.05) * 2), 0, 1));
    this.openUp(C, T, axis);
    if (C.through) return null;
    C.mode = keep === 'done' ? 'stalled' : keep;
    return C;
  }

  /** The edge has come out the far side: cut through along the path, now. */
  throughNow(C) {
    if (C.through) return;
    C.through = true;
    const keep = C.mode;
    C.mode = 'cut';
    this.exit(C, 0);
    C.mode = keep;
    // (still sweeping through what's left: don't start a new cut on the stump this same pass)
    this.cuts.set(C.key, { ...C, mode: 'done', T: C.T });
  }

  closeSlits(C) {
    const A = C.T.A;
    for (const S of C.slits || []) { try { closeGash(S); } catch (e) { /* gone */ } }
    if (A._slits && C.slits?.includes(A._slits[C.T.part])) delete A._slits[C.T.part];
  }

  /** A blunt hit on something loose: it's shoved (people get theirs from melee.js land). */
  knock(T, vel) {
    const B = T.kind === 'mesh' ? T.obj.userData.sliceBody : T.kind === 'chunk' ? T.c.body : null;
    if (!B || vel.lengthSq() < 1) return;
    const k = Math.min(3, B.mass()) * 0.08;
    B.applyImpulseAtPoint({ x: vel.x * k, y: vel.y * k, z: vel.z * k }, { x: T.contact.x, y: T.contact.y, z: T.contact.z }, true);
  }

  /**
   * Start a cut from inside a body part (a blade stabbed / stuck in it, now drawn sideways):
   * the edge's already in, so there's no entry test - it cuts on from here, driven by the hand.
   */
  beginCut(A, part, handSpeed) {
    const key = (A._cutId ||= ++cutIds) + ':' + part;
    const mid = V().lerpVectors(this.a, this.b, 0.6);
    const T = { kind: 'actor', A, part, contact: mid, s: 0.6, insideNow: true, first: 0, dt: 1 / 90, radius: 0.06, axisDist: 0, sl: limbOf(part) };
    const F = frameOf(T);
    this.cuts.set(key, { key, T, mode: 'cut', F, entry: mid.clone(), last: mid.clone(), pts: [pToLocal(F, mid.clone())], nSum: V(), nLast: null, nLastL: null, path: [],
      push: 10 + handSpeed * 6, used: 0, dist: 0, vel: V(), speed: handSpeed, s: 0.6, s0: 0.6, age: 1 });
  }

  /** The blade's left what it was cutting: through (cut it) or not (it stays whole). */
  exit(C, dt, abort = false) {
    this.cuts.delete(C.key);
    if (abort || C.mode !== 'cut') return;
    const T = C.T;
    if (T.kind === 'actor' && this.w.def?.noCut) return;
    if (T.kind === 'actor') {
      // out the far side (most of the way across): the cut goes through along the path it took;
      // drawn back out short of that, the opening stays as it is - a wound to come back to
      const R = Math.max(T.radius, TORSO.has(T.part) ? 0.11 : 0);
      if (!C.through && (C.depth || 0) < R * 2 * 0.8) return;
    }
    // far enough in to have gone through: most of the way across it
    const need = T.kind === 'mesh' ? T.radius * 0.35 : T.radius * 0.9;
    if (C.dist + this.thickness < need && C.pts.length < 3) return;
    // (gathered in the target's own frame: back into the world as it stands now)
    const F = C.F;
    if (F?.parent) F.updateWorldMatrix(true, false);
    const n = C.nSum.lengthSq() > 1e-8 ? nToWorld(F, C.nSum.clone().normalize()) : C.nLast?.clone();
    if (!n || !C.pts.length) return;
    const point = pToWorld(F, C.pts.reduce((s, p) => s.add(p), V()).divideScalar(C.pts.length));
    const vel = C.vel.clone();
    let ok = false;
    const D = this.ctx.dismember;
    if (T.kind === 'actor') {
      this.closeSlits(C);
      ok = !!D?.sever(T.A, T.part, point, n, vel.clone().multiplyScalar(0.8), { path: C.path.length > 1 ? C.path : null });
      if (ok && T.A.rd.parts[T.part]?.gone) limbLost(T.A, T.part); // (a slab off isn't a limb off)
    }
    else if (T.kind === 'chunk') ok = D?.chunks.includes(T.c) && !!D.split(T.c, point, n, vel, null);
    else if (T.kind === 'mesh') { this.ctx.slicePieces?.request(T.obj, point, n, vel); ok = true; }
    if (this.ctx.debugSlice) this.trace.planes.push({ point: point.clone(), n: n.clone(), t: performance.now() });
    if (ok) this.ctx.sliceFx?.cut(this, C, point, n, vel, T.sl?.info || TISSUE.flesh, T);
  }
}
