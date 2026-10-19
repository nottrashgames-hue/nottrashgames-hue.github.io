import * as THREE from 'three';
import { poseArm } from './gun.js';
import { sweep, partNear, parry } from './strike.js';
import { HELD_ITEMS } from './strike.js';
import { buildBat, buildCrowbar, buildMachete, buildLongsword, buildSledge, buildClawHammer, buildHuntingKnife, buildHatchet, buildFireAxe, buildSpear, buildRuler, buildHandSaw, buildPencil } from './meleemodels.js';
import { sawStep } from './saw.js';
import { chopHit, kerfDepth } from './chop.js';
import { settings } from './settings.js';
import { SwingTrail } from './trail.js';
import { WeaponBlood } from './weaponblood.js';
import { BladeCutter } from './slicing/BladeCutter.js';
import { limbOf } from './slicing/Sliceable.js';
import { inkOf } from './inks.js';

/*
  Hand-to-hand: punches with bare fists, and swung melee weapons (bat, crowbar, machete).
  Both are keyframed in the body's own frame (origin at the shoulders, yaw-aligned), eased
  from whatever pose the arms are in when a move starts, and swept against every body part's
  capsule while the strike is live (strike.js), so blows land on people walking, sitting
  or already down.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }; // fast out, soft in
const rnd = (a, b) => a + Math.random() * (b - a);
const UP = V(0, 1, 0);

const _m = new THREE.Matrix4(), _s = V(), _p = V(), _q = Q(), _pole = V(), _yq = Q(), _sh = V();

// ---------------------------------------------------------------------------------------
// Body frame. Keys are written [right, up, forward] from the shoulder line's centre; locally
// that's (x = left, y = up, z = forward) so the frame is a plain yaw rotation (no mirror).
// ---------------------------------------------------------------------------------------
export function bodyFrame(h, o, q) {
  h.hips.getWorldPosition(o);
  o.y += 0.5;
  q.setFromAxisAngle(UP, h.yaw);
}
const L = ([r, u, f], out = V()) => out.set(-r, u, f);

/** Local quaternion for a shaft pointing along `dir`, striking side toward `edge` ([r,u,f]). */
function shaftQ(dir, edge, out = Q()) {
  const y = L(dir).normalize();
  const z = L(edge);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = V().crossVectors(y, z);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}
/** Local quaternion for a fist punching along `dir` (local vector), palm down; side = arm side. */
function fistQ(dir, side, out = Q()) {
  const y = dir.clone().normalize().negate();                // metacarpals along the punch
  const x = V(0, side > 0 ? 1 : -1, 0);                      // palm normal (= -side·X) faces down
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = V().crossVectors(x, y);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}
const key = (p, dir, edge, dur, o = {}) => ({ p: L(p), q: shaftQ(dir, edge), dur, tw: o.tw || 0, bend: o.bend || 0, live: !!o.live });

// hand frames on a shaft (weapon frame): hammer grip, fingers wrapping toward the striking side
function frame(x, y, z, o) { return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o); }
const RIGHT_ON = frame(V(1, 0, 0), V(0, 0, -1), V(0, 1, 0), V(-0.03, 0, -0.072));
// (a one-handed weapon in the left hand: the right grip mirrored across the body - which, for
// this hand frame, is the same basis with the offset flipped)
const LEFT_ON = frame(V(1, 0, 0), V(0, 0, -1), V(0, 1, 0), V(0.03, 0, -0.072));

/** Mirror a body-frame pose across the body's midline (right hand <-> left hand). */
const mirQ = (q) => { q.y = -q.y; q.z = -q.z; return q; };
const mirK = (k) => ({ ...k, p: k.p.clone().setX(-k.p.x), q: mirQ(k.q.clone()), tw: -(k.tw || 0) });
/** A weapon's moves for the left hand (built once per weapon type). */
function leftMoves(def) {
  return (def._L ||= { ready: mirK(def.ready), swings: def.swings.map((S) => S.map(mirK)), low: def.low.map(mirK) });
}
// ---- blocking (RMB with a melee weapon: actor.guard) ----
// the guard: the weapon held up across the front, at chin height, the shaft level and slanted up
// to the left (a two-hander's other hand still on it); the left hand's is the same mirrored
const GUARD = key([0.14, 0.12, 0.34], [-0.92, 0.38, 0.08], [0, 0.2, 1], 0);
const GUARD_L = mirK(GUARD);
/** How far round (from straight ahead) a guard still covers: ~75 degrees each way. */
const GUARD_COS = Math.cos(75 * Math.PI / 180);
/**
 * Does `victim`'s guard stop a blow from `by` (landing at `point`)? On their feet, weapon up,
 * and the blow coming from in front of them.
 */
export function blocks(victim, by, point) {
  if (victim === by) return false; // (your own blow on yourself)
  if (!victim?.guard || victim.mode !== 'anim' || victim.brain?.dead || victim.seat) return false;
  const h = victim.hero, from = (by?.hero?.pos || point);
  const dx = from.x - h.pos.x, dz = from.z - h.pos.z, d = Math.hypot(dx, dz);
  if (d < 1e-3) return true;
  return (dx * Math.sin(h.yaw) + dz * Math.cos(h.yaw)) / d > GUARD_COS;
}
/**
 * A blow caught on the guard, on the victim's side (every copy): a clang, the guard knocked
 * back, a stagger if it was a big one - but no wound, nothing cut, nobody off their feet.
 */
export function guardHit(victim, vel, by, power = 1, sfx) {
  const h = victim.hero;
  const k = clamp(vel.length() / 12, 0.3, 1) * power;
  sfx?.('clang', Math.min(1, 0.5 + 0.5 * k), { rate: 0.9 + Math.random() * 0.25, vary: 0.05 });
  sfx?.('impact', 0.25 + 0.25 * k, { rate: 0.7 });
  victim.guardJolt = Math.min(1, (victim.guardJolt || 0) + 0.5 + 0.4 * k);
  if (victim.remote) return;
  // slid back a little, the way the blow came; a heavy one (a sledge, a charged chop) staggers
  const push = vel.clone().setY(0);
  if (push.lengthSq() > 1e-6) h.vel?.addScaledVector(push.normalize(), 1.2 + 1.8 * k);
  if (k > 1.25 && Math.random() < 0.5) victim.goRagdoll?.('stumble', { balance: 0.85, decay: 0.25 });
  if (by && by !== victim) victim.brain?.hitBy?.(by, null);
}

/**
 * A blow that ran into something held in the way (strike.js parry): it stops there - a clang
 * off the item, the holder shoved back a little the way it came, nobody hurt.
 */
export function parriedBlow(pr, vel, by, power, sfx) {
  const o = pr.owner;
  guardHit(o, vel, by, power, sfx);
  if (o.remote) o.onRemoteHit?.('guard', vel, power, by);
  else o.onGuard?.(by, vel, power);
}

/** Can actor's hand i (0 left, 1 right) hold something? (not hurt out of use, not cut off) */
export function handFree(actor, i) {
  if (actor.organs && !actor.organs.canHold(i)) return false;
  const s = i ? 'R' : 'L', P = actor.rd?.parts;
  return !(P?.['fore' + s]?.gone || P?.['upper' + s]?.gone);
}
/** An actor's held weapon(s) drive the arms: one in each hand, both posed every frame. */
export function armUp(actor) {
  const R = actor.meleeHeld, Lw = actor.meleeHeldL, h = actor.hero;
  if (R && Lw) {
    h.armHook = (h, dt) => {
      R.poseHeld(h, dt);
      const tw = h.twist, bend = h.bend, dip = h.dip;
      Lw.poseHeld(h, dt);
      // the trunk goes with whichever hand is swinging (the later blow, if both are)
      const useR = R.busy ? (!Lw.busy || R.t0 > Lw.t0) : !Lw.busy;
      if (useR) { h.twist = tw; h.bend = bend; h.dip = dip; }
    };
  } else if (R || Lw) h.armHook = (h, dt) => (R || Lw).poseHeld(h, dt);
  else h.armHook = null;
}
const leftOn = (y) => frame(V(1, 0, 0), V(0, 0, -1), V(0, 1, 0), V(0.03, y, -0.072));

export function curl(a, c) {
  a.fingers.forEach(([f1, f2], j) => { f1.rotation.z = -(c + j * 0.05); f2.rotation.z = -(c * 1.1 + j * 0.04); });
  a.thumb[1].rotation.z = -c * 0.5;
}

// ---------------------------------------------------------------------------------------
// Swings
// ---------------------------------------------------------------------------------------
const ONE_READY = key([0.25, -0.4, 0.22], [0.05, 0.75, 0.6], [0, -0.3, 1], 0);
const ONE = [
  // forehand: cocked over the right shoulder, chopped down across the body
  [
    key([0.3, 0.12, -0.05], [0.15, 0.55, -0.8], [0, 0.9, 0.4], 0.2, { tw: -0.4 }),
    key([0.22, 0.14, 0.25], [0.05, 0.95, 0.3], [0, 0.3, 1], 0.06, { tw: -0.1, live: true }),
    key([0.05, -0.12, 0.48], [-0.2, -0.1, 1], [0, -1, 0], 0.06, { tw: 0.35, bend: 0.15, live: true }),
    key([-0.12, -0.4, 0.32], [-0.35, -0.8, 0.45], [0, -0.4, -0.9], 0.1, { tw: 0.5, bend: 0.25, live: true }),
  ],
  // backhand: from the left shoulder out and down to the right
  [
    key([-0.12, 0.08, 0.14], [-0.6, 0.6, -0.5], [0.7, 0.2, 0.6], 0.2, { tw: 0.5 }),
    key([0.0, 0.0, 0.36], [-0.3, 0.3, 0.9], [0.9, -0.2, 0.3], 0.06, { tw: 0.2, live: true }),
    key([0.2, -0.15, 0.42], [0.5, -0.1, 0.85], [0.8, -0.3, -0.4], 0.06, { tw: -0.2, bend: 0.1, live: true }),
    key([0.35, -0.35, 0.2], [0.9, -0.3, -0.1], [0.1, -0.4, -0.9], 0.1, { tw: -0.45, bend: 0.15, live: true }),
  ],
];
const BAT_READY = key([0.16, -0.22, 0.18], [0.15, 0.85, -0.35], [0, 0, 1], 0);
const BAT = [
  // right to left, level, through the front
  [
    key([0.28, 0.0, -0.08], [0.2, 0.45, -0.87], [1, 0, 0], 0.28, { tw: -0.55 }),
    key([0.2, -0.2, 0.2], [0.9, 0.1, -0.2], [0, 0, 1], 0.07, { tw: -0.2, live: true }),
    key([0.02, -0.25, 0.42], [0.1, 0.05, 1], [-1, 0, 0], 0.07, { tw: 0.3, live: true }),
    key([-0.22, -0.15, 0.25], [-0.95, 0.2, 0.1], [0, 0, -1], 0.12, { tw: 0.65, live: true }),
  ],
  // and back again, left to right
  [
    key([-0.2, -0.05, 0.05], [-0.6, 0.5, -0.6], [-1, 0, 0], 0.26, { tw: 0.5 }),
    key([-0.15, -0.2, 0.25], [-0.95, 0.05, 0.1], [0, 0, 1], 0.07, { tw: 0.25, live: true }),
    key([0.05, -0.25, 0.42], [0.1, 0, 1], [1, 0, 0], 0.07, { tw: -0.2, live: true }),
    key([0.25, -0.15, 0.25], [0.95, 0.15, 0.1], [0, 0, -1], 0.12, { tw: -0.55, live: true }),
  ],
];

// low sweeps (crouched): bent over, level through the shins
const BAT_LOW = [
  key([0.3, -0.22, -0.05], [0.4, -0.5, -0.75], [1, 0, 0], 0.26, { tw: -0.5, bend: 0.35 }),
  key([0.2, -0.36, 0.2], [0.85, -0.45, 0.1], [0, 0, 1], 0.07, { tw: -0.2, bend: 0.5, live: true }),
  key([0.0, -0.4, 0.4], [0.1, -0.5, 0.85], [-1, 0, 0], 0.07, { tw: 0.3, bend: 0.55, live: true }),
  key([-0.22, -0.32, 0.25], [-0.85, -0.4, 0.2], [0, 0, -1], 0.12, { tw: 0.6, bend: 0.45, live: true }),
];
const ONE_LOW = [
  key([0.32, -0.2, 0.0], [0.4, -0.3, -0.8], [1, 0, 0], 0.2, { tw: -0.4, bend: 0.3 }),
  key([0.25, -0.38, 0.25], [0.8, -0.5, 0.3], [0, 0, 1], 0.06, { tw: -0.1, bend: 0.5, live: true }),
  key([0.02, -0.42, 0.42], [0.1, -0.5, 0.9], [-1, 0, 0], 0.06, { tw: 0.3, bend: 0.55, live: true }),
  key([-0.2, -0.36, 0.25], [-0.8, -0.5, 0.2], [0, 0, -1], 0.1, { tw: 0.5, bend: 0.45, live: true }),
];

// stabs (the hunting knife): drawn back by the hip, then driven straight in point first and
// held there a beat - one straight in under the ribs, one rising up into the gut
const STAB = [
  [
    key([0.2, -0.3, 0.0], [0, 0.18, 1], [0, -1, 0], 0.13, { tw: -0.3 }),
    key([0.14, -0.2, 0.28], [0, 0.08, 1], [0, -1, 0], 0.045, { tw: -0.05, live: true }),
    key([0.05, -0.13, 0.56], [-0.06, 0.04, 1], [0, -1, 0], 0.05, { tw: 0.22, bend: 0.12, live: true }),
    key([0.05, -0.13, 0.58], [-0.06, 0.04, 1], [0, -1, 0], 0.06, { tw: 0.24, bend: 0.14, live: true }),
  ],
  [
    key([0.22, -0.46, 0.04], [0, 0.55, 0.85], [0, -0.85, 0.5], 0.13, { tw: -0.25, bend: 0.1 }),
    key([0.14, -0.34, 0.3], [0, 0.45, 0.9], [0, -0.9, 0.45], 0.045, { tw: 0, bend: 0.15, live: true }),
    key([0.05, -0.2, 0.52], [-0.05, 0.35, 0.95], [0, -0.95, 0.35], 0.05, { tw: 0.2, bend: 0.2, live: true }),
    key([0.05, -0.19, 0.54], [-0.05, 0.35, 0.95], [0, -0.95, 0.35], 0.06, { tw: 0.22, bend: 0.2, live: true }),
  ],
];
const STAB_LOW = [
  key([0.24, -0.42, 0.0], [0, -0.1, 1], [0, -1, 0], 0.13, { tw: -0.3, bend: 0.35 }),
  key([0.15, -0.44, 0.3], [0, -0.2, 1], [0, -1, 0], 0.045, { tw: -0.05, bend: 0.5, live: true }),
  key([0.05, -0.46, 0.54], [-0.05, -0.3, 1], [0, -1, 0], 0.05, { tw: 0.2, bend: 0.55, live: true }),
  key([0.05, -0.46, 0.56], [-0.05, -0.3, 1], [0, -1, 0], 0.06, { tw: 0.22, bend: 0.55, live: true }),
];
// the saw (hold the button): worked back and forth, blade level ahead with the teeth down -
// a long push out from the hip, a pull back (one key each way; held, it keeps going)
const SAW_READY = key([0.16, -0.3, 0.2], [0, 0.12, 1], [0, -1, 0.12], 0);
const SAW = [[
  key([0.12, -0.32, 0.5], [-0.04, 0.0, 1], [0, -1, 0], 0.32, { tw: 0.15, bend: 0.18, live: true }),
  key([0.14, -0.3, 0.2], [-0.02, 0.04, 1], [0, -1, 0], 0.32, { tw: -0.05, bend: 0.1, live: true }),
]];
const SAW_LOW = [
  key([0.12, -0.62, 0.48], [-0.04, -0.15, 1], [0, -1, 0], 0.34, { tw: 0.15, bend: 0.55, live: true }),
  key([0.14, -0.6, 0.2], [-0.02, -0.12, 1], [0, -1, 0], 0.34, { tw: -0.05, bend: 0.5, live: true }),
];
// a blade that lands (and doesn't go through) sticks in this often, and has to be pulled out
const EMBED_CHANCE = 0.2;

// the overhead chop (hold the button): one continuous arc from cocked back behind the head,
// over the top and down into the floor at your feet, parametrised u = 0..1. It isn't keyed on
// time - it's driven, accelerating as it comes over, and it keeps going until the weapon
// actually meets something (a body, the ground, a kerb, a wall, a car) and stops dead there.
// [right, up, forward] hand position, shaft angle th (0 = straight up, PI/2 = level ahead,
// PI = straight down), trunk bend, knee dip (0..1 of a crouch), twist
const CHOP = [
  // (o: how far a one-handed grip sits out over its own shoulder - clear of the head up top;
  //  o2: where a two-handed grip goes instead [right, up, forward] - up over the right
  //  shoulder and in front of the crown, so the lead arm crosses in front of the face, never
  //  back through the head)
  { p: [0.0, 0.44, -0.1], th: -2.15, bend: -0.22, dip: 0, tw: -0.22, o: 0.09, o2: [0.09, 0.07, 0.13] },
  { p: [0.0, 0.42, 0.14], th: -0.4, bend: -0.06, dip: 0.04, tw: -0.1, o: 0.07, o2: [0.06, 0.06, 0.06] },
  { p: [0.0, 0.12, 0.44], th: 1.15, bend: 0.26, dip: 0.18, tw: 0, o: 0.02, o2: [0.01, 0, 0] },
  { p: [0.0, -0.26, 0.5], th: 2.1, bend: 0.6, dip: 0.4, tw: 0.04, o: 0, o2: [0, 0, 0] },
  { p: [0.0, -0.58, 0.42], th: 2.85, bend: 0.95, dip: 0.62, tw: 0.08, o: 0, o2: [0, 0, 0] },
];
const LIVE_U = 0.24;   // from here on it can hurt
const HOLD = 0.2;      // held longer than this: it's an overhead chop, not a swing
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const _cp = V(), _cd = V(), _ce = V();
/** The chop's pose at u (local, body frame), r = sideways offset of the hands, drop = extra reach down. */
function chopPose(u, def, out, drop = 0, mir = false) {
  const r = def.chopR, two = def.two !== undefined;
  const n = CHOP.length - 1, x = clamp(u, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x)), t = x - i;
  const K = (j) => CHOP[clamp(j, 0, n)];
  const a = K(i - 1), b = K(i), c = K(i + 1), d = K(i + 2);
  const f = (key) => cr(a[key], b[key], c[key], d[key], t);
  _cp.set(r + (two ? 0 : f('o')) + cr(a.p[0], b.p[0], c.p[0], d.p[0], t), cr(a.p[1], b.p[1], c.p[1], d.p[1], t), cr(a.p[2], b.p[2], c.p[2], d.p[2], t));
  if (two) for (let j = 0; j < 3; j++) _cp.setComponent(j, _cp.getComponent(j) + cr(a.o2[j], b.o2[j], c.o2[j], d.o2[j], t));
  // (drop: how much further down the hands go at the bottom, so it always reaches the floor)
  _cp.y -= drop * smooth((u - 0.45) / 0.55);
  const th = lerp(b.th, c.th, t);
  L(_cp.toArray(), out.p);
  out.q.copy(shaftQ(_cd.set(0.03, Math.cos(th), Math.sin(th)).toArray(), _ce.set(0, -Math.sin(th), Math.cos(th)).toArray()));
  out.bend = f('bend'); out.tw = f('tw'); out.dip = clamp(f('dip'), 0, 1);
  if (mir) { out.p.x = -out.p.x; mirQ(out.q); out.tw = -out.tw; }
  return out;
}

export const WEAPONS = {
  bat: { build: buildBat, two: -0.1, ready: BAT_READY, swings: BAT, low: BAT_LOW, back: 0.45, chopR: 0.02,
    hit: { kind: 'blunt', mass: 4.5, sev: 1.3, ref: 13, maxImp: 110 }, seg: [0.2, 0.69], r: 0.034, sound: 'bat', ground: 'wood', stuck: 0.1, bounce: 0.07,
    box: [0.034, 0.43, 0.034], off: V(0, 0.27, 0), rest: 0.034, massKg: 0.9 },
  crowbar: { build: buildCrowbar, ready: ONE_READY, swings: ONE, low: ONE_LOW, back: 0.35, chopR: 0.12,
    hit: { kind: 'blunt', mass: 3.2, sev: 1.2, ref: 11, maxImp: 85 }, seg: [0.12, 0.5], r: 0.022, sound: 'crowbar', ground: 'clang', stuck: 0.12, bounce: 0.05,
    box: [0.014, 0.33, 0.06], off: V(0, 0.16, -0.04), rest: 0.012, massKg: 1.4 },
  // edges: sharp on one side (+Z) or both; cleave: how readily it goes right through a limb
  // (the machete: cut by the blade's real sweep through the mesh - slicing/BladeCutter.js; none of the paths below)
  machete: { build: buildMachete, ready: ONE_READY, swings: ONE, low: ONE_LOW, back: 0.32, chopR: 0.12, edges: 1, cleave: 1, cutter: true, carve: true,
    hit: { kind: 'blade', mass: 2.2, sev: 1.05, ref: 10, maxImp: 60 }, seg: [0.1, 0.54], r: 0.022, sound: 'chop', ground: 'chop', stuck: 0.3, bounce: 0.012,
    box: [0.012, 0.3, 0.028], off: V(0, 0.22, 0.012), rest: 0.017, massKg: 0.6 },
  // two-handed: right hand under the guard, left toward the pommel; long level cuts
  longsword: { build: buildLongsword, two: -0.13, ready: BAT_READY, swings: BAT, low: BAT_LOW, back: 0.42, chopR: 0.02, edges: 2, cleave: 1.35,
    hit: { kind: 'blade', mass: 3.6, sev: 1.3, ref: 12, maxImp: 95 }, seg: [0.09, 1.0], r: 0.02, sound: 'chop', ground: 'chop', stuck: 0.22, bounce: 0.015,
    box: [0.014, 0.62, 0.035], off: V(0, 0.4, 0), rest: 0.02, massKg: 1.5 },
  // all the weight at the far end: slow to come round, and it lands like a car door
  sledge: { build: buildSledge, two: -0.13, ready: BAT_READY, swings: BAT, low: BAT_LOW, back: 0.6, chopR: 0.02,
    hit: { kind: 'blunt', mass: 7.5, sev: 1.65, ref: 15, maxImp: 160 }, seg: [0.52, 0.72], r: 0.05, sound: 'crowbar', ground: 'clang', stuck: 0.14, bounce: 0.06,
    box: [0.03, 0.42, 0.1], off: V(0, 0.26, 0), rest: 0.028, massKg: 4.5 },
  hammer: { build: buildClawHammer, ready: ONE_READY, swings: ONE, low: ONE_LOW, back: 0.3, chopR: 0.12,
    hit: { kind: 'blunt', mass: 2.4, sev: 1.15, ref: 10, maxImp: 70 }, seg: [0.19, 0.27], r: 0.028, sound: 'crowbar', ground: 'clang', stuck: 0.1, bounce: 0.05,
    box: [0.014, 0.18, 0.08], off: V(0, 0.07, 0), rest: 0.014, massKg: 0.7 },
  // stabs, point first; it never cuts a limb off (noCut)
  // (point first and fast enough it goes in and stays in - little shove: it pierces, it doesn't knock about)
  // (a cutter too: slashes and stabs open real cuts in the mesh, shallow (maxCut: how far in, of the limb's thickness) and following the stroke in
  // 3D - carve - but never right through; stuck in, a fresh shove drives it on - melee.js shove)
  knife: { build: buildHuntingKnife, ready: ONE_READY, swings: [ONE[0], STAB[0], ONE[1], STAB[1]], low: STAB_LOW, back: 0.2, chopR: 0.12, edges: 1, cleave: 0.45, stab: true, noCut: true, maxCut: 0.22, cutter: true, carve: true,
    hit: { kind: 'blade', mass: 0.45, sev: 1.1, ref: 7, maxImp: 14 }, seg: [0.06, 0.25], r: 0.015, sound: 'chop', ground: 'chop', stuck: 0.35, bounce: 0.01,
    box: [0.012, 0.16, 0.025], off: V(0, 0.095, 0.004), rest: 0.012, massKg: 0.3 },
  // a pencil: stabbed in like the knife, point first - shorter, blunter, it goes in less readily and hurts less
  pencil: { build: buildPencil, ready: ONE_READY, swings: STAB, low: STAB_LOW, back: 0.18, chopR: 0.12, edges: 1, cleave: 0.2, stab: true, noCut: true,
    hit: { kind: 'blade', mass: 0.3, sev: 0.8, ref: 7, maxImp: 10 }, seg: [0.07, 0.133], r: 0.008, sound: 'chop', ground: 'chop', stuck: 0.3, bounce: 0.01,
    box: [0.006, 0.097, 0.006], off: V(0, 0.036, 0), rest: 0.006, massKg: 0.01 },
  hatchet: { build: buildHatchet, ready: ONE_READY, swings: ONE, low: ONE_LOW, back: 0.33, chopR: 0.12, edges: 1, cleave: 1.15,
    hit: { kind: 'blade', mass: 2.8, sev: 1.15, ref: 10.5, maxImp: 72 }, seg: [0.23, 0.33], r: 0.03, sound: 'chop', ground: 'chop', stuck: 0.4, bounce: 0.012,
    box: [0.016, 0.21, 0.06], off: V(0, 0.1, 0.025), rest: 0.016, massKg: 0.9 },
  fireaxe: { build: buildFireAxe, two: -0.14, ready: BAT_READY, swings: BAT, low: BAT_LOW, back: 0.52, chopR: 0.02, edges: 1, cleave: 1.7,
    hit: { kind: 'blade', mass: 5.5, sev: 1.5, ref: 13.5, maxImp: 135 }, seg: [0.55, 0.78], r: 0.035, sound: 'chop', ground: 'chop', stuck: 0.45, bounce: 0.015,
    box: [0.02, 0.48, 0.1], off: V(0, 0.28, 0.02), rest: 0.02, massKg: 2.8 },
  // a half-metre wooden ruler: light and whippy - it stings more than it breaks anything
  ruler: { build: buildRuler, ready: ONE_READY, swings: ONE, low: ONE_LOW, back: 0.3, chopR: 0.12,
    hit: { kind: 'blunt', mass: 0.9, sev: 0.6, ref: 9, maxImp: 28 }, seg: [0.05, 0.45], r: 0.016, sound: 'wood', ground: 'wood', stuck: 0.08, bounce: 0.09,
    box: [0.003, 0.25, 0.018], off: V(0, 0.2, 0), rest: 0.003, massKg: 0.15 },
  // a hand saw: does nothing in a swing - worked back and forth against someone, it slowly
  // cuts its way through (saw.js)
  saw: { build: buildHandSaw, ready: SAW_READY, swings: SAW, low: SAW_LOW, back: 0.2, chopR: 0.12, edges: 1, cleave: 0, saw: true, noCut: true, noGuard: true,
    hit: { kind: 'blade', mass: 0.8, sev: 0.4, ref: 8, maxImp: 20 }, seg: [0.07, 0.56], r: 0.02, sound: 'saw', ground: 'saw', stuck: 0.1, bounce: 0.01,
    box: [0.012, 0.3, 0.06], off: V(0, 0.26, 0.03), rest: 0.012, massKg: 0.65 },
  // the longest reach there is: only the leaf at the end cuts
  spear: { build: buildSpear, two: -0.3, ready: BAT_READY, swings: BAT, low: BAT_LOW, back: 0.45, chopR: 0.02, edges: 2, cleave: 0.9,
    hit: { kind: 'blade', mass: 2.6, sev: 1.25, ref: 12, maxImp: 90 }, seg: [1.1, 1.52], r: 0.022, sound: 'chop', ground: 'chop', stuck: 0.4, bounce: 0.012,
    box: [0.017, 0.94, 0.03], off: V(0, 0.585, 0), rest: 0.017, massKg: 1.9 },
};

/** Shared: run a keyed move, returns { p, q, tw, bend, live } (local) at time t. */
function sample(keys, t, out) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].dur) { t -= keys[i + 1].dur; i++; }
  const a = keys[i], b = keys[i + 1];
  const k = b.dur > 0 ? clamp(t / b.dur, 0, 1) : 1;
  // strikes go through at full speed (no easing to stall between their keys); the rest ease in and out
  const e = b.live ? k : smooth(k);
  out.p.lerpVectors(a.p, b.p, e);
  out.q.slerpQuaternions(a.q, b.q, e);
  out.tw = lerp(a.tw, b.tw, e);
  out.bend = lerp(a.bend, b.bend, e);
  out.live = b.live;
  return out;
}
const total = (keys) => keys.reduce((s, k, i) => s + (i ? k.dur : 0), 0);
const _pitchQ = Q(), _X = V(1, 0, 0), _to = V();
const _pose = { p: V(), q: Q(), tw: 0, bend: 0, dip: 0 };
const _tc = { p: V(), q: Q() };
const _v1 = V();
let _invR = null, _invL = null;

// ---------------------------------------------------------------------------------------
// A melee weapon lying about, picked up, swung, dropped
// ---------------------------------------------------------------------------------------
export class Melee {
  constructor(type, scene, debris, ctx, rest) {
    this.type = type;
    this.def = WEAPONS[type];
    this.wtype = type;
    this.scene = scene;
    this.debris = debris;
    this.ctx = ctx; // { actors, sfx, aimPoint, hitWorld, castSeg, shake, blood, player, aiming }
    this.mesh = this.def.build();
    scene.add(this.mesh);
    this.rest = { pos: rest.pos.clone(), quat: rest.quat.clone() };
    this.mesh.position.copy(rest.pos);
    this.mesh.quaternion.copy(rest.quat);
    this.state = 'rest';
    this.owner = null;
    this.loose = null;
    this.pickT = 0;
    this.swing = null;       // keyed: { keys, t, dur, hit: Set }
    this.chop = null;        // driven overhead chop: { phase, u, w, charge, ... }
    this.btn = null;         // attack button held: { t }
    this.nextSwing = 0;      // alternates forehand / backhand
    this.hand = 1;           // which hand it's in: 1 right, 0 left (dual-wielding)
    this.t0 = 0;             // when the current blow started
    this.queued = false;
    this.cur = { p: V(), q: Q(), tw: 0, bend: 0, live: false };
    this.local = { p: V(), q: Q() }; // last pose in the body frame
    this.prevSeg = null;
    this.stop = 0;           // hit-stop
    this.pitch = 0;          // swings tilted toward where you aim
    this.lastPos = V();
    this.vel = V();
    this.tipVel = V();
    this.O = V(); this.yq = Q();
    this.trail = new SwingTrail(scene);
    this.blood = new WeaponBlood(this.mesh, this.def, ctx.blood);
    // (def.cutter: the edge from BladeBase to BladeTip, cutting wherever it really goes - slicing/)
    if (this.def.cutter) this.cutter = new BladeCutter(this, { base: this.def.seg[0], tip: this.def.seg[1] + 0.02, thickness: this.def.r,
      edges: this.def.edges || 1, power: this.def.cleave || 1, minSpeed: 1.6 });
    // (stuck in someone, it's a child of their part: never cut along with them - slice.js)
    this.mesh.userData.notBody = true;
    this.mesh.userData.melee = this; // (wounds.js: what's stuck in a body, and how deep)
    HELD_ITEMS.add(this); // (held up in the way, it stops blows: strike.js parry)
  }

  /** Back on the table where it started. Call after debris.clear(). */
  reset() {
    const actor = this.owner;
    if (actor) {
      if (actor.meleeHeld === this) actor.meleeHeld = null;
      if (actor.meleeHeldL === this) actor.meleeHeldL = null;
      // (the other hand's weapon, if any, goes to the right)
      const o = actor.meleeHeldL;
      if (o && !actor.meleeHeld && handFree(actor, 1)) o.toHand(1);
      else armUp(actor);
      actor.hero.twist = actor.hero.bend = actor.hero.dip = 0;
    }
    this.hand = 1;
    this.owner = null;
    this.loose = null;
    this.embed = null;
    this.stuckIn = null;
    this.state = 'rest';
    this.swing = this.chop = this.btn = null;
    this.queued = false;
    this.stop = 0;
    this.trail.cut();
    this.blood.clear();
    if (this.mesh.parent !== this.scene) this.scene.add(this.mesh);
    this.mesh.position.copy(this.rest.pos);
    this.mesh.quaternion.copy(this.rest.quat);
  }

  /** Gone for good (an arena fighter's weapon, with them): out of the scene and every list. */
  dispose() {
    if (this.loose) { this.debris.release?.(this.loose); this.loose = null; }
    this.reset();
    this.mesh.removeFromParent();
    this.trail.cut();
    this.trail.mesh?.removeFromParent?.();
    this.cutter?.reset?.();
    HELD_ITEMS.delete(this);
  }

  /** The ready pose / swings for the hand it's in. */
  get ready() { return this.hand ? this.def.ready : leftMoves(this.def).ready; }
  get moves() { return this.hand ? this.def : leftMoves(this.def); }
  get arm() { return this.owner.hero.arms[this.hand]; }
  get gripOn() { return this.hand ? RIGHT_ON : LEFT_ON; }
  /** The weapon in the owner's other hand, if they've one in each. */
  get pair() { const A = this.owner; return A ? (this.hand ? A.meleeHeldL : A.meleeHeld) : null; }

  worldPos(out = V()) { return this.mesh.localToWorld(out.copy(this.def.off)); }
  get busy() { return !!(this.swing || this.chop || this.stuckIn); }
  /** Winding up / brought up overhead, waiting on the button. */
  get cocked() { return this.chop?.phase === 'cock'; }

  /** Into actor's hand (1 right - the default -, 0 left: the second of a pair). */
  pick(actor, hand = 1) {
    // (stuck in someone: pulled back out of them)
    if (this.embed) { this.embed = null; this.scene.attach(this.mesh); }
    this.pickFrom = { pos: this.mesh.position.clone(), quat: this.mesh.quaternion.clone() };
    if (this.loose) { this.debris.release(this.loose); this.loose = null; }
    this.state = 'held';
    this.owner = actor;
    this.hand = hand;
    if (hand) actor.meleeHeld = this; else actor.meleeHeldL = this;
    this.pickT = 0;
    this.swing = this.chop = this.btn = null;
    this.queued = false;
    this.cur.p.copy(this.ready.p); this.cur.q.copy(this.ready.q);
    this.cur.tw = this.cur.bend = 0;
    this.prevSeg = null;
    armUp(actor);
    this.ctx.sfx?.('pickup', 0.6);
  }
  /** Changes hands (the right one's gone: the left one's weapon is passed over to it). */
  toHand(hand) {
    const A = this.owner;
    if (!A || this.hand === hand) return;
    if (A.meleeHeld === this) A.meleeHeld = null;
    if (A.meleeHeldL === this) A.meleeHeldL = null;
    this.pickFrom = { pos: this.mesh.position.clone(), quat: this.mesh.quaternion.clone() };
    this.hand = hand;
    if (hand) A.meleeHeld = this; else A.meleeHeldL = this;
    this.swing = this.chop = this.btn = null;
    this.queued = false;
    this.pickT = 0.35; // (already in hand: just passed across)
    this.cur.p.copy(this.ready.p); this.cur.q.copy(this.ready.q);
    this.prevSeg = null;
    this.trail.cut();
    armUp(A);
  }

  /** Let go of it (keepPair: one in the other hand stays there, rather than passed across). */
  drop(keepPair = false) {
    const actor = this.owner;
    if (!actor) return;
    // let go of it while it's stuck in someone: it stays in them (throw.js holds it there)
    const S = this.stuckIn;
    this.stuckIn = null;
    actor.hero.twist = actor.hero.bend = actor.hero.dip = 0;
    if (actor.meleeHeld === this) actor.meleeHeld = null;
    if (actor.meleeHeldL === this) actor.meleeHeldL = null;
    this.owner = null;
    this.hand = 1;
    // (dropped the right one with one in the left too: that goes across to the right hand)
    const o = actor.meleeHeldL;
    if (o && !actor.meleeHeld && !keepPair && handFree(actor, 1)) o.toHand(1);
    else armUp(actor);
    this.state = 'loose';
    this.swing = this.chop = this.btn = null;
    this.trail.cut();
    this.cutter?.reset();
    if (S && this.ctx.throws && this.mesh.parent) { this.state = 'embed'; this.embed = S; this.ctx.throws.adopt(S); return; }
    if (S) this.unstick(false, true);
    this.mesh.updateMatrixWorld(true);
    this.looseAt(this.mesh.position, this.mesh.quaternion, this.vel.clone().clampLength(0, 5), V(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)));
  }

  /** Lying loose (a physics body) at pos / quat, moving at vel / angVel. */
  looseAt(pos, quat, vel, angVel) {
    if (this.loose) { this.debris.release(this.loose); this.loose = null; }
    if (this.mesh.parent !== this.scene) this.scene.add(this.mesh);
    this.mesh.visible = true;
    this.state = 'loose';
    this.loose = this.debris.add(this.mesh, { box: this.def.box }, {
      pos: pos.clone(), quat: quat.clone(), vel, angVel,
      mass: this.def.massKg, restitution: 0.15, friction: 0.7, sound: 'drop', kind: 'melee', offset: this.def.off,
    });
  }

  // ---- the attack button ----
  /** Button down: a tap swings (on release); held, it comes up overhead for a chop. */
  press() {
    if (this.state !== 'held') return;
    this.btn = { t: 0 };
  }
  /** Button up: a tap is a swing; out of a wind-up, the chop comes down. */
  release(style = null) {
    const B = this.btn;
    this.btn = null;
    if (!B || this.state !== 'held' || this.def.saw) return;
    // stuck in someone: a tap puts your weight behind it again and drives the edge on through
    if (this.stuckIn) { if (this.cutter && B.t <= HOLD) this.shove(); return; }
    if (this.chop?.phase === 'cock') { this.chop.go = true; return; }
    if (B.t <= HOLD || !this.chop) this.attack(style);
  }

  /**
   * Swing (a click during the recovery queues the next one). style: 'over' (an overhead chop,
   * brought straight down), 'low' (a sweep at the legs), else forehand / backhand in turn.
   */
  attack(style = null) {
    if (this.state !== 'held' || this.stuckIn) return;
    // still bringing it up: swing as soon as it's in hand
    if (this.pickT < 1) { this.queued = style || true; return; }
    if (this.chop) { if (this.chop.phase === 'stuck' || this.chop.phase === 'cock') this.queued = style || true; return; }
    // (coming back up out of a chop, or off a wall: a new blow can start straight from there)
    const recovering = this.swing?.style === 'recover' && this.swing.t > 0.12;
    if (this.swing && !recovering) { if (this.swing.t > this.swing.liveEnd - 0.05) this.queued = style || true; return; }
    if (style === 'over') { this.startChop(true); return; }
    let S;
    const M = this.moves;
    if (style === 'low') S = M.low;
    else { S = M.swings[this.nextSwing % M.swings.length]; this.nextSwing++; }
    // start exactly where the weapon is now, end back at the ready
    const keys = [this.here(), ...S, { ...this.ready, dur: this.def.back }];
    this.t0 = performance.now();
    let liveEnd = 0, acc = 0;
    keys.forEach((k, i) => { if (i) { acc += k.dur; if (k.live) liveEnd = acc; } });
    this.swing = { keys, t: 0, dur: total(keys), liveEnd, hit: new Set(), whoosh: false, style, world: false };
    this.prevSeg = null;
  }
  /** The weapon's current pose as a key to start a move from. */
  here() {
    const h = this.owner.hero;
    // (the trunk as it is now - with one in each hand, maybe the other's blow: this one takes it over from there)
    return { p: this.local.p.clone(), q: this.local.q.clone(), dur: 0, tw: h.twist || 0, bend: h.bend || 0 };
  }
  /** Back to the ready from wherever it is now (after a chop, or bounced off a wall). */
  recover(dur) {
    const keys = [this.here(), { ...this.ready, dur }];
    this.swing = { keys, t: 0, dur, liveEnd: 0, hit: new Set(), whoosh: true, style: 'recover', world: true };
  }

  /** Up over the head, ready to bring down. auto: it comes down by itself once it's up there. */
  startChop(auto) {
    this.swing = null;
    this.t0 = performance.now();
    this.chop = { phase: 'cock', from: this.here(), k: 0, t: 0, charge: auto ? 0.45 : 0, auto, go: false, u: 0, w: 0, hit: new Set(), world: false };
    this.ctx.sfx?.('rackback', 0.25);
  }

  /** World segment (grip end, far end) of the weapon at chop position u. */
  chopSeg(u, a = V(), b = V()) {
    chopPose(u, this.def, _pose, this.chop?.drop || 0, !this.hand);
    const wq = _q.copy(this.yq).multiply(_pose.q);
    const wp = _p.copy(_pose.p).applyQuaternion(this.yq).add(this.O);
    a.set(0, this.def.seg[0], 0).applyQuaternion(wq).add(wp);
    b.set(0, this.def.seg[1] + this.def.r, 0).applyQuaternion(wq).add(wp);
    return [a, b];
  }
  /** Is the weapon into something solid at u (coming from the tip at `from`)? */
  blockedAt(u, from) {
    const [a, b] = this.chopSeg(u);
    const cs = this.ctx.castSeg;
    if (b.y < 0.005) return { point: b.clone().setY(0), normal: V(0, 1, 0) };
    if (!cs) return null;
    return cs(from, b) || cs(a, b);
  }

  /** One frame of the chop. Fills the pose in c; returns the knee dip it wants. */
  stepChop(h, dt, c) {
    const C = this.chop, d = this.def;
    C.t += dt;
    if (C.phase === 'cock') {
      C.k = Math.min(1, C.k + dt / 0.3);
      chopPose(0, d, _pose, 0, !this.hand);
      const e = smooth(C.k);
      c.p.lerpVectors(C.from.p, _pose.p, e); c.q.slerpQuaternions(C.from.q, _pose.q, e);
      c.tw = lerp(C.from.tw, _pose.tw, e); c.bend = lerp(C.from.bend, _pose.bend, e);
      c.live = false;
      if (C.k >= 1) {
        // held up there it gathers itself: drawn a little further back, straining at the top
        C.charge = Math.min(1, C.charge + dt / 0.65);
        const s = smooth(C.charge);
        c.p.y += 0.025 * s; c.p.z -= 0.035 * s;
        c.bend -= 0.06 * s;
        const tr = s * s * 0.0035;
        c.p.x += Math.sin(C.t * 53) * tr; c.p.y += Math.sin(C.t * 41 + 1) * tr;
        if (C.go || !this.btn || (C.auto && C.t > 0.34)) {
          C.phase = 'fall';
          // it comes off the top already moving: the arms whip it over and the body drops in
          C.u = 0; C.w = 2.2 + 1.4 * C.charge;
          // on the flat, the bottom of the arc goes just past the floor under your feet: it
          // always meets it (or whatever's lying there first)
          chopPose(1, d, _pose, 0, !this.hand);
          const tipY = _pose.p.y + _v1.set(0, d.seg[1] + d.r, 0).applyQuaternion(_pose.q).y;
          const floorY = h.pos.y - this.O.y;
          C.drop = clamp(tipY - (floorY - 0.1), 0, 0.4);
          C.base = c.p.clone(); C.baseQ = c.q.clone();
        }
      }
      return 0;
    }
    if (C.phase === 'fall') {
      const wmax = 5.2 + 3 * C.charge, acc = 38 + 30 * C.charge;
      C.w = Math.min(wmax, C.w + acc * dt);
      let u0 = C.u, u = Math.min(1, u0 + C.w * dt), hit = null;
      // substeps: a fast arc covers a lot of ground in one frame
      const steps = Math.max(1, Math.ceil((u - u0) / 0.035));
      const tip0 = this.prevSeg ? this.prevSeg[1].clone() : this.chopSeg(u0)[1].clone();
      let prev = this.prevSeg ? [this.prevSeg[0].clone(), this.prevSeg[1].clone()] : this.chopSeg(u0).map((v) => v.clone());
      const sdt = dt / steps;
      for (let s = 1; s <= steps && !hit; s++) {
        const ua = lerp(u0, u, (s - 1) / steps), ub = lerp(u0, u, s / steps);
        const [a1, b1] = this.chopSeg(ub);
        const seg1 = [a1.clone(), b1.clone()];
        // a body in the way
        if (ub > LIVE_U) {
          const bh = sweep(prev[0], prev[1], seg1[0], seg1[1], d.r, this.ctx.actors, this.owner, C.hit);
          // (held up in its way, a weapon / a gun takes the chop instead)
          const pr = parry(prev[0], prev[1], seg1[0], seg1[1], d.r, this.owner, bh ? bh.k : 1);
          if (pr) {
            const v = seg1[1].clone().sub(prev[1]).divideScalar(Math.max(sdt, 1e-3)).clampLength(0, 40);
            parriedBlow(pr, v, this.owner, 1.3 + C.charge * 0.5, this.ctx.sfx);
            hit = { kind: 'world', u: lerp(ua, ub, pr.k), point: pr.point, normal: v.clone().normalize().negate(), tip: seg1[1].clone(), parry: true };
            break;
          }
          if (bh) { hit = { kind: 'body', u: lerp(ua, ub, bh.k), bh, prev, seg1, sdt }; break; }
          this.slashLoose(prev[0], prev[1], seg1[0], seg1[1], sdt, 1.25 + C.charge * 0.45, C.hit);
        }
        // the ground, a kerb, a wall, a car
        const w = this.blockedAt(ub, prev[1]);
        if (w) {
          // bisect for where it first touched
          let lo = ua, hi = ub;
          for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (this.blockedAt(m, prev[1])) hi = m; else lo = m; }
          const tipNow = this.chopSeg(lo)[1].clone();
          hit = { kind: 'world', u: lo, point: w.point || tipNow, normal: w.normal, tip: tipNow };
          break;
        }
        prev = seg1;
      }
      if (hit) u = Math.max(u0, hit.u);
      const speed = C.w * 4.2; // ~ m/s at the far end
      C.u = u;
      chopPose(u, d, _pose, C.drop, !this.hand);
      // it starts from wherever the wind-up left it (strain, tremble) and joins the arc
      const j = smooth(u / 0.18);
      c.p.lerpVectors(C.base, _pose.p, j); c.q.slerpQuaternions(C.baseQ, _pose.q, j);
      c.tw = _pose.tw; c.bend = _pose.bend;
      c.live = u > LIVE_U;
      if (!C.whoosh && u > 0.08) { C.whoosh = true; this.ctx.sfx?.('whoosh', 0.55 + C.charge * 0.4, { rate: 0.85 - C.charge * 0.15 }); }
      // things lying in its path: street furniture, loose junk (once)
      if (!C.world && c.live && this.ctx.hitWorld) {
        const tip = this.chopSeg(u)[1];
        const v = tip.clone().sub(tip0).divideScalar(Math.max(dt, 1e-3));
        if (v.length() > 3 && this.ctx.hitWorld(tip, v.clampLength(0, 30), d.hit.mass * v.length() * 0.4, this.owner)) C.world = true;
      }
      if (hit?.kind === 'body') this.chopBody(hit, dt);
      else if (hit) this.chopGround(hit, speed);
      else if (u >= 1) { C.phase = 'stuck'; C.hold = 0.1; C.bounce = 0; C.st = 0; }
      return _pose.dip;
    }
    // stuck: stopped dead where it hit (a blade bites in and stays a moment; a bat jumps back)
    C.hold -= dt; C.st += dt;
    const b = C.bounce * Math.exp(-C.st * 11) * Math.abs(Math.sin(C.st * 30));
    chopPose(Math.max(0, C.u - b), d, _pose, C.drop, !this.hand);
    c.p.copy(_pose.p); c.q.copy(_pose.q); c.tw = _pose.tw; c.bend = _pose.bend; c.live = false;
    if (C.hold <= 0) {
      this.local.p.copy(c.p); this.local.q.copy(c.q);
      h.twist = c.tw; h.bend = c.bend;
      this.chop = null;
      this.recover(this.def.back + 0.25);
      if (this.btn) this.btn.t = 0; // (still held: a fresh press, not an instant wind-up)
    }
    return _pose.dip;
  }

  chopGround(hit, speed) {
    const C = this.chop, d = this.def;
    const k = clamp(speed / 20, 0.3, 1);
    C.phase = 'stuck'; C.st = 0;
    C.hold = d.stuck * (0.7 + 0.6 * C.charge);
    C.bounce = d.bounce * k;
    this.ctx.sfx?.(d.ground, 0.6 + 0.4 * k);
    this.ctx.sfx?.('impact', 0.45 + 0.45 * k, { rate: 0.6 });
    this.ctx.impact?.((0.07 + 0.08 * k) * (0.7 + C.charge * 0.6), this.owner);
    this.stop = 0.06 + d.massKg * 0.025;
    // a bloody weapon slapped into the floor leaves some of it there
    if (this.blood.wet > 0.1 && this.ctx.blood) {
      const p = hit.tip.clone();
      const v = V(0, -speed, 0);
      this.ctx.blood.inked(this.blood.ink).spray(p.setY(p.y + 0.02), V(0, 1, 0).add(this.yqFwd()).normalize(), 1.5, 5, 0.9, 0.7);
      this.ctx.blood.inked(this.blood.ink).spray(p, V(0, -1, 0), 2, 3, 0.4, 1.1, v.multiplyScalar(0.05));
    }
  }
  yqFwd() { return V(0, 0, 1).applyQuaternion(this.yq); }

  chopBody(hit, dt) {
    const C = this.chop, d = this.def;
    const { bh, prev, seg1 } = hit;
    // the blow itself, at full chop weight
    const cut = this.land(bh, prev[0], prev[1], seg1[0], seg1[1], hit.sdt, 1.35 + C.charge * 0.55);
    // clean through: the chop carries on down, a little slowed
    if (cut) { C.w *= 0.8; return; }
    // it stops dead in them: a blade bites and stays, a blunt one sinks in and barely rebounds
    C.phase = 'stuck'; C.st = 0;
    C.hold = d.hit.kind === 'blade' ? 0.26 : 0.14;
    C.bounce = d.hit.kind === 'blade' ? 0 : d.bounce * 0.3;
  }

  /** Arm hook: place the weapon (ready / pick-up / mid-swing) and put the hands on it. */
  poseHeld(h, dt) {
    const d = this.def, A = this.owner;
    const O = this.O, yq = this.yq;
    bodyFrame(h, O, yq);
    // hit-stop: everything in the blow freezes for a beat when it lands
    const rate = this.stop > 0 ? 0.08 : 1;
    this.stop = Math.max(0, this.stop - dt);
    const sdt = dt * rate;
    // stuck in someone: the hands stay on the handle, working it back out
    if (this.stuckIn) { if (this.btn) this.btn.t += dt; this.poseStuck(h, dt); return; }
    if (this.btn) {
      this.btn.t += dt;
      // held past a tap: bring it up overhead (straight from the ready, or out of a swing's recovery)
      if (d.saw) { if (!this.swing && this.pickT >= 1) this.attack(); }
      else if (this.btn.t > HOLD && !this.chop && this.pickT >= 1 && (!this.swing || this.swing.t > this.swing.liveEnd)) this.startChop(false);
    }
    // where it wants to be, in the body frame
    const c = this.cur;
    let dip = 0;
    if (this.chop) dip = this.stepChop(h, sdt, c);
    if (this.stuckIn) { this.poseStuck(h, dt); return; }
    else if (this.swing) {
      const S = this.swing;
      // (a saw in the cut drags: the strokes go slower through flesh)
      // (a cutter in flesh: the swing slows through it - bone slows it most)
      S.t += sdt * (d.saw ? this.sawDrag ?? 1 : 1) * (this.cutter ? Math.max(0.06, 1 - this.cutter.hold() * 1.2) : 1);
      sample(S.keys, Math.min(S.t, S.dur), c);
      if (c.live && !S.whoosh) { S.whoosh = true; this.ctx.sfx?.('whoosh', 0.5); }
      if (S.t >= S.dur) {
        this.swing = null;
        if (this.queued) { const q = this.queued; this.queued = false; this.attack(q === true ? null : q); }
      }
    } else {
      const k = Math.min(1, dt * (A.guard ? 16 : 10));
      const R = A.guard && !this.def.noGuard ? (this.hand ? GUARD : GUARD_L) : this.ready;
      c.p.lerp(R.p, k); c.q.slerp(R.q, k);
      // (a blow caught on it knocks the guard back toward you, and it comes back up)
      if (A.guardJolt > 0) { c.p.z -= 0.07 * A.guardJolt; c.p.y += 0.03 * A.guardJolt; A.guardJolt = Math.max(0, A.guardJolt - dt * 4); }
      c.tw = lerp(c.tw, 0, k); c.bend = lerp(c.bend, 0, k); c.live = false;
    }
    // swings (not the chop - that goes to the floor anyway) follow where you're aiming: up at a
    // head, down at someone on their knees
    let pitch = 0;
    if (this.swing && (this.swing.style !== 'low' || d.saw) && this.swing.style !== 'recover' && A === this.ctx.player && this.ctx.aiming?.() && this.ctx.aimPoint) {
      _to.copy(this.ctx.aimPoint).sub(O).applyQuaternion(_q.copy(yq).invert());
      if (_to.z > 0.2) pitch = clamp(Math.atan2(-_to.y, Math.hypot(_to.x, _to.z)), -0.4, 0.55);
    }
    this.pitch = lerp(this.pitch, pitch, Math.min(1, dt * 8));
    // (the stored pose stays un-tilted: moves start from it)
    let P = c;
    if (Math.abs(this.pitch) > 1e-3) {
      _pitchQ.setFromAxisAngle(_X, this.pitch);
      _tc.p.copy(c.p).applyQuaternion(_pitchQ);
      _tc.q.copy(c.q).premultiply(_pitchQ);
      P = _tc;
    }
    h.twist = c.tw; h.bend = c.bend; h.dip = dip;
    this.local.p.copy(c.p); this.local.q.copy(c.q);

    // world pose
    const wp = P.p.clone().applyQuaternion(yq).add(O);
    const wq = yq.clone().multiply(P.q);
    // (the saw: sunk into its cut, held in the kerf - saw.js)
    if (d.saw && this.sawOff) wp.add(this.sawOff);
    // picking up: the hand goes to it where it lies, then brings it up
    this.pickT = Math.min(1, this.pickT + dt / 0.7);
    if (this.pickT >= 1 && this.queued && !this.swing && !this.chop) { const q = this.queued; this.queued = false; this.attack(q === true ? null : q); }
    const reach = smooth(this.pickT / 0.45), lift = smooth((this.pickT - 0.4) / 0.6);
    if (lift < 1 && this.pickFrom) {
      wp.lerpVectors(this.pickFrom.pos, wp, lift);
      wq.slerpQuaternions(this.pickFrom.quat, wq, lift);
    }
    this.mesh.position.copy(wp);
    this.mesh.quaternion.copy(wq);
    this.mesh.updateMatrixWorld(true);
    const gm = this.mesh.matrixWorld;
    this.vel.copy(wp).sub(this.lastPos).divideScalar(Math.max(dt, 1e-3));
    if (this.vel.length() > 30) this.vel.set(0, 0, 0);
    this.lastPos.copy(wp);

    // hands
    const fwd = h.forward(V());
    // (the body frame is x = left: this is the character's actual right)
    const right = V(-fwd.z, 0, fwd.x);
    // (aR: the hand it's in - the right, or the left for the second of a pair; out: that side)
    const aR = h.arms[this.hand], aL = h.arms[0];
    const out = this.hand ? right : right.clone().negate();
    const locoR = V(), locoRq = Q(), locoL = V(), locoLq = Q();
    aR.hand.updateWorldMatrix(true, false); aR.hand.matrixWorld.decompose(locoR, locoRq, _s);
    aL.hand.updateWorldMatrix(true, false); aL.hand.matrixWorld.decompose(locoL, locoLq, _s);
    _m.multiplyMatrices(gm, this.gripOn).decompose(_p, _q, _s);
    _p.lerp(locoR, 1 - reach); _q.slerp(locoRq, 1 - reach);
    // elbows: down by the sides normally; with the hands up over the head they swing out and
    // up to the side instead, so the arm goes round the head rather than through it
    const over = (hp, side) => {
      h.chest.localToWorld(_sh.set(side * 0.185, 0.2, -0.015));
      return smooth(clamp((hp.y - _sh.y + 0.02) / 0.22, 0, 1));
    };
    let ov = over(_p, aR.side);
    _pole.copy(out).multiplyScalar(lerp(0.9, 1, ov)).addScaledVector(UP, lerp(-0.6, 0.45, ov)).addScaledVector(fwd, lerp(-0.3, -0.35, ov)).normalize();
    poseArm(h, aR, _p, _q, _pole);
    // a tighter grip through the blow
    const grip = c.live || this.cocked ? 1.55 : 1.4;
    curl(aR, lerp(0.4, grip, reach));
    if (d.two !== undefined && this.hand) {
      _m.multiplyMatrices(gm, leftOn(d.two)).decompose(_p, _q, _s);
      _p.lerp(locoL, 1 - lift); _q.slerp(locoLq, 1 - lift);
      // the lead (left) arm of a two-handed grip raised overhead reaches across to the hands
      // by the right shoulder: its elbow comes forward, out in front of the face
      ov = over(_p, aL.side);
      _pole.copy(right).multiplyScalar(lerp(-0.9, -0.6, ov)).addScaledVector(UP, lerp(-0.6, 0.15, ov)).addScaledVector(fwd, lerp(-0.3, 0.8, ov)).normalize();
      poseArm(h, aL, _p, _q, _pole);
      curl(aL, lerp(0.3, grip, lift));
    }

    // contact: the business end, swept from last frame (the chop does its own, above)
    const a1 = V(0, d.seg[0], 0).applyMatrix4(gm), b1 = V(0, d.seg[1], 0).applyMatrix4(gm);
    // the cutting edge, swept through whatever it's in (slicing/BladeCutter.js)
    if (this.cutter && !this.stuckIn) this.cutter.step(dt, { live: !!(this.swing || this.chop?.phase === 'fall') && c.live });
    if (this.prevSeg) this.tipVel.copy(b1).sub(this.prevSeg[1]).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 40);
    if (d.saw) this.sawDrag = sawStep(this, A, dt, this.ctx.actors, c.live && !!this.swing);
    else if (this.swing && c.live && this.prevSeg) {
      const [a0, b0] = this.prevSeg;
      const hit = sweep(a0, b0, a1, b1, d.r, this.ctx.actors, A, this.swing.hit);
      // something held in the way (a weapon, a gun): the swing stops on it, before any body
      const pr = this.swing.parried ? null : parry(a0, b0, a1, b1, d.r, A, hit ? hit.k : 1);
      if (pr) {
        this.swing.parried = true;
        const v = b1.clone().sub(b0).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 40);
        parriedBlow(pr, v, A, 1, this.ctx.sfx);
        this.ctx.impact?.(0.1, A, pr.owner);
        this.stop = 0.1;
        this.recover(d.back + 0.1);
        this.trail.cut();
      } else if (hit) this.land(hit, a0, b0, a1, b1, dt, 1);
      if (this.stuckIn) { this.poseStuck(h, dt); return; }
      this.slashLoose(a0, b0, a1, b1, dt, 1, this.swing.hit);
      // a wall, a car, the floor: it bounces off and the swing is over
      const cs = this.ctx.castSeg;
      if (this.swing && this.swing.style !== 'recover' && cs && this.tipVel.length() > 3) {
        const w = cs(b0, b1) || cs(a1, b1);
        // (a low sweep skims the floor rather than bouncing off it)
        if (w && !(this.swing.style === 'low' && w.normal.y > 0.6)) {
          const k = clamp(this.tipVel.length() / 15, 0.3, 1);
          this.ctx.sfx?.(d.ground, 0.4 + 0.5 * k);
          this.ctx.sfx?.('impact', 0.3 + 0.3 * k);
          this.ctx.impact?.(0.05 + 0.06 * k, A);
          this.stop = 0.07;
          this.recover(d.back + 0.1);
          this.trail.cut();
        }
      }
      // street furniture and loose junk: once per swing, at the business end
      if (this.swing && !this.swing.world && this.ctx.hitWorld) {
        const tip = a1.clone().lerp(b1, 0.75), v = tip.clone().sub(a0.clone().lerp(b0, 0.75)).divideScalar(Math.max(dt, 1e-3));
        if (v.length() > 3 && this.ctx.hitWorld(tip, v.clampLength(0, 30), d.hit.mass * v.length() * 0.28, A)) {
          this.swing.world = true;
          this.stop = 0.05;
        }
      }
    }
    // the blur behind a fast blow
    const fast = this.tipVel.length();
    if (c.live && fast > 4) this.trail.push(V(0, lerp(d.seg[0], d.seg[1], 0.45), 0).applyMatrix4(gm), V(0, d.seg[1] + 0.01, 0).applyMatrix4(gm), clamp((fast - 4) / 10, 0, 1));
    this.prevSeg = [a1, b1];
  }

  /** BladeCutter: the point went into a person first (a stab): it pierces and stays in. */
  cutterStab(C, vel) {
    const T = C.T;
    if (T.kind !== 'actor' || T.A.remote || !T.A.groups?.[T.part] || !this.owner || vel.length() < 1.5) return;
    const axis = V().subVectors(this.cutter.b, this.cutter.a).normalize();
    const n = vel.clone().normalize().negate();
    T.A.wounds?.stab(T.part, C.entry, n, vel.clone(), axis, 0.6);
    this.stickIn({ actor: T.A, part: T.part, point: C.entry, normal: n }, vel, axis, 1, null, true);
    this.stuckIn.pierce = true; // (vr.js holdStuck: drawn sideways, the edge cuts its way out)
    this.stuckIn.cut = null;    // (shoved: the edge cuts on from here - shove)
    this.ctx.sliceFx?.stab(this.cutter, C, vel.length());
  }
  /**
   * Stuck in them with a cutter: one more push behind it. The blade goes on edge first, as far
   * as the tissue lets one shove take it, cutting the mesh open as it goes (BladeCutter.carve);
   * all the way through, the part comes off and the blade's free.
   */
  shove() {
    const S = this.stuckIn, m = this.mesh;
    if (!S || !this.cutter || m.parent !== S.g) return;
    const part = S.cut?.T.part || S.part;
    const res = (limbOf(part)?.resistance || 3) * (/^(pelvis|spine|chest)$/.test(part) ? 1.5 : 1);
    this.driveOn(clamp(0.13 * (this.def.cleave || 1) / res, 0.012, 0.045), part);
    this.stop = 0.06;
    this.ctx.sfx?.('hack', 0.55, { rate: rnd(0.85, 1.05) });
    this.ctx.sfx?.('flesh', 0.6, { rate: rnd(0.75, 0.95) });
    this.ctx.shake?.(0.05, this.owner);
  }
  /** The stuck blade driven dd further on, edge first (a shove; in VR, the hand pushing it on - vr.js). */
  driveOn(dd, part = this.stuckIn?.cut?.T.part || this.stuckIn?.part) {
    const S = this.stuckIn, m = this.mesh;
    if (!S || !this.cutter || m.parent !== S.g) return;
    // edge first, in the part's frame (the weapon's a child of it now)
    m.position.addScaledVector(V(0, 0, 1).applyQuaternion(m.quaternion), dd);
    m.updateMatrixWorld(true);
    // (stuck edge first: it's that much deeper in to pull back out of)
    if (S.inL.z > 0.9) { S.depth += dd; S.max = Math.max(S.max || 0, S.depth); }
    S.t = 0;
    const C = this.cutter.carve(S.cut, S.actor, part, dd);
    if (C) { S.cut = C; return; }
    // through (or the part's gone): the blade comes free
    if (this.stuckIn === S) this.unstick(false);
  }
  /**
   * Stuck in them with a cutter: turned toward `target` (the world rotation the hand wants it at)
   * slowly - the deeper it's in, the harder the flesh holds it - pivoting about the point of the
   * edge that's in them, so it carves round as it turns (BladeCutter.carve).
   */
  twistStuck(target, dt) {
    const S = this.stuckIn, m = this.mesh, d = this.def;
    if (!S || !this.cutter || m.parent !== S.g || S.chop) return;
    m.updateMatrixWorld(true);
    const cq = m.getWorldQuaternion(Q());
    const ang = cq.angleTo(target);
    if (ang < 0.004) return;
    const step = Math.min(ang, dt * 1.3 / (1 + S.depth * 6));
    const nq = cq.clone().rotateTowards(target, step);
    const s = S.cut?.s0 ?? 0.6;
    const pivot = V(0, lerp(d.seg[0], d.seg[1], s), 0).applyMatrix4(m.matrixWorld);
    const tip0 = V(0, d.seg[1], 0).applyMatrix4(m.matrixWorld);
    const wpos = V().setFromMatrixPosition(m.matrixWorld);
    wpos.sub(pivot).applyQuaternion(nq.clone().multiply(cq.clone().invert())).add(pivot);
    S.g.updateWorldMatrix(true, false);
    m.position.copy(S.g.worldToLocal(wpos));
    m.quaternion.copy(S.g.getWorldQuaternion(Q()).invert().multiply(nq));
    m.updateMatrixWorld(true);
    // how far it's cut on: the tip end of the edge swung the way the edge faces
    const tip1 = V(0, d.seg[1], 0).applyMatrix4(m.matrixWorld);
    const fwd = Math.max(0, tip1.sub(tip0).dot(V(0, 0, 1).applyQuaternion(nq))) * 0.6;
    S.twA = (S.twA || 0) + step; S.twF = (S.twF || 0) + fwd;
    if (S.twA < 0.06 && S.twF < 0.01) return;
    const dd = S.twF;
    S.twA = S.twF = 0;
    this.cutter.haptic?.(0.35, 30);
    this.ctx.sfx?.('flesh', 0.25 + Math.min(0.4, dd * 20), { rate: rnd(0.8, 1.1) });
    const C = this.cutter.carve(S.cut, S.actor, S.cut?.T.part || S.part, dd);
    if (C) S.cut = C;
    else if (this.stuckIn === S) this.unstick(false);
  }
  /** BladeCutter: dragging through tough stuff - a swing (not a hand: vr.js lags the blade) slows. */
  cutterDrag(res) { /* (no hit-stop: the stroke stays smooth and yours - vr.js lags the blade instead) */ }
  /** BladeCutter: the swing ran out of push inside them - the blade stops there, stuck in. */
  cutterStall(C) {
    const T = C.T;
    this.stop = 0.06;
    if (T.kind === 'actor' && !T.A.remote && T.A.groups?.[T.part] && this.owner) {
      const axis = V().subVectors(this.cutter.b, this.cutter.a).normalize();
      this.stickIn({ actor: T.A, part: T.part, point: C.last, normal: C.vel.clone().normalize().negate(), inPlace: true, depth: clamp(C.depth || 0.03, 0.02, 0.22) }, C.vel, axis, 1, null, false);
      this.stuckIn.pierce = true;
      this.stuckIn.cut = C;     // (shoved again: the same cut carries on - shove)
      return;
    }
    if (this.swing && this.swing.style !== 'recover') this.recover(this.def.back + 0.15);
  }

  /** The blade bit in and stuck: fixed into the part it hit, still in our hand. */
  stickIn(hit, vel, axis, power, kerf = null, pointFirst = !!this.def.stab) {
    const A = hit.actor, g = A.groups[hit.part], m = this.mesh, d = { ...this.def, stab: pointFirst };
    // the way in: point first for a stab, edge first for a cut
    const inL = d.stab ? V(0, 1, 0) : V(0, 0, 1);
    m.updateMatrixWorld(true);
    const inW = inL.clone().applyQuaternion(m.quaternion);
    const depth = hit.inPlace ? hit.depth : kerf ? kerfDepth(kerf) : clamp(vel.length() * (d.stab ? 0.016 : 0.0055) * Math.sqrt(power), d.stab ? 0.06 : 0.03, d.stab ? (d.seg[1] - d.seg[0]) * 0.85 : 0.065);
    const lead = d.stab ? V(0, d.seg[1], 0) : V(0, lerp(d.seg[0], d.seg[1], 0.6), 0.03);
    lead.applyMatrix4(m.matrixWorld);
    // a stab: only the tip's in at first - it's driven the rest of the way against the flesh
    // (poseStuck: on its own; in VR the hand pushes it, vr.js holdStuck)
    const start = d.stab ? Math.min(depth, 0.015) : depth;
    // (a cutter that ran out of push: it's already in them, right where it stopped)
    if (!hit.inPlace) m.position.addScaledVector(inW, V().subVectors(hit.point, lead).dot(inW) + start);
    m.updateMatrixWorld(true);
    g.attach(m);
    // (throw.js's shape: let go of it and it's held in them the same way a thrown blade is)
    this.stuckIn = { w: this, actor: A, part: hit.part, g, inL, depth: start, depth0: depth, v: 0, lastP: null, lastV: V(), acc: V(), t: 0, jerk: 0,
      goal: d.stab && !this.owner?.vrSelf ? depth : null, max: kerf ? Math.min(kerf.r * 2.05, kerfDepth(kerf) + 0.02) : d.stab ? (d.seg[1] - d.seg[0]) * 0.9 : depth, track: start, chop: kerf };
    this.swing = this.chop = null;
    this.queued = false;
    this.prevSeg = null;
    this.trail.cut();
    this.stop = 0.1;
    this.ctx.sfx?.('flesh', 0.85, { rate: 0.8 });
  }
  /** Stuck: both hands on it; the button held (or backing off from it) works it loose in jerks. */
  poseStuck(h, dt) {
    const S = this.stuckIn, A = this.owner, d = this.def, m = this.mesh;
    S.t += dt;
    if (!m.parent || !S.actor.hero.root.parent) { this.unstick(false); return; }
    m.updateMatrixWorld(true);
    const gm = m.matrixWorld;
    const fwd = h.forward(V()), right = V(-fwd.z, 0, fwd.x);
    const aR = h.arms[this.hand], out = this.hand ? right : right.clone().negate();
    _m.multiplyMatrices(gm, this.gripOn).decompose(_p, _q, _s);
    const grip = _p.clone();
    _pole.copy(out).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.3).normalize();
    poseArm(h, aR, _p, _q, _pole);
    curl(aR, 1.6);
    if (d.two !== undefined && this.hand) {
      _m.multiplyMatrices(gm, leftOn(d.two)).decompose(_p, _q, _s);
      _pole.copy(right).multiplyScalar(-0.9).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.3).normalize();
      poseArm(h, h.arms[0], _p, _q, _pole);
      curl(h.arms[0], 1.6);
    }
    if (A.vrSelf) return; // (in VR the hand works it in and out itself: vr.js holdStuck)
    // a cutter: turn (and look up / down, aiming) and the blade turns in them with you, cutting round
    if (this.cutter && A === this.ctx.player && !S.chop) {
      let pitch = 0;
      if (this.ctx.aiming?.() && this.ctx.aimPoint) {
        _to.copy(this.ctx.aimPoint).sub(this.O).applyQuaternion(_q.copy(this.yq).invert());
        if (_to.z > 0.2) pitch = clamp(Math.atan2(-_to.y, Math.hypot(_to.x, _to.z)), -0.6, 0.6);
      }
      const frame = this.yq.clone().multiply(_pitchQ.setFromAxisAngle(_X, pitch));
      if (!S.refQ) { S.refQ = frame.clone().invert().multiply(m.getWorldQuaternion(Q())); }
      this.twistStuck(frame.multiply(S.refQ), dt);
      if (this.stuckIn !== S) return;
    }
    // still going in: driven home against the flesh, slowing as it goes deeper
    if (S.goal != null && S.depth < S.goal) {
      const dd = Math.min(S.goal - S.depth, dt * (0.9 - 4 * S.depth));
      if (dd > 0) { S.depth += dd; m.position.addScaledVector(S.inL.clone().applyQuaternion(m.quaternion), dd); }
      if (dd <= 0.0005) S.goal = null;
      return;
    }
    S.goal = null;
    // (a cutter: a tap shoves it on, holding the button works it back out)
    const pulling = A === this.ctx.player ? !!this.btn && (!this.cutter || this.btn.t > HOLD) : S.t > 0.4;
    // leaning back into it
    const k = Math.min(1, dt * 6);
    h.twist = lerp(h.twist || 0, pulling ? -0.15 : 0, k); h.bend = lerp(h.bend || 0, pulling ? -0.12 : 0.08, k); h.dip = lerp(h.dip || 0, pulling ? 0.12 : 0, k);
    // how far the handle is from the shoulder: walking off with it pulls too
    h.chest.localToWorld(_sh.set(aR.side * 0.185, 0.2, -0.015));
    const reach = _sh.distanceTo(grip);
    const strain = (pulling ? 1 : 0) + clamp((reach - 0.55) / 0.2, 0, 2.5);
    if (strain > 0) {
      // it comes in jerks - flesh grips the deeper it's in
      S.jerk -= dt;
      if (S.jerk <= 0) {
        S.jerk = rnd(0.12, 0.2);
        const hold = 0.35 + S.depth / 0.1;
        // (a slim knife slides back out much easier than a wedged-in axe)
        const dd = Math.min(S.depth, (d.stab ? 0.04 : 0.012) * strain / hold);
        S.depth -= dd;
        m.position.addScaledVector(S.inL.clone().applyQuaternion(m.quaternion), -dd);
        this.ctx.sfx?.('flesh', 0.25 + 0.15 * strain, { rate: 1.2 + Math.random() * 0.3 });
        this.ctx.shake?.(0.02 * strain, A);
        // the body gets hauled toward us with each one
        const V2 = S.actor;
        if (!d.stab && !V2.remote && V2.mode === 'ragdoll' && !V2.pending) {
          V2.pending = { imp: _v1.subVectors(_sh, grip).setY(0).normalize().multiplyScalar(6 * strain).clone(), part: S.part, point: grip.clone() };
        }
      }
    }
    if (S.depth <= 0.006 || reach > 1.05) this.unstick(true);
  }
  /** Out of them (rip: pulled out - blood after it, and they're jerked along with it). */
  unstick(rip = true, keep = false) {
    const S = this.stuckIn || this.embed;
    this.stuckIn = null;
    this.cutter?.reset(); // (it's moved while stuck: no sweep from where it went in)
    if (!S) return;
    const m = this.mesh, d = this.def;
    m.updateMatrixWorld(true);
    const pos = V(), quat = Q();
    m.matrixWorld.decompose(pos, quat, _s);
    const tip = V(0, d.seg[1], 0).applyMatrix4(m.matrixWorld);
    this.scene.attach(m);
    m.position.copy(pos); m.quaternion.copy(quat);
    if (rip) {
      const A = S.actor, outW = S.inL.clone().applyQuaternion(quat).negate();
      this.ctx.blood?.inked(A).spray(tip, outW, 3.2, 14, 0.4, 1.1);
      this.ctx.sfx?.('flesh', 0.8, { rate: 0.75 });
      this.blood.add(tip, 0.8, inkOf(A));
      if (!A.remote && !A.brain.dead) {
        if (!d.stab) {
          if (A.mode === 'anim') A.goRagdoll('stumble', { balance: 0.7, decay: 0.35 });
          A.pending = { imp: outW.clone().setY(0.2).normalize().multiplyScalar(22), part: S.part, point: tip };
        }
        A.onPain?.(S.part, 'pain', 0.7);
      }
    }
    if (keep) return;
    // back up into the ready from where it came out
    this.pickFrom = { pos, quat };
    this.pickT = 0.45;
    this.cur.p.copy(this.ready.p); this.cur.q.copy(this.ready.q);
    this.prevSeg = null;
  }

  /** Cut pieces lying (or flying) about that a blade passes through (slice.js). */
  slashLoose(a0, b0, a1, b1, dt, power, skip) {
    const D = this.ctx.dismember;
    if (!D || this.def.hit.kind !== 'blade' || this.def.noCut) return;
    D.slashChunks(a0, b0, a1, b1, dt, {
      edge: V(0, 0, 1).applyQuaternion(this.mesh.quaternion), edges: this.def.edges || 1,
      cleave: this.def.cleave || 1, power, skip,
    });
  }

  /** A blow on a body. power scales how hard (the chop hits harder than a swing). */
  land(hit, a0, b0, a1, b1, dt, power = 1) {
    const s = hit.s;
    const p0 = a0.clone().lerp(b0, s), p1 = a1.clone().lerp(b1, s);
    const vel = p1.sub(p0).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 40);
    if (vel.length() < 2.5) return; // barely moving: a nudge, not a blow
    (this.swing || this.chop).hit.add(hit.actor);
    // caught on their guard: a clang, the blow bounces off (the swing's done, a jolt back up the arm)
    if (blocks(hit.actor, this.owner, hit.point)) {
      guardHit(hit.actor, vel, this.owner, power, this.ctx.sfx);
      if (!hit.actor.remote) hit.actor.onGuard?.(this.owner, vel, power);
      else hit.actor.onRemoteHit?.('guard', vel, power, this.owner);
      this.stop = 0.1 + 0.05 * power;
      if (this.swing) this.swing.t = Math.max(this.swing.t, this.swing.dur - 0.12);
      this.ctx.impact?.(0.1 * power, this.owner, hit.actor);
      return;
    }
    const axis = b1.clone().sub(a1).normalize();
    const blade = this.def.hit.kind === 'blade';
    // a knife only stabs going in point first: swept edge-on (a swipe down, across) it slashes -
    // a long open gash along the stroke, and it draws on through instead of sticking
    const thrust = !!this.def.stab && axis.dot(_v1.copy(vel).normalize()) > 0.5;
    // (a chop brings the whole body's weight down with it: it shoves harder too)
    hit.actor.struck(hit.part, hit.point, vel, hit.normal,
      { ...this.def.hit, axis, sev: this.def.hit.sev * power, maxImp: this.def.hit.maxImp * Math.sqrt(power) * (this.def.cutter ? 0.25 : 1),
        dent: power, shaft: this.def.seg[1] - this.def.seg[0] > 0.25, stab: thrust, harmless: !!this.def.harmless,
        noPush: !!this.def.stab || !!this.def.cutter, // (the machete too: it goes into them, it doesn't shove)
        label: this.wtype.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) }, this.owner);
    // edge-first and fast enough: straight through the limb, cut where it met (slice.js)
    const edge = V(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    let cut = false, kerf = null;
    let slicing = false;
    // (only someone else can cut you: your own blade wounds you, but never takes anything off)
    if (blade && !this.def.harmless && !this.def.noCut && !this.def.cutter && hit.actor !== this.owner) {
      if (this.def.chop) {
        // a chopper: into the limb, a kerf deeper each blow, off when it's through (chop.js)
        const r = this.ctx.dismember && settings.dismember ? chopHit(this, hit, vel, axis, edge, power) : null;
        cut = !!r?.through;
        if (r && !cut && r.dk > 0) kerf = r.S;
      } else cut = !!this.ctx.dismember?.tryCut(hit.actor, hit.part, hit.point, vel, axis, edge,
        { edges: this.def.edges || 1, power, cleave: this.def.cleave || 1 });
    }
    // now and then a blade bites in and stays: it has to be pulled back out (stickIn)
    // a stab driven point first goes in to the hilt (or near it) every time
    // (a chopper that cut in: wedged in its kerf - always in a headset, where you can lean on it
    // and carry on cutting; now and then otherwise)
    const pointIn = thrust && vel.length() > 3;
    if (slicing) { /* (not stuck: it's on its way through) */ }
    else if (kerf && hit.actor.groups?.[kerf.part] && (this.owner?.vrSelf || Math.random() < 0.3)) this.stickIn({ ...hit, part: kerf.part }, vel, axis, power, kerf);
    else if (blade && !this.def.harmless && !cut && !kerf && hit.actor.groups?.[hit.part] && (pointIn || (!this.def.stab && !this.def.cutter && Math.random() < EMBED_CHANCE))) this.stickIn(hit, vel, axis, power);
    const k = clamp(vel.length() / 12, 0.4, 1);
    const head = hit.part === 'head' || hit.part === 'neck';
    this.ctx.sfx?.(this.def.sound, Math.min(1, k * 1.15), { rate: 0.92 + Math.random() * 0.14 });
    if (blade && !this.def.harmless) this.ctx.sfx?.('flesh', 0.5 + 0.4 * k);
    else this.ctx.sfx?.('punch', 0.55 + 0.35 * k, { rate: 0.7 });           // the meat of it
    this.ctx.sfx?.('impact', 0.3 + 0.3 * k * power, { rate: 0.5 });
    // heavier blows freeze longer; you feel it land (going clean through: a flick, not a stop)
    this.stop = this.def.cutter ? 0 : slicing ? 0.015 : cut ? 0.04 : 0.06 + this.def.massKg * 0.03 * power;
    const jolt = (0.1 + 0.1 * k) * power * (head ? 1.25 : 1) * (0.8 + this.def.massKg * 0.2);
    // (a cutter: no hit-stop or jolt - the edge carries on into them under your control)
    if (!this.def.cutter) this.ctx.impact?.(cut || slicing ? jolt * 0.5 : jolt, this.owner, hit.actor);
    // it comes away bloody: a blade always, a blunt one off skin that's already bleeding
    const wet = hit.actor.wounds?.parts[hit.part]?.wet || 0;
    const amt = blade && !this.def.harmless ? 0.45 + 0.35 * k * power : wet * 0.6 * k;
    if (amt > 0.05) this.blood.add(hit.point, cut ? 1 : amt, inkOf(hit.actor));
    return cut || slicing;
  }

  update(dt) {
    if (this.state === 'held') {
      const A = this.owner;
      // knocked down / shot: it falls out of your hands
      if (A.mode === 'ragdoll' || A.brain.dead) { this.drop(true); return; }
      // climbing, sitting, getting up: the arms aren't ours, so it just rides in the right hand
      if (A.hero.action || A.mode === 'blend') {
        this.swing = this.chop = null;
        A.hero.dip = 0;
        const hand = A.hero.arms[this.hand].hand;
        hand.updateWorldMatrix(true, false);
        this._inv = this.hand ? (_invR ||= RIGHT_ON.clone().invert()) : (_invL ||= LEFT_ON.clone().invert());
        _m.multiplyMatrices(hand.matrixWorld, this._inv).decompose(this.mesh.position, this.mesh.quaternion, _s);
        this.prevSeg = null;
      }
    }
    this.trail.update(dt);
    if (this.state === 'held') this.blood.update(dt, this.vel, this.tipVel);
    else if (this.mesh.visible) {
      const b = this.loose?.body, lv = b ? b.linvel() : null;
      this.blood.update(dt, lv ? _p.set(lv.x, lv.y, lv.z) : null, null);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Bare fists
// ---------------------------------------------------------------------------------------
export class Fists {
  constructor(actor, ctx) {
    this.actor = actor;
    this.ctx = ctx; // { actors, sfx, aimPoint }
    this.p = null;        // current punch
    this.next = 1;        // 1 = right, 0 = left
    this.queued = false;
    this.down = false;    // the button's held
    this.hook = (h, dt) => this.pose(h, dt);
  }
  get busy() { return !!this.p; }
  /** 0..1: how far a held punch is wound up (0 when not winding one up). */
  get charge() { return this.p?.cocking ? this.p.c : 0; }

  cancel() {
    if (!this.p) return;
    const h = this.actor.hero;
    if (h.armHook === this.hook) h.armHook = this.p.prevHook;
    h.twist = h.bend = h.dip = 0;
    this.p = null;
    this.queued = false;
  }

  /**
   * Button down: the fist comes back to the chin and, held, keeps winding up (shoulder turned
   * further away, knees sinking) - let go and it's thrown, as hard as it was wound. A quick
   * click is a jab, thrown straight through. Pressed while a punch is still out: the next one
   * (other hand) follows it.
   */
  press() {
    this.down = true;
    const A = this.actor, h = A.hero;
    if (A.mode !== 'anim' || h.action) return;
    if (this.p) { if (!this.p.cocking && this.p.t > this.p.T1 + 0.03) this.queued = true; return; }
    this.start(false);
  }
  /** Button up: throw it. */
  release() {
    this.down = false;
    const P = this.p;
    if (P?.cocking) this.throwIt(P);
  }
  /** The button's gone (menu, focus lost): a wind-up is let down, not thrown. */
  letGo() {
    this.down = false;
    if (this.p?.cocking) this.cancel();
  }
  /** A punch thrown straight off (the people on the street; no winding up). */
  punch() {
    const A = this.actor, h = A.hero;
    if (A.mode !== 'anim' || h.action) return;
    if (this.p) { if (!this.p.cocking && this.p.t > 0.16) this.queued = true; return; }
    this.start(true);
  }

  /** Arm i (0: left, 1: right) cut off (slice.js / chop.js): no fist to throw with it. */
  armGone(i) {
    const P = this.actor.rd?.parts, n = i ? 'R' : 'L';
    return !!(P?.['upper' + n]?.gone || P?.['fore' + n]?.gone);
  }

  start(go) {
    const h = this.actor.hero;
    let i = this.next;
    // (only the arms still on throw punches: both gone, no punch at all)
    if (this.armGone(i)) i = 1 - i;
    if (this.armGone(i)) return;
    this.next = 1 - i;
    this.p = { i, t: 0, hit: new Set(), prevHook: h.armHook, prev: null, whoosh: false, tgt: this.acquire(), lunged: 0,
      cocking: true, hold: 0, c: 0, ...this.timing(0) };
    h.armHook = this.hook;
    if (go) this.throwIt(this.p);
  }
  /** The punch's beats for a wind-up of c: a haymaker takes a hair longer out, and to recover. */
  timing(c) {
    const T1 = 0.07, T2 = T1 + 0.07 + 0.025 * c, T3 = T2 + 0.1;
    return { T1, T2, T3, dur: T3 + 0.2 + 0.14 * c };
  }
  throwIt(P) {
    if (!P.cocking) return;
    P.cocking = false;
    Object.assign(P, this.timing(P.c));
    // (aimed where we're looking now, not where we were when it came back)
    const t = this.acquire();
    if (t) P.tgt = t;
  }

  /**
   * Who this punch is thrown at: the head / chest / belly in front of us that's nearest where
   * we're looking (the crosshair), within a step. The fist then tracks that spot all the way in
   * (and we step into it if it's a little far), so a punch thrown at someone lands on them.
   */
  acquire() {
    const A = this.actor, h = A.hero, O = V();
    bodyFrame(h, O, _yq);
    const fwd = h.forward(V()), ap = this.ctx.aimPoint;
    const useAim = ap && ap.distanceTo(O) < 3;
    let best = null, bs = Infinity;
    for (const o of this.ctx.actors) {
      if (o === A || o.seat || !o.rd) continue;
      const c = o.mode === 'ragdoll' ? o.rd.pos('chest', V()) : o.groups.chest.getWorldPosition(V());
      if (c.distanceToSquared(O) > 2.4 * 2.4) continue;
      for (const name of ['head', 'chest', 'spine']) {
        const pn = partNear(o, name, O);
        if (!pn) continue;
        const d = pn.center.clone().sub(O);
        const hz = Math.hypot(d.x, d.z);
        if (hz > 1.45 || d.y < -1.1 || d.y > 0.6) continue;
        const cos = hz > 1e-3 ? (d.x * fwd.x + d.z * fwd.z) / hz : 1;
        if (cos < 0.5) continue;
        const score = (1 - cos) * 3 + hz * 0.5 + (useAim ? Math.min(ap.distanceTo(pn.center), 1.5) * 1.6 : 0) + (name === 'spine' ? 0.1 : 0);
        if (score < bs) { bs = score; best = { actor: o, part: name }; }
      }
    }
    return best;
  }

  /** The fist landed on `actor`'s `part` at `point` (normal into them), moving at `vel`. */
  connect(P, actor, part, point, normal, vel, yq, dir) {
    P.hit.add(actor);
    // a punch into someone's raised weapon: it hurts you more than them
    if (blocks(actor, this.actor, point)) {
      guardHit(actor, vel.clone().multiplyScalar(0.6), this.actor, 0.6 + 0.4 * P.c, this.ctx.sfx);
      if (actor.remote) actor.onRemoteHit?.('guard', vel.clone().multiplyScalar(0.6), 0.6, this.actor);
      P.stop = 0.1;
      P.hitAt = P.t;
      return;
    }
    const head = part === 'head' || part === 'neck';
    // the blow carries the body's weight behind it: along the punch, however it met them
    const dirW = dir.clone().applyQuaternion(yq);
    // (only ever away from us: a fist caught drifting back mid-hold never drags them in)
    // (wound up: the whole body's weight in it - it hurts more, shoves further, stops harder)
    const c = P.c;
    const push = dirW.multiplyScalar(clamp(vel.dot(dirW), 8 + 5 * c, 14 + 9 * c));
    actor.struck(part, point, push, normal,
      { kind: 'fist', mass: 6 + 5 * c, sev: 0.52 * (1 + 1.25 * c), ref: 8, maxImp: (head ? 58 : 78) * (1 + 0.9 * c) }, this.actor);
    this.ctx.sfx?.('punch', 0.85 + 0.15 * c, { rate: (0.88 + Math.random() * 0.2) * (1 - 0.18 * c) });
    this.ctx.sfx?.('impact', (head ? 0.3 : 0.45) + 0.4 * c, { rate: 0.55 - 0.1 * c });
    this.ctx.impact?.((head ? 0.17 : 0.12) * (1 + 1.2 * c), this.actor, actor);
    P.stop = (head ? 0.09 : 0.075) + 0.07 * c;
    P.hitAt = P.t;
  }

  update() {
    const A = this.actor;
    if (this.p && (A.mode !== 'anim' || A.hero.action || A.hero.armHook !== this.hook || this.armGone(this.p.i))) this.cancel();
  }

  pose(h, dt) {
    const P = this.p;
    if (!P) return;
    // whatever else the arms were doing (holding a wound) carries on underneath
    if (P.prevHook) {
      P.prevHook(h, dt);
      // a hook that retires itself (wound let go) hands the arms back to us
      if (h.armHook !== this.hook) { P.prevHook = h.armHook; h.armHook = this.hook; }
    }
    // hit-stop: the fist stays buried in them for a beat
    P.t += dt * (P.stop > 0 ? 0.05 : 1);
    P.stop = Math.max(0, (P.stop || 0) - dt);
    // held: it waits back by the chin, winding up further the longer it's held
    // (the first moment of a hold is still just a jab: a click never becomes a haymaker)
    if (P.cocking && P.t >= P.T1) {
      P.t = P.T1;
      P.hold += dt;
      P.c = smooth(clamp((P.hold - 0.06) / 0.6, 0, 1));
    }
    const t = P.t, a = h.arms[P.i], side = a.side, c = P.c;
    const O = V(), yq = _yq;
    bodyFrame(h, O, yq);
    const iq = yq.clone().invert();
    // loco hand (where it would be) in the body frame
    a.hand.updateWorldMatrix(true, false);
    const lw = V(), lwq = Q();
    a.hand.matrixWorld.decompose(lw, lwq, _s);
    const loco = lw.clone().sub(O).applyQuaternion(iq), locoQ = iq.clone().multiply(lwq);
    // aim: at the one it's thrown at (tracked as they move), else the crosshair if it's on
    // something close in front, else straight ahead
    const sh = V(side * 0.185, 0, 0);
    let dir = V(0, -0.08, 1), want = 0.56, tp = null;
    const T = P.tgt && !P.hit.has(P.tgt.actor) ? partNear(P.tgt.actor, P.tgt.part, O) : null;
    if (T) {
      tp = T.point;
      const to = tp.clone().sub(O).applyQuaternion(iq).sub(sh);
      if (to.z > 0.02 && to.length() < 1.7) {
        const yaw = clamp(Math.atan2(to.x, to.z), -0.8, 0.8), pitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.95, 0.6);
        dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        want = to.length() + 0.07; // (through them, not up to them)
      } else tp = null;
    }
    const ap = this.ctx.aimPoint;
    if (!tp && ap) {
      const to = ap.clone().sub(O).applyQuaternion(iq).sub(sh);
      if (to.z > 0.2 && to.length() < 1.6) {
        const yaw = clamp(Math.atan2(to.x, to.z), -0.45, 0.45), pitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.7, 0.45);
        dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      }
    }
    dir.normalize();
    // coil (fist cocked back by the chin, shoulder turned away, knees give) -> the whole body
    // unwinds into it, the fist accelerating all the way to the target -> buried a beat
    // (driven on through when it lands) -> back to the side
    // (wound up: drawn further back past the chin, and at full wind it trembles, ready)
    const guard = V(side * (0.15 + 0.035 * c), -0.14 + 0.025 * c, 0.13 - 0.11 * c), guardQ = fistQ(V(0, 0.3 - 0.1 * c, 1), side);
    if (P.cocking && c > 0.97) guard.add(V(Math.sin(P.hold * 71) * 0.004, Math.sin(P.hold * 53) * 0.004, 0));
    // as far as the arm goes; further than that, the feet step in to close it (by the time
    // the fist gets there)
    const ARM = 0.6 * (h.S || 1);
    const reach = Math.min(want, ARM) + (P.hitAt !== undefined ? 0.04 : 0);
    const T2_ = P.T2;
    // (a haymaker steps further in behind it)
    if (tp && !P.cocking && P.hitAt === undefined && t < T2_ && want > ARM && P.lunged < 0.45 + 0.35 * c) {
      const lw_ = tp.clone().sub(O).setY(0);
      const sp = Math.min(4.5 + 2 * c, (want - ARM) / Math.max(0.04, T2_ - t));
      if (lw_.lengthSq() > 1e-6) {
        h.lunge = lw_.normalize().multiplyScalar(sp);
        P.lunged += sp * dt;
      }
    }
    const out = sh.clone().addScaledVector(dir, reach).add(V(-side * 0.04, 0, 0)), outQ = fistQ(dir, side);
    const { T1, T2, T3 } = P;
    let p, q, w = 1, live = false, tw = 0, bend = 0, dip = 0;
    const twist = -side * 0.62; // right fist: right shoulder drives forward
    // wound up: turned further away, sunk lower; thrown: turned further through
    const tw0 = -0.45 - 0.45 * c, tw1 = 1.1 + 0.25 * c;
    const bend0 = -0.04 - 0.05 * c, dip0 = 0.14 + 0.09 * c;
    // (a haymaker that finds nothing carries on past: the body leans out after it)
    const bend1 = 0.16 + 0.07 * c, dip1 = 0.08 + 0.04 * c;
    const lean = P.hitAt === undefined && !P.world ? 0.1 * c * clamp((t - T2) / (T3 - T2), 0, 1) : 0;
    if (t < T1 || P.cocking) {
      const k = smooth(Math.min(1, t / T1));
      p = loco.clone().lerp(guard, k); q = locoQ.clone().slerp(guardQ, k);
      tw = twist * tw0 * k; bend = bend0 * k; dip = dip0 * k;
    } else if (t < T2) {
      // accelerating the whole way: it's at full speed when it meets them
      const u = (t - T1) / (T2 - T1), k = u * u * (1.6 - 0.6 * u);
      p = guard.clone().lerp(out, k); q = guardQ.clone().slerp(outQ, Math.min(1, u * 1.4));
      tw = lerp(tw0, tw1, ease(u)) * twist; bend = lerp(bend0, bend1, u); dip = lerp(dip0, dip1, u); live = true;
    } else if (t < T3) {
      p = out.clone(); q = outQ.clone(); tw = twist * tw1; bend = bend1 + lean; dip = dip1; live = true;
    } else {
      const k = smooth((t - T3) / (P.dur - T3));
      p = out.clone().lerp(loco, k); q = outQ.clone().slerp(locoQ, k); tw = twist * tw1 * (1 - k); bend = (bend1 + lean) * (1 - k); dip = dip1 * (1 - k); w = 1 - k;
    }
    h.twist = tw; h.bend = bend; h.dip = dip;
    const wp = p.applyQuaternion(yq).add(O), wq = yq.clone().multiply(q);
    const fwd = h.forward(V());
    const outSide = V(fwd.z, 0, -fwd.x).multiplyScalar(side);
    _pole.copy(outSide).multiplyScalar(0.8).addScaledVector(UP, -0.7).addScaledVector(fwd, -0.3).normalize();
    // IK from the (twisted) shoulder; if the pose ends past reach the arm just straightens
    poseArm(h, a, wp, wq, _pole);
    curl(a, lerp(0.3, 1.55, Math.min(1, w * 1.5)));
    if (!P.whoosh && live) { P.whoosh = true; this.ctx.sfx?.('whoosh', 0.42 + 0.35 * c, { rate: 1.25 - 0.35 * c }); }

    // contact: knuckles, swept from last frame
    a.hand.updateWorldMatrix(true, false);
    const k0 = V(side * -0.005, -0.04, 0).applyMatrix4(a.hand.matrixWorld);
    const k1 = V(side * -0.005, -0.1, 0.01).applyMatrix4(a.hand.matrixWorld);
    if (live && P.prev && P.hitAt === undefined) {
      const vel = k1.clone().sub(P.prev[1]).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 20);
      // (a fat knuckle radius: a fist that brushes them is a fist that lands)
      const hit = sweep(P.prev[0], P.prev[1], k0, k1, 0.07, this.ctx.actors, this.actor, P.hit);
      // a weapon (or a gun) held in front of where it's going: the fist stops on it
      const pr = parry(P.prev[0], P.prev[1], k0, k1, 0.05, this.actor, hit ? hit.k : 1);
      if (pr) {
        P.hit.add(pr.owner);
        parriedBlow(pr, vel.clone().multiplyScalar(0.6), this.actor, 0.6 + 0.4 * P.c, this.ctx.sfx);
        P.stop = 0.1;
        P.hitAt = P.t;
      } else if (hit) this.connect(P, hit.actor, hit.part, hit.point, hit.normal, vel, yq, dir);
      else if (P.tgt && t >= T2 - 1e-3 && !P.hit.has(P.tgt.actor)) {
        // fully out and it's right there on the one it was thrown at (they moved, the arm fell
        // a hair short): it lands
        const N = partNear(P.tgt.actor, P.tgt.part, k1);
        if (N && N.dist < 0.16) this.connect(P, P.tgt.actor, P.tgt.part, N.point, N.normal, vel, yq, dir);
      }
    }
    if (live && P.prev && !P.world && this.ctx.hitWorld) {
      const vel = k1.clone().sub(P.prev[1]).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 20);
      if (vel.length() > 1.5 && this.ctx.hitWorld(k1, vel, 4 + 8 * c, this.actor)) { P.world = true; P.stop = 0.05 + 0.04 * c; this.ctx.sfx?.('punch', 0.4 + 0.3 * c); }
    }
    P.prev = [k0, k1];

    if (t >= P.dur) {
      const again = this.queued;
      this.cancel();
      // (the next one of a combo: still held, it winds up; let go already, it's thrown)
      if (again) this.start(!this.down);
    }
  }
}

/** Local quaternion for an open hand pushing along `dir`: palm out, fingers up (tipped in). */
export function palmQ(dir, side, out = Q()) {
  const y = V(side * 0.35, -1, 0).normalize();               // (fingers run along -y)
  const x = dir.clone().normalize().multiplyScalar(-side);   // palm normal (= -side·X) faces out
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = V().crossVectors(x, y);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}

// ---------------------------------------------------------------------------------------
// The shove: both hands come up to the chest, palms out, and drive into them with a step and
// the body leaning in behind it. They're sent flying at the moment the palms get there.
// ---------------------------------------------------------------------------------------
export class Shove {
  /** ctx: { sfx, impact } */
  constructor(actor, ctx) {
    this.actor = actor;
    this.ctx = ctx;
    this.p = null;
    this.hook = (h, dt) => this.pose(h, dt);
  }
  get busy() { return !!this.p; }

  cancel() {
    if (!this.p) return;
    const h = this.actor.hero;
    if (h.armHook === this.hook) h.armHook = this.p.prevHook;
    h.twist = h.bend = h.dip = 0;
    this.p = null;
  }

  /**
   * Shove `target` (an actor), then `onPush(dir)` once the hands land (dir: flat, away from
   * us). Without a target it's shoved at thin air.
   */
  start(target, onPush) {
    const A = this.actor, h = A.hero;
    if (A.mode !== 'anim' || h.action || this.p) return false;
    this.p = { t: 0, target, onPush, done: false, prevHook: h.armHook, lunged: 0 };
    h.armHook = this.hook;
    this.ctx.sfx?.('whoosh', 0.3, { rate: 0.9 });
    return true;
  }

  update() {
    const A = this.actor;
    if (this.p && (A.mode !== 'anim' || A.hero.action || A.hero.armHook !== this.hook)) this.cancel();
  }

  land(P, dirW) {
    P.done = true;
    P.hitT = P.t;
    this.ctx.sfx?.('punch', 0.5, { rate: 0.7 });
    this.ctx.impact?.(0.08, this.actor, P.target);
    P.onPush?.(dirW);
  }

  pose(h, dt) {
    const P = this.p;
    if (!P) return;
    P.t += dt;
    const t = P.t;
    const O = V(), yq = _yq;
    bodyFrame(h, O, yq);
    const iq = yq.clone().invert();
    // where their chest is (body frame), if they're still in front of us
    let to = null;
    const T = P.target;
    if (T && !P.done) {
      const c = T.mode === 'ragdoll' ? T.rd.pos('chest', V()) : T.groups.chest.getWorldPosition(V());
      to = c.sub(O).applyQuaternion(iq);
      if (to.z < 0.05 || to.length() > 2) to = null;
    }
    const dir = to ? to.clone().setY(clamp(to.y, -0.25, 0.2)).normalize() : V(0, -0.05, 1).normalize();
    const want = to ? Math.hypot(to.x, to.z) - 0.14 : 0.55;
    const ARM = 0.55 * (h.S || 1);
    const reach = clamp(want, 0.3, ARM);
    // beats: hands up -> drive (step in, lean) -> held out -> back
    const T1 = 0.12, T2 = 0.26, T3 = 0.34, DUR = 0.62;
    // step in to close the gap (by the time the hands get there)
    if (to && !P.done && t > T1 * 0.5 && t < T2 && want > ARM && P.lunged < 0.6) {
      const flat = V(to.x, 0, to.z).applyQuaternion(yq);
      const sp = Math.min(4, (want - ARM) / Math.max(0.05, T2 - t));
      if (flat.lengthSq() > 1e-6) { h.lunge = flat.normalize().multiplyScalar(sp); P.lunged += sp * dt; }
    }
    let k = 0, tw = 0, bend = 0, dip = 0, w = 1;
    if (t < T1) { k = -smooth(t / T1); bend = -0.05 * -k; dip = 0.1 * -k; }
    else if (t < T2) { const u = (t - T1) / (T2 - T1); k = u * u * (1.5 - 0.5 * u); bend = lerp(-0.05, 0.22, ease(u)); dip = lerp(0.1, 0.06, u); }
    else if (t < T3) { k = 1; bend = 0.22; dip = 0.06; }
    else { const u = smooth((t - T3) / (DUR - T3)); k = 1 - u; bend = 0.22 * (1 - u); dip = 0.06 * (1 - u); w = 1 - u; }
    h.twist = tw; h.bend = bend; h.dip = dip;
    const fwd = h.forward(V());
    for (const a of h.arms) {
      const side = a.side;
      a.hand.updateWorldMatrix(true, false);
      const lw = V(), lwq = Q();
      a.hand.matrixWorld.decompose(lw, lwq, _s);
      const loco = lw.clone().sub(O).applyQuaternion(iq), locoQ = iq.clone().multiply(lwq);
      // chest height, palms out, elbows bent back
      const ready = V(side * 0.16, -0.14, 0.16), readyQ = palmQ(V(0, 0.1, 1), side);
      const out = V(side * 0.15, 0, 0).addScaledVector(dir, reach), outQ = palmQ(dir, side);
      let p, q;
      if (t < T1) { const u = -k; p = loco.clone().lerp(ready, u); q = locoQ.clone().slerp(readyQ, u); }
      else if (t < T3) { p = ready.clone().lerp(out, k); q = readyQ.clone().slerp(outQ, Math.min(1, k * 1.3)); }
      else { p = out.clone().lerp(loco, 1 - k); q = outQ.clone().slerp(locoQ, 1 - k); }
      const wp = p.applyQuaternion(yq).add(O), wq = yq.clone().multiply(q);
      const outSide = V(fwd.z, 0, -fwd.x).multiplyScalar(side);
      _pole.copy(outSide).multiplyScalar(0.7).addScaledVector(UP, -0.8).addScaledVector(fwd, -0.25).normalize();
      poseArm(h, a, wp, wq, _pole);
      curl(a, lerp(0.3, 0.12, Math.min(1, w * 1.5))); // fingers open, pushing
    }
    // the palms get there: off they go (or, if they stepped away, a little short is enough)
    if (!P.done && t >= T1 && ((to && k > 0.55 && want - reach < 0.12) || t >= T2)) {
      // (they got clear before the hands arrived: it's a push at air)
      if (to && want - reach < 0.3) this.land(P, V(to.x, 0, to.z).applyQuaternion(yq).normalize());
      else if (t >= T2) P.done = true;
    }
    if (t >= DUR) this.cancel();
  }
}
