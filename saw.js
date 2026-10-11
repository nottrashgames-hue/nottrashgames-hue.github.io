import * as THREE from 'three';
import { partNear } from './strike.js';
import { SAW_TEETH } from './meleemodels.js';
import { inkOf } from './inks.js';
import { dentMeshes } from './dent.js';

/*
  The hand saw (melee.js 'saw'). It never lands a blow: each frame its toothed edge is tested
  against every body part, and while the teeth are on someone and being worked along their
  length, the cut deepens - by how far the blade travelled and how hard it's pressed in.
  It takes a lot of strokes: a forearm is a dozen or so, a torso several times that. The cut
  plane is set where it first bit and rides along with the part, so it stays one kerf.
  Physics: the teeth catch - the strokes drag (the returned rate), the body is tugged back and
  forth with them, and it bleeds and opens up as it goes; through, the part comes off (slice.js).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const T = SAW_TEETH;
const N = 7;            // samples along the teeth
const TOUCH = 0.014;    // m: teeth this close to the skin are in it
// metres of stroke (at a firm press) to get through each kind of part
const WORK = { hand: 1.2, foot: 1.6, fore: 2.4, upper: 3.2, shin: 3.2, neck: 2.6, head: 3.4, thigh: 4.4, pelvis: 5.2, spine: 5.2, chest: 5.6 };
const TORSO = new Set(['pelvis', 'spine', 'chest']);
const WOUND_EVERY = 0.14; // of the way through, between fresh tears in the skin

const _a = V(), _b = V(), _p = V(), _q = new THREE.Quaternion(), _s = V();
const GROOVE_EVERY = 0.035; // of the way through, between deepenings of the kerf

/** The kerf, opened a little deeper into the meshes: a narrow trench along the blade's line. */
function groove(A, part, S, g, axis) {
  const W = A.wounds;
  if (!W) return;
  const names = TORSO.has(part) ? ['pelvis', 'spine', 'chest'] : [part];
  const meshes = [...new Set(names.flatMap((n) => W.parts[n]?.meshes || []))];
  if (!meshes.length) return;
  const P = S.pL.clone().applyMatrix4(g.matrixWorld);
  const n = S.inL.clone().transformDirection(g.matrixWorld).normalize();
  const depth = Math.min(S.r * 2.1, 0.006 + S.k * S.r * 2);
  dentMeshes(meshes, P, n, { depth, R: 0.009, axis, len: 8, cap: S.r * 2.2, crumple: 0.25 });
  if (W._posed) for (const c of W._posed.values()) c.frame = -1;
}

/** Where the held saw should be pushed to (world offset): down into its kerf, kept in its plane. */
function settle(m, H, S, g, axis, edge) {
  const want = V();
  if (H && S) {
    // sunk in as deep as it's cut
    want.addScaledVector(edge, Math.min(S.r * 2, S.k * S.r * 2));
    // and held in the kerf's plane once it's bitten (it can't wander sideways out of the cut)
    if (S.k > 0.08) {
      const kn = S.nL.clone().transformDirection(g.matrixWorld);
      const P = S.pL.clone().applyMatrix4(g.matrixWorld);
      const off = -kn.dot(V().subVectors(m._sawPrev, P));
      want.addScaledVector(kn, Math.max(-0.05, Math.min(0.05, off)) * Math.min(1, S.k * 4));
    }
  }
  m.sawOff = (m.sawOff || V()).lerp(want, H ? 0.25 : 0.2);
  if (!Number.isFinite(m.sawOff.x + m.sawOff.y + m.sawOff.z)) m.sawOff.set(0, 0, 0);
  if (!H && m.sawOff.lengthSq() < 1e-6) m.sawOff.set(0, 0, 0);
}

/** The teeth at sample i (world), mesh matrix m. */
function tooth(i, M, out) {
  const t = i / (N - 1);
  return out.set(0, T.y0 + (T.y1 - T.y0) * t, T.z0 + (T.z1 - T.z0) * t).applyMatrix4(M);
}

/** Deepest contact of the teeth with anyone but owner: { A, part, point, depth, s } or null. */
function contact(M, owner, actors) {
  let best = null;
  const mid = tooth((N - 1) / 2, M, V());
  for (const A of actors) {
    if (A === owner || A.god || A.hero.shown === false || !A.rd) continue;
    const c = A.mode === 'ragdoll' ? A.rd.pos('pelvis', _p) : _p.copy(A.hero.pos).setY(A.hero.pos.y + 0.9);
    if (c.distanceToSquared(mid) > 2.2 * 2.2) continue;
    for (const name of A.rd.names) {
      if (A.rd.parts[name]?.gone) continue;
      for (let i = 0; i < N; i++) {
        const P = tooth(i, M, _a);
        const h = partNear(A, name, P);
        if (!h || h.dist > TOUCH) continue;
        const depth = TOUCH - h.dist;
        if (!best || depth > best.depth) best = { A, part: name, point: h.point.clone(), normal: h.normal.clone(), depth, s: i / (N - 1) };
      }
    }
  }
  return best;
}

/**
 * One frame of the saw in melee weapon m (held by owner). live: it's being worked (a stroke on,
 * or a VR hand on it). Returns the rate the strokes run at (1 free, slower in a cut).
 */
export function sawStep(m, owner, dt, actors, live) {
  const ctx = m.ctx, mesh = m.mesh;
  mesh.updateMatrixWorld(true);
  const M = mesh.matrixWorld;
  const mid = tooth((N - 1) / 2, M, V());
  const prev = m._sawPrev;
  m._sawPrev = mid.clone();
  if (!prev || dt <= 0) return 1;
  const vel = mid.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
  if (vel.lengthSq() > 30 * 30) return 1;
  const H = contact(M, owner, actors);
  if (!H) { m._saw = null; settle(m, null, null); return 1; }
  const A = H.A;
  // the blade's length and the way its teeth face (world)
  M.decompose(_p, _q, _s);
  const axis = V(0, 1, 0).applyQuaternion(_q);
  const edge = V(0, 0, 1).applyQuaternion(_q);
  const stroke = vel.dot(axis);            // along the blade: what cuts
  const speed = Math.abs(stroke);
  const press = clamp(0.55 + H.depth / TOUCH * 0.45 + Math.max(0, vel.dot(edge)) * 0.3, 0, 1.4);
  let kind = H.part.replace(/[LR]$/, '');
  let part = H.part;
  if (TORSO.has(kind)) {
    const sp = A.groups.spine;
    if (sp) { sp.updateWorldMatrix(true, false); part = kind = sp.worldToLocal(H.point.clone()).y > 0.235 ? 'chest' : 'spine'; }
  }
  const g = A.groups[part] || A.groups[H.part];
  if (!g) return 1;
  g.updateWorldMatrix(true, false);
  // the kerf: set where it first bit, carried along by the part
  let S = m._saw;
  if (!S || S.A !== A || S.part !== part) {
    const prog = (A._sawProg ||= {});
    const n = V().crossVectors(axis, edge).normalize();
    const old = prog[part];
    S = m._saw = old && old.gen === (A.cutGen || 0) ? old : {
      gen: A.cutGen || 0, k: 0, nextWound: WOUND_EVERY * 0.5,
      pL: g.worldToLocal(H.point.clone()),
      nL: n.transformDirection(new THREE.Matrix4().copy(g.matrixWorld).invert()),
      inL: H.normal.clone().transformDirection(new THREE.Matrix4().copy(g.matrixWorld).invert()),
      r: TORSO.has(part) ? 0.11 : H.r, nextGroove: 0,
    };
    S.A = A; S.part = part; S.travel = 0; S.lastSign = Math.sign(stroke);
    prog[part] = S;
  }
  // the teeth catch: the strokes drag, harder the deeper it's in
  const drag = clamp(0.62 - S.k * 0.2 - H.depth * 8, 0.32, 0.7);
  settle(m, H, S, g, axis, edge);
  if (!live || speed < 0.15) return drag;
  const work = WORK[kind] || 3;
  S.k += speed * dt * press / work;
  S.travel += speed * dt;
  const P = H.point;
  const kerfN = S.nL.clone().transformDirection(g.matrixWorld);
  // each change of direction: the rasp of it, and the body jerked along with the blade
  const sign = Math.sign(stroke);
  if (sign && sign !== S.lastSign) {
    S.lastSign = sign;
    ctx.sfx?.('saw', clamp(0.45 + speed * 0.25, 0.4, 1), { rate: 0.85 + Math.random() * 0.3 + S.k * 0.2 });
    ctx.sfx?.('flesh', 0.18 + S.k * 0.2, { rate: 1.3 + Math.random() * 0.3 });
    m.onSawStroke?.(S.k);
  }
  if (!A.remote && A.mode === 'ragdoll' && !A.pending) {
    const imp = axis.clone().multiplyScalar(stroke * 1.6).addScaledVector(edge, 1.2 * press).clampLength(0, 9);
    A.pending = { imp, part, point: P.clone() };
  }
  // it bleeds as it goes, and the blade comes away wet
  const B = ctx.blood?.inked(A);
  if (B && Math.random() < dt * (6 + S.k * 14)) B.spray(P, axis.clone().multiplyScalar(sign || 1).addScaledVector(edge, -0.6).normalize(), 1 + speed * 0.6, 3, 0.35, 0.6 + S.k * 0.5);
  m.blood?.add(P, dt * 0.6, inkOf(A));
  // the kerf goes deeper into them as it goes
  if (S.k >= S.nextGroove) { S.nextGroove = S.k + GROOVE_EVERY; groove(A, part, S, g, axis); }
  // the skin tears open again every so often (wounds, pain, the stumble - over the network too)
  if (S.k >= S.nextWound) {
    S.nextWound += WOUND_EVERY;
    const into = edge.clone();
    A.struck(H.part, P.clone(), axis.clone().multiplyScalar(stroke).addScaledVector(edge, 1.5), into,
      { kind: 'blade', mass: 0.2, sev: 0.35 + S.k * 0.35, ref: 4, maxImp: 6, axis: axis.clone() }, owner);
  }
  // through
  if (S.k >= 1) {
    const at = S.pL.clone().applyMatrix4(g.matrixWorld);
    // (the kerf is where it first bit; the blade's moved along it since - cut where it is now)
    at.addScaledVector(kerfN, kerfN.dot(V().subVectors(P, at)));
    m._saw = null;
    if (A._sawProg) delete A._sawProg[part];
    const done = ctx.dismember?.sever(A, part, at, kerfN, axis.clone().multiplyScalar(stroke * 0.5));
    if (done) {
      ctx.sfx?.('chop', 0.8, { rate: 0.8 });
      ctx.sfx?.('flesh', 0.9, { rate: 0.7 });
      for (let i = 0; i < 3; i++) B?.spray(at, edge.clone().negate().add(V(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5)).normalize(), 2.5, 12, 0.5, 1);
    }
  }
  return drag;
}
