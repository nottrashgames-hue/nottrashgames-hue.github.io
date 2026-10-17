import * as THREE from 'three';
import { partNear } from './strike.js';
import { groove } from './saw.js';
import { inkOf } from './inks.js';
import { openGash, updateGash, closeGash } from './gash.js';

/*
  Chopping (choppers: def.chop - hatchet, axe...). A blade that lands edge first doesn't take a limb off in one
  go unless the blow is a truly huge one: it bites in - a real kerf, opened into the meshes
  (saw.js groove), set in the plane the edge came down in and carried with the part - and every
  blow that lands back in that kerf drives it deeper. Bone is the hard part in the middle. Once
  the kerf reaches the far side, the limb comes away along it (slice.js sever: the meshes are
  split for real along that plane).

  The blade can stay wedged in the cut (melee.js stickIn, with .chop on it). In VR you can then
  lean into it - pushing the edge on in, or drawing it along its length - and it keeps cutting
  (vr.js holdStuck -> chopPush) until it's through.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TORSO = new Set(['pelvis', 'spine', 'chest']);
// edge speed (m/s) of a "full" blow for each part: one of these cuts about 40% of the way in
const NEED = { hand: 5, foot: 6, fore: 7, upper: 9.5, head: 9, neck: 7.5, shin: 9.5, thigh: 13, pelvis: 15.5, spine: 15.5, chest: 16.5 };
const SAME = 0.05;      // m: a blow this close to an open kerf's plane lands back in it
const GROOVE_EVERY = 0.06;

const _m = new THREE.Matrix4();

function torsoPart(A, part, point) {
  const kind = part.replace(/[LR]$/, '');
  if (!TORSO.has(kind)) return part;
  const sp = A.groups.spine;
  if (!sp) return part;
  sp.updateWorldMatrix(true, false);
  return sp.worldToLocal(point.clone()).y > 0.235 ? 'chest' : 'spine';
}

/** The open kerf on this part that a blow at world point p lands in (or null). */
function kerfAt(A, part, g, p) {
  const S = A._chopProg?.[part];
  if (!S || S.gen !== (A.cutGen || 0)) return null;
  const P = S.pL.clone().applyMatrix4(g.matrixWorld);
  const n = S.nL.clone().transformDirection(g.matrixWorld);
  const off = V().subVectors(p, P);
  if (Math.abs(off.dot(n)) > SAME || off.length() > S.r * 3 + 0.12) return null;
  return S;
}

/** Bone in the middle: the kerf goes slower through it (not the torso: all soft round the spine). */
const boneK = (S) => (S.torso ? 1 : S.k > 0.3 && S.k < 0.7 ? 0.55 : 1);

/** Deepen kerf S by dk (0..1 of the way through). Returns true if it went through (and the part came off). */
function deepen(m, S, dk, vel, quiet = false) {
  const A = S.A, g = A.groups[S.part];
  if (!g || !(dk > 0)) return false;
  g.updateWorldMatrix(true, false);
  S.k = Math.min(1, S.k + dk * boneK(S));
  const P = S.pL.clone().applyMatrix4(g.matrixWorld);
  const n = S.nL.clone().transformDirection(g.matrixWorld).normalize();
  const inW = S.inL.clone().transformDirection(g.matrixWorld).normalize();
  // the blood of it: more the deeper it goes
  const B = m.ctx.blood?.inked(A);
  if (!quiet || Math.random() < 0.12) B?.spray(P, inW.clone().negate().addScaledVector(n, Math.random() - 0.5).normalize(), 1.4 + dk * 4, Math.round(3 + dk * 14), 0.45, 0.7 + S.k * 0.6);
  m.blood?.add(P, quiet ? dk : 0.3 + dk, inkOf(A));
  if (S.k >= 1) {
    if (A._chopProg) delete A._chopProg[S.part];
    // (the blade out of the kerf first: it isn't cut with them, and stays in your hand)
    if (m.stuckIn?.chop === S) m.unstick(false, true);
    closeGash(S);
    const done = m.ctx.dismember?.sever(A, S.part, P, n, vel || inW.clone().multiplyScalar(3));
    if (done) {
      m.ctx.sfx?.('chop', 0.9, { rate: 0.85 });
      m.ctx.sfx?.('flesh', 0.9, { rate: 0.7 });
      for (let i = 0; i < 2; i++) B?.spray(P, inW.clone().negate().add(V(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5)).normalize(), 2.5, 12, 0.5, 1);
    }
    return !!done;
  }
  // the kerf, opened for real: the meshes split along it and pulled apart into a V (gash.js)
  if (S.gash === undefined) S.gash = openGash(S) ? S.gash : null;
  if (S.gash) {
    if (S.k >= S.nextGroove) { S.nextGroove = S.k + 0.02; updateGash(S); }
    return false;
  }
  // (the torso: a trench, along the line the edge lies in)
  if (S.k >= S.nextGroove) {
    S.nextGroove = S.k + GROOVE_EVERY;
    const along = V().crossVectors(n, inW);
    groove(A, S.part, S, g, along.lengthSq() > 1e-6 ? along.normalize() : n);
  }
  return false;
}

/**
 * A chopping blade landed on hit.part: edge first, it cuts in (a new kerf, or deeper into the one
 * it landed in). Returns null (the flat or the back: no cut), or { through, S } - S the kerf, for
 * the blade to wedge into.
 */
export function chopHit(m, hit, vel, axis, edge, power = 1) {
  const A = hit.actor;
  if (!A?.groups || !A.rd) return null;
  const part = torsoPart(A, hit.part, hit.point);
  const kind = part.replace(/[LR]$/, '');
  const need = NEED[kind];
  const g = A.groups[part];
  if (!need || !g) return null;
  const sp = vel.length();
  if (sp < 2) return null;
  const vd = vel.clone().divideScalar(sp);
  const d = m.def;
  const lead = d.edges === 2 ? Math.abs(vd.dot(edge)) : vd.dot(edge);
  if (lead < 0.45) return null;
  g.updateWorldMatrix(true, false);
  const e = sp * power * (d.cleave || 1) * (0.6 + 0.4 * lead) / need;
  let S = kerfAt(A, part, g, hit.point);
  if (!S) {
    const n = V().crossVectors(axis, vd);
    if (n.lengthSq() < 1e-4) return null;
    n.normalize();
    const near = partNear(A, hit.part, hit.point);
    const inv = _m.copy(g.matrixWorld).invert();
    const surf = near?.point || hit.point;
    S = {
      A, part, gen: A.cutGen || 0, k: 0, nextGroove: 0, torso: TORSO.has(kind),
      pL: g.worldToLocal(surf.clone()),
      nL: n.transformDirection(inv),
      inL: (near?.normal || vd).clone().transformDirection(inv),
      r: TORSO.has(kind) ? 0.11 : Math.max(0.03, near?.r || 0.05),
    };
    (A._chopProg ||= {})[part] = S;
  }
  // a blow at a full swing goes about 40% of the way in; a truly huge one (an axe-man's
  // overhead) can still take a forearm or a neck in one
  const dk = clamp(0.4 * Math.pow(e, 1.6), 0, 1.6);
  if (dk < 0.02) return { through: false, S, dk: 0 };
  const through = deepen(m, S, dk, vel.clone().multiplyScalar(0.3));
  return { through, S, dk };
}

/** How deep the edge sits in kerf S (m), for wedging the blade into it. */
export function kerfDepth(S) { return clamp(S.k * S.r * 2, 0.02, S.r * 2); }

/**
 * Wedged in and worked by hand (VR): pushed on in by dIn metres, drawn along its length by
 * dAlong. Returns true when it's through.
 */
export function chopPush(m, S, dIn, dAlong) {
  if (!S || S.k >= 1) return false;
  // pressing straight in takes force; a long draw along the edge slices more easily
  const dk = (Math.max(0, dIn) * 0.9 + Math.abs(dAlong) * 0.35) / (S.r * 2);
  if (dk <= 0) return false;
  S.drawn = (S.drawn || 0) + dk;
  if (S.drawn > 0.05) { m.ctx.sfx?.('flesh', 0.2 + Math.min(0.4, S.drawn), { rate: 0.9 + Math.random() * 0.3 }); S.drawn = 0; }
  return deepen(m, S, dk, null, true);
}
