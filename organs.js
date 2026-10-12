import { settings } from './settings.js';
import * as THREE from 'three';
import { inkOf, VOMIT } from './inks.js';

/** Hooks out to the game: sound(name, at, vol, rate) - a sound heard from where it happens. */
export const ORGAN_FX = { sound: null };

/*
  Anatomy inside one character: organs, major vessels and the skeleton, each a simple shape
  riding its bone. A bullet's path through the body is traced against all of them, and what it
  passes through decides what happens:

    brain            - dead on the spot
    heart            - collapses, bleeds out in seconds
    lungs            - short of breath, coughs up blood, weakens and slowly drowns if both go
    liver            - heavy internal bleeding
    stomach / guts   - doubled up in pain, slow bleed, stays down a long time
    spine            - neck: everything goes limp; back: the legs go
    femoral artery   - spurting, fast bleed-out
    femur / tibia    - that leg can't carry weight: can't get up
    humerus / forearm- that arm hangs useless (drops the gun)
    ribs / pelvis / skull - pain; skull can knock you out

  Blood loss (surface wounds + internal bleeding) is tracked as a fraction of blood volume:
  weakening, then fainting, then death. Big falls can break bones too.

  Blunt trauma (blunt(): punches, kicks, stomps, clubs) builds up per region, and does its
  harm through the same organs and the same blood: a head concussed, knocked out, bleeding
  inside the skull and finally the brain gone; ribs cracking and then a lung punctured; a
  liver or spleen ruptured in the belly; bones snapping; bruising that bleeds into the tissue.

  Brain damage (brainDmg, 0..1) builds up from blows and knocks to the head and shots that crack
  the skull without reaching the brain. It shows in what the body does (neuro.js): twitches when
  lying there; knocked out badly, posturing (decorticate, then decerebrate as it gets worse);
  seizures - right after a bad knock, or out of nowhere later on; and after a fatal brain injury,
  a last fit or posture as the body dies.

  Pallor: the skin drains of colour as the blood goes - paler, greyer, a little blue - and keeps
  greying after death.

  undead (the zombies): no pain, no shock, lungs and heart don't matter, they keep coming on
  very little blood. What stops one: the brain (a shot, or the head stomped in), the spine,
  broken legs (down for good), or so much gone that there's nothing left to move it.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);

let MATS = null;
function mats() {
  return (MATS ||= {
    lung: new THREE.MeshStandardMaterial({ color: 0xd88d8e, roughness: 0.6 }),
    heart: new THREE.MeshStandardMaterial({ color: 0x8c1a22, roughness: 0.45 }),
    liver: new THREE.MeshStandardMaterial({ color: 0x5c1814, roughness: 0.4 }),
    stomach: new THREE.MeshStandardMaterial({ color: 0xc98a7c, roughness: 0.5 }),
    gut: new THREE.MeshStandardMaterial({ color: 0xd9a090, roughness: 0.45 }),
    brain: new THREE.MeshStandardMaterial({ color: 0xd8b2ae, roughness: 0.55 }),
    vessel: new THREE.MeshStandardMaterial({ color: 0x9a1020, roughness: 0.4 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.7 }),
  });
}
const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const _a = V(), _b = V(), _d = V(), _m = new THREE.Matrix4();
const _col = new THREE.Color(), _hsl = {}, _ash = new THREE.Color(0xb7bcc6);
// bodies whose "skin" isn't flesh: no pallor
const NO_PALLOR = new Set(['psy', 'fallen', 'birch', 'spider', 'papyrus', 'zombie', 'seek']);

// what each tissue does when a round goes through it
const EFFECT = {
  brain:   { bleed: 0.6, lethal: true },
  heart:   { bleed: 5, internal: 0.05, die: [2, 5] },
  lung:    { bleed: 1.3, internal: 0.004, lung: 1 },
  liver:   { bleed: 1.8, internal: 0.009, pain: 0.6 },
  stomach: { bleed: 1.1, internal: 0.003, gut: 1 },
  gut:     { bleed: 1.1, internal: 0.003, gut: 1 },
  artery:  { bleed: 4.5, internal: 0.012 },
  spine:   { bleed: 0.4, spine: true },
  femur:   { bleed: 1.2, legBone: true },
  tibia:   { bleed: 0.8, legBone: true },
  humerus: { bleed: 0.8, armBone: true },
  forearm: { bleed: 0.6, armBone: true },
  ribs:    { bleed: 0.3, pain: 0.4 },
  pelvis:  { bleed: 0.6, pain: 0.7, legBone: 'both' },
  skull:   { bleed: 0.4, knock: 0.6 },
};

export class Organs {
  constructor(actor, sys) {
    this.actor = actor;
    this.sys = sys;
    this.list = [];
    // centre-lines of the tube-shaped things (ribs, the gut's coils), in their bones' frames:
    // not hit shapes, only for where a cut crosses them (slice.js)
    this.tubes = [];
    this.maxVol = rnd(4.7, 5.5); // litres of blood in a full body
    this.blood = 1;           // fraction of that left
    this.internal = 0;        // internal bleeding, fraction of volume per second
    this.state = {
      limp: new Set(),        // parts with no muscle left
      noRise: false,          // can't get up
      lung: 0,                // 0..2 lungs holed
      gut: 0, pain: 0,
      armOut: [false, false], // [L, R] arm useless
      dieT: -1,               // heart: seconds left
      out: false,             // unconscious
    };
    this.coughT = rnd(1, 3);
    this.nausea = 0;          // 0..1+: how sick; past 1, up it comes (vomit)
    this.vomitCD = 0;         // s: till it can come up again
    this.fit = null;          // a bout of throwing up going on: { t, dur, next, bloody }
    this.brainDmg = 0;        // 0..1: brain injury short of death (concussions adding up, a cracked skull, a bleed)
    this.fitT = rnd(8, 30);   // till the next chance of a seizure (a damaged brain)
    this.build();
  }

  // ---------- anatomy ----------
  ell(name, kind, obj, c, r, mat, shell = 0) {
    const m = new THREE.Mesh(SPHERE, mat);
    m.position.copy(c); m.scale.copy(r);
    this.add(m, obj, name);
    this.list.push({ name, kind, obj, type: 'ell', c, r, shell });
  }
  cap(name, kind, obj, a, b, r, mat, visual = true) {
    if (visual) {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), _d.subVectors(b, a).normalize());
      this.add(m, obj, name);
    }
    this.list.push({ name, kind, obj, type: 'cap', a, b, r });
  }
  /**
   * Organs and bones are rigid shapes riding single bones, but the body around them bends and
   * skins (torso twist, shoulders, hips), so any visible mesh pokes through the skin in some
   * pose. They exist only as hit shapes: the body never shows its insides.
   */
  add(m) { m.geometry !== SPHERE && m.geometry.dispose(); }


  build() {
    const h = this.actor.hero, M = mats();
    const chest = h.chest, spine = h.spine, hips = h.hips, neck = h.neck, head = h.head;
    // chest cavity (chest group: y 0 = 0.3 above the hips, +x = left, +z = front)
    this.ell('lungL', 'lung', chest, V(0.072, 0.1, -0.008), V(0.058, 0.11, 0.068), M.lung);
    this.ell('lungR', 'lung', chest, V(-0.075, 0.1, -0.008), V(0.062, 0.11, 0.068), M.lung);
    this.ell('heart', 'heart', chest, V(0.022, 0.045, 0.035), V(0.042, 0.052, 0.038), M.heart);
    // carotids up either side of the windpipe
    for (const sd of [1, -1]) this.cap(sd > 0 ? 'carotidL' : 'carotidR', 'artery', neck, V(sd * 0.026, -0.02, 0.022), V(sd * 0.03, 0.09, 0.018), 0.009, M.vessel);
    this.cap('aorta', 'artery', chest, V(0.01, 0.1, 0.02), V(0.0, -0.15, -0.045), 0.011, M.vessel);
    // abdomen
    this.ell('liver', 'liver', chest, V(-0.06, -0.045, 0.02), V(0.085, 0.045, 0.06), M.liver);
    this.ell('stomach', 'stomach', chest, V(0.055, -0.055, 0.035), V(0.05, 0.04, 0.035), M.stomach);
    {
      // small intestine: a coiled tube packed into the belly
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, a = t * Math.PI * 9;
        pts.push(V(Math.cos(a) * 0.075 * (0.4 + 0.6 * Math.abs(Math.sin(t * 7))), 0.17 - t * 0.17, 0.035 + Math.sin(a) * 0.025));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const g = new THREE.TubeGeometry(curve, 160, 0.015, 8, false);
      const m = new THREE.Mesh(g, M.gut);
      this.add(m, hips, 'guts');
      // (for a cut: loops packed every which way through the belly, the way a gut lies - so a
      // cut from any side goes through a dozen of them, not the one coil)
      const gp = [], gc = V(0, 0.085, 0.035), gr = V(0.1, 0.1, 0.05);
      for (let i = 0; i <= 320; i++) {
        const t = (i / 320) * Math.PI * 2;
        const s = V(Math.sin(5 * t + 0.7), Math.sin(7 * t), Math.sin(3 * t + 1.9));
        if (s.length() > 0.82) s.setLength(0.82);
        gp.push(s.multiply(gr).add(gc));
      }
      this.tubes.push({ kind: 'gut', obj: hips, pts: gp, r: 0.014 });
      this.list.push({ name: 'guts', kind: 'gut', obj: hips, type: 'ell', c: V(0, 0.085, 0.035), r: V(0.1, 0.1, 0.05) });
    }
    this.cap('iliac', 'artery', hips, V(0, 0.08, -0.04), V(0, -0.02, -0.03), 0.009, M.vessel);
    // skeleton
    for (let i = 0; i < 7; i++) {
      const y = 0.0 + i * 0.034, k = Math.sin(0.5 + (i / 6) * 2.2);
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 5, 28), M.bone);
      rib.rotation.x = Math.PI / 2;
      rib.position.set(0, y, 0);
      rib.scale.set(0.115 + 0.04 * k, 0.082 + 0.012 * k, 0.12);
      this.add(rib, chest, 'ribs');
      // (its centre-line, for a cut to find: the ring the torus makes, round the chest)
      const sx = rib.scale.x, sz = rib.scale.y, rp = [];
      for (let j = 0; j <= 40; j++) { const a = (j / 40) * Math.PI * 2; rp.push(V(Math.cos(a) * sx, y, Math.sin(a) * sz)); }
      this.tubes.push({ kind: 'rib', obj: chest, pts: rp, r: 0.0065 });
    }
    this.list.push({ name: 'ribs', kind: 'ribs', obj: chest, type: 'ell', c: V(0, 0.11, 0), r: V(0.16, 0.14, 0.095), shell: 0.6 });
    const pel = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 6, 24), M.bone);
    pel.rotation.x = Math.PI / 2 - 0.3;
    pel.position.set(0, -0.01, -0.005);
    pel.scale.set(0.115, 0.075, 0.25);
    this.add(pel, hips, 'pelvis');
    this.list.push({ name: 'pelvis', kind: 'pelvis', obj: hips, type: 'ell', c: V(0, -0.01, -0.005), r: V(0.13, 0.08, 0.075), shell: 0.45 });
    this.cap('lumbar', 'spine', hips, V(0, -0.03, -0.062), V(0, 0.1, -0.066), 0.017, M.bone);
    this.cap('spineMid', 'spine', spine, V(0, 0, -0.066), V(0, 0.2, -0.07), 0.017, M.bone);
    this.cap('thoracic', 'spine', chest, V(0, 0, -0.07), V(0, 0.26, -0.06), 0.016, M.bone);
    this.cap('cervical', 'spine', neck, V(0, -0.01, -0.012), V(0, 0.1, -0.016), 0.014, M.bone);
    // cranium around the head mesh's own centre (the face group, 0.08 up in the head)
    this.ell('skull', 'skull', head, V(0, 0.1, 0.004), V(0.068, 0.082, 0.082), M.bone, 1);
    this.ell('brain', 'brain', head, V(0, 0.105, 0.002), V(0.058, 0.062, 0.072), M.brain);
    h.legs.forEach((l, i) => {
      const n = i ? 'R' : 'L';
      this.cap('femur' + n, 'femur', l.thigh, V(0, -0.01, 0), V(0, -0.42, 0.004), 0.016, M.bone);
      this.cap('femoral' + n, 'artery', l.thigh, V(-l.side * 0.02, -0.05, 0.022), V(-l.side * 0.008, -0.3, 0.008), 0.008, M.vessel);
      this.cap('popliteal' + n, 'artery', l.shin, V(0, 0.03, -0.02), V(0, -0.1, -0.018), 0.007, M.vessel);
      this.cap('tibia' + n, 'tibia', l.shin, V(0, -0.01, 0.01), V(0, -0.41, 0.004), 0.014, M.bone);
    });
    h.arms.forEach((a, i) => {
      const n = i ? 'R' : 'L';
      this.cap('humerus' + n, 'humerus', a.upper, V(0, -0.02, 0), V(0, -0.27, 0), 0.012, M.bone);
      this.cap('brachial' + n, 'artery', a.upper, V(-a.side * 0.016, -0.03, 0.006), V(-a.side * 0.012, -0.25, 0.008), 0.007, M.vessel);
      this.cap('forearm' + n, 'forearm', a.fore, V(0, -0.01, 0), V(0, -0.25, 0), 0.011, M.bone);
    });
  }

  /** Where along world segment p0->p1 (0..1) the segment enters this tissue, or -1. */
  hitT(o, p0, p1) {
    o.obj.updateWorldMatrix(true, false);
    _m.copy(o.obj.matrixWorld).invert();
    const a = _a.copy(p0).applyMatrix4(_m), b = _b.copy(p1).applyMatrix4(_m);
    if (o.type === 'ell') {
      // unit sphere space
      const A = a.clone().sub(o.c).divide(o.r), B = b.clone().sub(o.c).divide(o.r);
      const d = B.sub(A);
      const qa = d.dot(d), qb = 2 * A.dot(d), qc = A.dot(A) - 1;
      const disc = qb * qb - 4 * qa * qc;
      if (disc < 0 || qa < 1e-12) return -1;
      const s = Math.sqrt(disc);
      const t0 = (-qb - s) / (2 * qa), t1 = (-qb + s) / (2 * qa);
      if (t1 < 0 || t0 > 1) return -1;
      return Math.max(0, t0);
    }
    // capsule: closest approach of the two segments
    const u = b.clone().sub(a), v = o.b.clone().sub(o.a), w = a.clone().sub(o.a);
    const uu = u.dot(u), uv = u.dot(v), vv = v.dot(v), uw = u.dot(w), vw = v.dot(w);
    const den = uu * vv - uv * uv;
    let s = den > 1e-12 ? clamp((uv * vw - vv * uw) / den, 0, 1) : 0;
    let t = clamp((uv * s + vw) / vv, 0, 1);
    s = clamp((uv * t - uw) / uu, 0, 1);
    const pa = a.clone().addScaledVector(u, s), pb = o.a.clone().addScaledVector(v, t);
    return pa.distanceTo(pb) < o.r ? s : -1;
  }

  /** Tissues a round passes through from `entry` to `exit` (world), in order. */
  trace(entry, exit) {
    const hits = [];
    for (const o of this.list) {
      const t = this.hitT(o, entry, exit);
      if (t < 0) continue;
      if (o.shell && Math.random() > o.shell) continue; // slipped between ribs
      hits.push({ o, t });
    }
    return hits.sort((x, y) => x.t - y.t).map((x) => x.o);
  }

  // ---------- injuries ----------
  /**
   * A round went from entry through the body (to exit, if it left). Applies each tissue's
   * effect and returns a summary { lethal, bleed, down } for the shot reaction.
   */
  /** A vampire (look.vampire, vampire.js): no organ harm at all, and it bleeds slowly. */
  get vamp() { return !!this.actor.hero?.look?.vampire; }

  shot(entry, dir, exit) {
    if (this.vamp) return { lethal: false, bleed: 0.5, down: false, hits: [] };
    const end = exit || entry.clone().addScaledVector(dir, 0.35);
    const hits = this.trace(entry.clone().addScaledVector(dir, -0.01), end.clone().addScaledVector(dir, 0.01));
    const S = this.state;
    const out = { lethal: false, bleed: 1, down: false, hits: hits.map((o) => o.name) };
    this.nausea += 0.12; // (any wound: the shock of it turns the stomach a little)
    for (const o of hits) {
      const e = EFFECT[o.kind];
      out.bleed = Math.max(out.bleed, e.bleed);
      this.internal += e.internal || 0;
      if (e.lethal) out.lethal = true;
      if (e.die && this.undead) continue;
      if (e.die) { S.dieT = S.dieT < 0 ? rnd(...e.die) : Math.min(S.dieT, 1); out.down = true; }
      if (e.lung) { S.lung = Math.min(2, S.lung + 1); }
      if (e.gut) { S.gut = 1; out.down = true; this.nausea += rnd(0.6, 1.1); this.gutBlood = true; }
      if (e.pain) S.pain = Math.min(1, S.pain + e.pain);
      if (e.knock && Math.random() < e.knock) this.faint(rnd(4, 9));
      if (o.kind === 'skull') this.hurtBrain(rnd(0.25, 0.5), true);
      if (e.lethal) this.brainDeath = true;
      if (e.spine) this.spine(o.obj);
      if (e.legBone) this.breakLeg(e.legBone === 'both' ? null : o.name.slice(-1));
      if (e.armBone) this.breakArm(o.name.slice(-1));
      if (o.kind === 'artery') out.down = true;
    }
    if (S.lung || S.dieT >= 0) out.down = true;
    this.apply();
    return out;
  }

  /** A hard landing on part `name` with severity sev: bones can snap. */
  impact(name, sev) {
    const kind = name.replace(/[LR]$/, ''), side = name.slice(-1);
    if (sev < 1.4 || this.vamp) return;
    const p = (sev - 1.4) * 0.4;
    if ((kind === 'shin' || kind === 'thigh' || kind === 'foot') && Math.random() < p) this.breakLeg(side);
    else if ((kind === 'upper' || kind === 'fore') && Math.random() < p) this.breakArm(side);
    else if (kind === 'head' && Math.random() < p * 1.5) { this.faint(rnd(3, 8)); this.hurtBrain((sev - 1.1) * 0.12, true); }
    else if ((kind === 'chest' || kind === 'spine') && Math.random() < p * 0.6) this.state.pain = Math.min(1, this.state.pain + 0.5);
    else return;
    this.apply();
  }

  spine(obj) {
    const S = this.state, h = this.actor.hero;
    const legs = ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
    for (const n of legs) S.limp.add(n);
    S.noRise = true;
    if (obj === h.neck) {
      // above the arms: nothing below the neck answers any more
      for (const n of ['pelvis', 'spine', 'chest', 'upperL', 'foreL', 'upperR', 'foreR']) S.limp.add(n);
      S.armOut = [true, true];
    }
  }
  breakLeg(side) {
    const S = this.state;
    for (const n of side ? [side] : ['L', 'R']) { S.limp.add('shin' + n); S.limp.add('foot' + n); S.brokenLeg = true; }
    S.noRise = true;
    S.pain = Math.min(1, S.pain + 0.6);
    if (!this.actor.brain.dead) this.actor.onPain?.('shin' + (side || 'L'), 'broke', 1.5);
  }
  breakArm(side) {
    const S = this.state;
    S.limp.add('fore' + side);
    S.limp.add('upper' + side);
    S.armOut[side === 'L' ? 0 : 1] = true;
    S.pain = Math.min(1, S.pain + 0.4);
    if (!this.actor.brain.dead) this.actor.onPain?.('fore' + side, 'broke', 1.2);
  }
  /**
   * A blunt blow of severity sev on part `name` (w: 'fist' | 'blunt' - a club, a kick, a stomp).
   * The damage adds up per region; the blood it costs and the organs it breaks are what hurt.
   */
  blunt(name, sev, w = 'blunt') {
    const A = this.actor, S = this.state, b = A.brain;
    if (b.dead || this.vamp) return;
    const T = (this.trauma ||= {});
    const part = name.replace(/[LR]$/, ''), side = name.slice(-1);
    const s = sev * (w === 'fist' ? 0.75 : 1);
    const t = (T[part] = (T[part] || 0) + s);
    this.total = (this.total || 0) + s;
    const hurt = (k) => { if (!this.undead) S.pain = Math.min(1, S.pain + k); };
    const chance = (p) => Math.random() < p;
    // every solid blow bleeds a little into the tissue; the harder, the more
    this.internal += 0.0005 * s * s;
    hurt(0.06 * s);
    // a beating turns the stomach; a blow to the belly or the head, most of all
    this.nausea += s * (part === 'spine' ? 0.32 : part === 'head' ? 0.14 : 0.06);
    if (part === 'head') {
      // concussion: the more it's taken, the easier the lights go out
      const ko = chance(clamp((s - 0.35) * 0.4 + t * 0.035, 0, this.undead ? 0.35 : 0.85));
      if (ko) this.faint(rnd(1.5, 4) + t * (this.undead ? 0.3 : 0.9));
      // and every blow bruises the brain a little more; past a cracked skull, a lot more
      this.hurtBrain(s * (0.03 + (t > 2.2 ? 0.05 : 0) + (t > 3.5 ? 0.06 : 0)), ko && s > 0.5);
      // a fractured skull, bleeding inside it
      if (t > 2.2 && s > 0.6) { this.internal += 0.0035 * s; hurt(0.2); }
      if (t > 3.5 && s > 0.9 && chance(0.35)) this.faint(rnd(6, 14));
      // caved in: the brain's gone
      if (t > (this.undead ? 4.6 : 5.2)) { this.die(); return; }
      // stamped on: the neck can snap
      if (s > 1.05 && t > 2.8 && chance(0.14)) this.spine(A.hero.neck);
    } else if (part === 'spine' && t > 5 && s > 0.9 && chance(0.25)) this.spine(A.hero.spine); // (the back, hammered: the legs go)
    if (part === 'chest') {
      // ribs crack, then the broken ends go into a lung; stamped on long enough, the heart
      if (s > 0.75 && chance((s - 0.55) * 0.55)) { S.ribs = (S.ribs || 0) + 1; hurt(0.35); this.internal += 0.001; }
      if ((S.ribs || 0) >= 2 && s > 0.7 && chance(0.28)) { S.lung = Math.min(2, S.lung + 1); this.internal += 0.003; }
      if (t > 6 && s > 1.1 && chance(0.2)) {
        if (this.undead) this.internal += 0.02;
        else S.dieT = S.dieT < 0 ? rnd(4, 9) : S.dieT;
      }
    } else if (part === 'spine') {
      // the belly: liver and spleen rupture, the gut takes it
      this.internal += 0.0012 * s * (t > 2 ? 2 : 1);
      if (s > 0.85 && chance((s - 0.6) * 0.45)) { this.internal += 0.007; S.gut = this.undead ? 0 : 1; hurt(0.5); }
    } else if (part === 'thigh' || part === 'shin' || part === 'foot') {
      if (chance(clamp((s - 0.9) * 0.55 + (t > 3 ? 0.15 : 0), 0, 0.7))) this.breakLeg(side);
    } else if (part === 'upper' || part === 'fore') {
      if (chance(clamp((s - 0.85) * 0.6 + (t > 2.5 ? 0.15 : 0), 0, 0.7))) this.breakArm(side);
    }
    // (the undead: beaten until there's nothing left holding it together)
    if (this.undead && this.total > 22) { this.die(); return; }
    this.apply();
  }

  /**
   * The brain takes damage k. knock: it came with a blow bad enough to put them out - the
   * moments right after can bring a fencing response or a seizure.
   */
  hurtBrain(k, knock = false) {
    if (this.undead || this.vamp || k <= 0 || this.actor.brain.dead) return;
    this.brainDmg = clamp(this.brainDmg + k, 0, 1);
    const d = this.brainDmg, N = this.actor.brain.neuro;
    if (!knock || N.ep) return;
    const r = Math.random();
    if (r < 0.12 + d * 0.3) {
      // an impact seizure, a moment after the blow
      this.fitSoon = rnd(0.3, 2.5);
    } else if (r < 0.3 + d * 0.35) {
      this.faint(rnd(3, 8));
      N.fence(rnd(2, 6) + d * 3);
    }
  }
  /** A seizure now: down, out, the fit, then a long daze after it (postictal). */
  seizure(dmg = 0) {
    const A = this.actor, N = A.brain.neuro;
    if (A.brain.dead || this.undead || N.seizing) return;
    const d = Math.max(this.brainDmg, dmg);
    const dur = N.seize(d);
    this.faint(dur + rnd(5, 14) + d * 10);
    if (A.mode !== 'ragdoll') A.goRagdoll('collapse');
  }

  faint(t) { this.state.out = true; this.wakeT = Math.max(this.wakeT || 0, t); this.apply(); }

  /** Litres of blood still in the body. */
  get volume() { return this.blood * this.maxVol; }
  /**
   * How weak the body is, 0..1: mostly how much blood is gone (barely noticeable at first,
   * then a steep slide past ~15%), plus holed lungs and a failing heart.
   */
  get weak() {
    const S = this.state;
    if (this.undead) return clamp((0.55 - this.blood) / 0.45, 0, 0.7);
    // (from ~5% gone it starts to tell; by a third gone, legs that won't hold you)
    const loss = clamp((1 - this.blood - 0.04) / 0.34, 0, 1);
    return clamp(loss ** 1.15 + S.lung * 0.15 + (S.dieT >= 0 ? 0.6 : 0) + this.brainDmg * 0.15, 0, 1);
  }

  /**
   * On your feet while weak: slower, can't run or jump, a drifting unsteady walk, and the odd
   * buckle of the knees that drops you into a stagger.
   */
  limit(ctrl, dt) {
    // (throwing up: stood doubled over, going nowhere)
    if (this.fit && this.actor.mode === 'anim') return { ...ctrl, move: ctrl.move.clone().multiplyScalar(0.1), run: false, jump: false };
    const w = this.weak;
    if (w < 0.04 || this.actor.mode !== 'anim') return ctrl;
    this.swayT = (this.swayT || 0) + dt;
    const t = this.swayT;
    const out = { ...ctrl, move: ctrl.move.clone() };
    if (w > 0.25) out.run = false;
    if (w > 0.4) out.jump = false;
    const m = out.move;
    if (m.lengthSq() > 1e-4) {
      // weave: the heading wanders a little, more the weaker you are
      const a = (Math.sin(t * 1.7) + 0.6 * Math.sin(t * 3.9 + 1.3)) * 0.35 * w;
      const c = Math.cos(a), s_ = Math.sin(a);
      m.set(m.x * c - m.z * s_, m.y, m.x * s_ + m.z * c);
      m.multiplyScalar(1 - 0.8 * w);
    }
    // knees give: a stagger (the brain decides if you catch yourself)
    const moving = m.lengthSq() > 0.01;
    if (w > 0.35 && this.actor.hero.grounded && !this.actor.hero.action && Math.random() < dt * (w - 0.35) * (moving ? 1.4 : 0.6)) {
      this.actor.goRagdoll('stumble', { balance: clamp(0.8 - w * 0.4, 0.35, 0.7), decay: 0.3 + w * 0.4 });
    }
    return out;
  }

  canRise() {
    if (this.undead) return !this.state.noRise && !this.state.out && !this.actor.brain.dead && this.blood > 0.12;
    return !this.state.noRise && !this.state.out && !this.actor.brain.dead && this.blood > 0.66 && this.state.dieT < 0; }
  /** Can this arm (0 = L, 1 = R) hold something? */
  canHold(i) { return !this.state.armOut[i]; }

  /** Push the current state into the muscles' behaviour layer. */
  apply() {
    const S = this.state, b = this.actor.brain;
    b.inj = {
      limp: S.limp,
      weak: Math.min(0.95, this.weak),
      noRise: !this.canRise(),
      out: S.out,
      pain: Math.max(S.pain, S.gut * 0.9, S.lung * 0.4),
      gut: S.gut,
      lung: S.lung,
      brain: this.brainDmg,
    };
  }

  // ---------- per frame ----------
  update(dt) {
    const A = this.actor, S = this.state, b = A.brain;
    this.pallor(dt);
    if (this.fit) this.retch(dt);
    if (b.dead) return;
    // blood loss: what runs out of the wounds + what pools inside
    const lost = (A.wounds.takeLost() + this.internal * dt) * (this.vamp ? 0.4 : 1);
    this.blood = Math.max(0, this.blood - lost);
    this.internal *= Math.exp(-dt / 90);
    // holed lungs slowly fill up
    if (S.lung) this.blood -= dt * 0.0006 * S.lung;
    if (S.dieT >= 0) { S.dieT -= dt; if (S.dieT <= 0) this.die(); }
    if (this.undead) { if (this.blood < 0.1) this.die(); }
    else if (this.blood < 0.3) this.die();
    else if (this.blood < 0.45 && !S.out) this.faint(1e9);
    if (S.out && this.wakeT !== undefined) {
      this.wakeT -= dt;
      if (this.wakeT <= 0 && (this.blood >= 0.45 || this.undead)) { S.out = false; this.wakeT = undefined; }
    }
    if (b.dead) return;
    this.neuro(dt);
    S.pain = this.undead ? 0 : Math.max(S.gut * 0.7, S.pain - dt * 0.01);

    // feeling sick (the body's owner decides; everyone sees it come up: A.onVomit, mp.js)
    this.vomitCD -= dt;
    if (!A.remote && !this.undead) {
      const sick = S.gut * 0.05 + (S.pain > 0.5 ? 0.02 : 0) + (this.blood < 0.8 ? 0.025 : 0) + (this.brainDmg > 0.2 ? 0.02 : 0) + ((A.gasIn || 0) > 1 ? 0.06 : 0);
      this.nausea = Math.max(0, this.nausea + sick * dt - (sick ? 0 : 0.02 * dt));
      if (this.nausea >= 1 && !S.out && !this.fit && this.vomitCD <= 0 && settings.blood) {
        const bloody = !!(S.gut || this.gutBlood || this.internal > 0.004);
        this.nausea = rnd(0.2, 0.45);
        this.vomitCD = rnd(7, 14);
        this.vomit(bloody);
        A.onVomit?.(bloody);
      }
    }
    // coughing blood with a holed lung
    if (S.lung && !S.out && !this.undead) {
      this.coughT -= dt;
      if (this.coughT <= 0) {
        this.coughT = rnd(2.5, 6) / S.lung;
        this.cough();
      }
    }
    // standing up while you can't: down you go
    if (A.mode === 'anim' && (S.out || S.dieT >= 0 || S.brokenLeg || S.limp.has('thighL') || this.blood < (this.undead ? 0.12 : 0.62))) A.goRagdoll('collapse');
    // a useless arm lets go of the gun
    if (A.gunHeld && S.armOut[1]) A.gunHeld.drop();
    this.apply();
  }

  /** Seizures and posturing, from the brain damage (see neuro.js for what they look like). */
  neuro(dt) {
    const S = this.state, N = this.actor.brain.neuro, d = this.brainDmg;
    if (this.undead) return;
    // a fit coming on (right after a bad knock), or out of nowhere: the worse the damage, the likelier
    if (this.fitSoon !== undefined) { this.fitSoon -= dt; if (this.fitSoon <= 0) { this.fitSoon = undefined; this.seizure(); } }
    // a brain starved of oxygen (so much blood gone: drained by a vampire, bled out): fits, more
    // and harder the less is left
    const hyp = 0.64 - this.blood;
    if (hyp > 0 && !N.ep && !this.actor.remote) {
      this.hypT = (this.hypT ?? rnd(1.5, 4)) - dt * (0.4 + hyp * 12);
      if (this.hypT <= 0) { this.hypT = rnd(5, 12); this.seizure(clamp(0.35 + hyp * 2.5, 0.35, 1)); }
    }
    if (d > 0.18 && !N.ep) {
      this.fitT -= dt * (d - 0.1) * 2;
      if (this.fitT <= 0) { this.fitT = rnd(20, 70); this.seizure(); }
    }
    // knocked out with a badly hurt brain: posturing, a little while after going under
    if (S.out && d > 0.3) {
      if (!this.postureKind) {
        this.postureKind = d > 0.62 ? (Math.random() < 0.7 ? 'decerebrate' : 'mixed') : d > 0.45 ? (Math.random() < 0.5 ? 'mixed' : 'decorticate') : 'decorticate';
        this.postDelay = rnd(0.5, 3);
      }
      this.postDelay -= dt;
      if (this.postDelay <= 0 && !N.ep) N.posture(this.postureKind);
    } else if (this.postureKind) {
      this.postureKind = null;
      N.clearPosture();
    }
  }

  /**
   * Pallor: the skin fades as blood is lost - paler, greyer, a touch blue; ashen by the end, and
   * greyer still after death. (Special bodies whose skin isn't skin keep theirs.)
   */
  pallor(dt) {
    const h = this.actor.hero, L = h.look, M = h.mat?.skin;
    if (!M || L.gold || L.silver || L.toon || this.undead || this.actor.infected || NO_PALLOR.has(L.costume)) return;
    if (this.actor.brain.dead) this.pallorDead = Math.min(0.35, (this.pallorDead || 0) + dt / 60);
    const p = clamp((1 - this.blood) / 0.6, 0, 1) ** 0.9 + (this.pallorDead || 0);
    if (Math.abs(p - (this.pallorP ?? 0)) < 0.004 && L.skin === this.pallorBase) return;
    this.pallorP = p;
    this.pallorBase = L.skin;
    const base = _col.setHex(L.skin ?? 0xd49a78);
    base.getHSL(_hsl);
    // colour drains out, it lightens a little (then goes grey), and a cold blue-grey creeps in
    const k = Math.min(1, p);
    _hsl.s *= 1 - 0.75 * k;
    _hsl.l = clamp(_hsl.l + 0.07 * k - 0.1 * Math.max(0, p - 0.7), 0, 1);
    M.color.setHSL(_hsl.h, _hsl.s, _hsl.l).lerp(_ash, 0.35 * k * k);
  }

  cough() {
    const A = this.actor, h = A.hero;
    if (!settings.coughBlood) return;
    h.head.updateWorldMatrix(true, false);
    const mouth = h.head.localToWorld(V(0, 0.03, 0.1));
    const fwd = h.head.localToWorld(V(0, 0.0, 1)).sub(h.head.getWorldPosition(V())).normalize();
    this.sys.inked(A).spray(mouth, fwd.addScaledVector(V(0, -1, 0), 0.3).normalize(), rnd(1.2, 2.4), Math.round(rnd(8, 16)), 0.45, 0.8);
    // it runs down the chin
    A.wounds.stamp('head', mouth, fwd, V(0, -1, 0), 'splash', 0.03, 0.025, 0.8);
    // the whole chest heaves
    if (A.mode === 'ragdoll') A.pending ||= { imp: V(0, 6, 0).addScaledVector(fwd, -4), part: 'chest', point: A.rd.point('chest', V(0, 0.1, 0.08)) };
  }

  /**
   * Throwing up (on every copy of the body: the owner's decision goes out as an event): a bout
   * of a second or two, a few heaving gushes out of the mouth - a muddled green, with orange,
   * yellow and brown in it, and blood if the stomach's been holed - landing on the floor, down
   * the front and on whoever's in the way. Doubled over on foot, the chest heaving lying down.
   */
  vomit(bloody = false) {
    const A = this.actor;
    if (this.fit || !settings.vomit) return;
    const dur = rnd(1.5, 2.3);
    this.fit = { t: 0, dur, next: rnd(0.25, 0.4), bloody };
    if (!A.remote && A.mode === 'anim') A.gest?.play('vomit', dur + 0.4);
    ORGAN_FX.sound?.('vomit', A.hero.head.getWorldPosition(V()), 0.9, 1 / (A.hero.S || 1));
  }
  retch(dt) {
    const F = this.fit, A = this.actor, h = A.hero;
    F.t += dt;
    if (F.t >= F.dur) { this.fit = null; return; }
    if (F.t < F.next) return;
    F.next = F.t + rnd(0.07, 0.12);
    // (in heaves: a gush, a pause, a gush)
    const heave = Math.sin((F.t / F.dur) * Math.PI * 3);
    if (heave < -0.2) return;
    h.head.updateWorldMatrix(true, false);
    const mouth = h.head.localToWorld(V(0, -0.015, 0.1 * (h.S || 1)));
    const fwd = h.head.localToWorld(V(0, 0, 1)).sub(h.head.getWorldPosition(V())).normalize();
    const dir = fwd.clone().addScaledVector(V(0, -1, 0), 0.55).normalize();
    const k = 0.5 + 0.5 * Math.max(0, heave);
    const pick = () => {
      const r = Math.random();
      if (F.bloody && r < 0.3) return A; // (their own blood)
      const q = Math.random();
      return q < 0.66 ? VOMIT.green : q < 0.78 ? VOMIT.brown : q < 0.9 ? VOMIT.orange : VOMIT.yellow;
    };
    for (let i = 0; i < 3; i++) this.sys.inked(pick()).spray(mouth, dir, rnd(1.6, 3) * k, Math.round(rnd(4, 7) * k), 0.22, rnd(1.6, 2.4));
    // dribbling down the chin, and down the front
    if (Math.random() < 0.5) {
      const ink = Math.random() < 0.3 && F.bloody ? inkOf(A) : VOMIT.green;
      A.wounds.splashForeign('head', mouth, fwd, V(0, -1, 0), ink, 0.028, 0.7);
      if (Math.random() < 0.4) A.wounds.splashForeign('chest', h.chest.localToWorld(V(0, 0.12, 0.14)), fwd, V(0, -1, 0), ink, 0.05, 0.6);
    }
    if (A.mode === 'ragdoll' && A.rd?.active && Math.random() < 0.3) A.pending ||= { imp: V(0, 5, 0).addScaledVector(fwd, -3), part: 'chest', point: A.rd.point('chest', V(0, 0.1, 0.08)) };
  }

  /** Good as new (respawn). */
  heal() {
    this.blood = 1;
    this.brainDmg = 0;
    this.brainDeath = false;
    this.postureKind = null;
    this.postDelay = 0;
    this.actor.brain.neuro.reset();
    this.pallorDead = 0;
    this.internal = 0;
    this.trauma = {};
    this.total = 0;
    this.nausea = 0; this.vomitCD = 0; this.fit = null; this.gutBlood = false;
    this.wakeT = undefined;
    this.state = {
      limp: new Set(), noRise: false, lung: 0, gut: 0, pain: 0,
      armOut: [false, false], dieT: -1, out: false,
    };
    const b = this.actor.brain;
    b.dead = false;
    b.clutch = null;
    b.shots = 0;
    b.deadT = 0;
    this.apply();
  }

  die() {
    const b = this.actor.brain;
    if (b.dead || this.actor.god) return;
    b.dead = true;
    this.state.dieT = -1;
    // a brain killed outright: a last fit, a last posture, as the body goes
    b.neuro.clearPosture();
    if (!this.undead && (this.brainDeath || this.brainDmg > 0.45) && Math.random() < 0.75) b.neuro.agonal(Math.max(this.brainDmg, 0.7));
    this.brainDeath = false;
    if (this.actor.mode !== 'ragdoll') this.actor.goRagdoll('collapse');
  }
}
