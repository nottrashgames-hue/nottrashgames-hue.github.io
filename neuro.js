import * as THREE from 'three';

/*
  What a hurt brain does to the body on the floor (organs.js decides when, this drives the
  ragdoll's muscles through the Brain's helpers). No two are alike: every episode rolls its own
  timing, rhythm, side, stiffness and the way it wanders, and runs on layered noise.

    seizure   - tonic-clonic: a stiff tonic phase (back arched, limbs locked, a fine fast tremor),
                then the clonic jerks - sharp flexion bursts that start quick (4-6 a second) and
                slow down as the fit wears out, beats skipped more and more near the end. Some
                are focal: one side of the body jerking, the other barely. The head is turned
                and nods with each jerk.
    decorticate - arms drawn in onto the chest, fists clenched, legs stiff and straight, toes pointed
    decerebrate - arms rigid down the sides, back and neck arched, legs locked out, toes pointed
    mixed     - one side of each (the worse side decerebrate)
    fencing   - the fencing response to a hard knock: one arm stuck out stiff towards where the
                face is turned, the other bent up by the head; a few seconds, then it lets go
    Posturing isn't a held pose: it comes and goes in waves, surges when the body is hurt again
    (a response to pain), trembles, and never sits quite the same way twice.
    twitch    - myoclonic jerks: one limb (or the whole body, a startle) kicks for a split second
    agonal    - after a fatal brain injury: a last seizure or posture, fading out as the body dies
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const SIDES = [['L', 1], ['R', -1]];
const LIMBS = ['armL', 'armR', 'legL', 'legR'];
const _p = V(), _u = V(), _pole = V();

/** Smooth noise in [-1, 1] (three detuned sines, seeded). */
function noise(t, seed) {
  return (Math.sin(t + seed) + 0.6 * Math.sin(t * 1.73 + seed * 2.1) + 0.4 * Math.sin(t * 0.61 + seed * 0.7)) / 2;
}

export class Neuro {
  constructor(brain) {
    this.b = brain;
    this.reset();
  }
  reset() {
    this.ep = null;       // a seizure / fencing / agonal episode (runs to its end)
    this.pose = null;     // sustained posturing while out cold (organs.js keeps it or clears it)
    this.tw = null;       // a twitch in progress
    this.twCool = rnd(1, 4);
  }
  get seizing() { return this.ep?.kind === 'seizure'; }
  get busy() { return !!(this.ep || this.pose); }

  // ---------------------------------------------------------------- starting things
  /** A tonic-clonic seizure, harder and longer the worse the damage (0..1). Returns its length. */
  seize(dmg = 0.5, { fade = false, scale = 1 } = {}) {
    const tonic = rnd(0.8, 2.2) + dmg * rnd(0, 2) * scale;
    const clonic = (rnd(5, 10) + dmg * rnd(4, 12)) * scale;
    const focal = Math.random() < 0.28 ? pick([1, -1]) : 0;
    const side = (s) => (focal ? (s === focal ? rnd(0.9, 1.1) : rnd(0.12, 0.4)) : rnd(0.8, 1.05));
    this.ep = {
      kind: 'seizure', t: 0, dur: tonic + clonic, tonic, clonic, fade, seed: rnd(0, 100),
      // tonic: arms either locked out or drawn in; how arched; the tremor's speed
      tonicArms: Math.random() < 0.55 ? 'flex' : 'ext', arch: rnd(0.5, 1.1), trem: rnd(8, 12),
      // clonic rhythm: fast at first, slowing - and how sharp each jerk is
      f0: rnd(3.6, 6.2), f1: rnd(0.8, 1.7), sharp: rnd(2.5, 7), phase: 0,
      head: rnd(-0.9, 0.9), headRoll: rnd(-0.35, 0.35),
      limbs: Object.fromEntries(LIMBS.map((k) => [k, {
        w: side(k.endsWith('L') ? 1 : -1), off: rnd(-0.45, 0.45), amp: 1, cyc: -1,
        bend: rnd(0.8, 1.25), // (how far this one's base pose is drawn in)
      }])),
      trunk: { amp: 1, cyc: -1, off: rnd(-0.2, 0.2), w: rnd(0.6, 1.1) },
      grip: rnd(0.75, 1),
    };
    this.pose = null;
    return this.ep.dur;
  }

  /** The fencing response: a few stiff seconds after a knockout blow. */
  fence(dur = rnd(2, 7)) {
    const side = pick([1, -1]);
    this.ep = {
      kind: 'fencing', t: 0, dur, fade: false, seed: rnd(0, 100), side,
      reach: V(side * rnd(0.25, 0.55), rnd(-0.1, 0.4), rnd(0.75, 1)), headYaw: side * rnd(0.6, 1.1),
      bentHand: V(-side * rnd(0.04, 0.1), rnd(0.25, 0.38), rnd(0.08, 0.16)), stiff: rnd(0.7, 1),
    };
  }

  /** Posturing held while out cold (kind: 'decorticate' | 'decerebrate' | 'mixed'). */
  posture(kind) {
    if (this.pose?.kind === kind) return;
    const worse = pick([1, -1]);
    this.pose = {
      kind, t: 0, seed: rnd(0, 100), I: 0,
      onset: rnd(0.4, 1.4), surge: 0, surgeCool: rnd(2, 7), dip: 0, dipCool: rnd(4, 12),
      wave: rnd(0.25, 0.7), trem: rnd(4.5, 8), tremA: rnd(0.015, 0.05),
      // per side: which posture that side does, and its own little differences
      sides: Object.fromEntries(SIDES.map(([n, s]) => [n, {
        kind: kind === 'mixed' ? (s === worse ? 'decerebrate' : 'decorticate') : kind,
        armJit: V(rnd(-0.08, 0.08), rnd(-0.06, 0.06), rnd(-0.06, 0.06)), flex: rnd(0.9, 1.2),
        hip: rnd(-0.08, 0.14), foot: rnd(0.45, 0.9), add: rnd(0, 0.1), rot: rnd(0.05, 0.3),
      }])),
      arch: kind === 'decorticate' ? rnd(0.1, 0.3) : rnd(0.6, 1.1), headYaw: rnd(-0.5, 0.5),
    };
  }
  clearPosture() { this.pose = null; }
  /** Came round: whatever was running is over. */
  awake() { if (this.ep || this.pose) this.ep = this.pose = null; }

  /** After a fatal brain injury: a last seizure or posture, fading as the body dies. */
  agonal(dmg = 1) {
    const r = Math.random();
    if (r < 0.45) {
      this.seize(dmg, { fade: true, scale: rnd(0.25, 0.5) });
    } else if (r < 0.8) {
      const kind = pick(['decerebrate', 'decerebrate', 'decorticate', 'mixed']);
      this.posture(kind);
      this.ep = { kind: 'agonal', t: 0, dur: rnd(2.5, 7), fade: true, pose: this.pose };
      this.pose = null;
    } else this.fence(rnd(1.5, 4));
    if (this.ep) this.ep.fade = true;
  }

  // ---------------------------------------------------------------- per frame
  /**
   * Drive the body for this frame (it's down, out cold or dead). True if an episode or a posture
   * set the muscles; false leaves it to the Brain (limp, or its own ground behaviour).
   */
  drive(dt, weak = 0) {
    const E = this.ep, b = this.b;
    // a new blow while posturing is pain: it surges
    if (this.pose && b.jolt > 1.4) this.pose.surge = Math.max(this.pose.surge, rnd(0.8, 2));
    if (E) {
      E.t += dt;
      if (E.t >= E.dur) {
        this.ep = null;
        if (E.fade) b.deadT = Math.max(b.deadT || 0, 0.2); // (faded out already: no death stiffening after)
        return !!this.pose && this.runPosture(this.pose, dt, 1, weak);
      }
      const fade = E.fade ? 1 - smooth(clamp((E.t - E.dur * 0.35) / (E.dur * 0.65), 0, 1)) : 1;
      if (E.kind === 'seizure') this.runSeizure(E, dt, fade, weak);
      else if (E.kind === 'fencing') this.runFencing(E, dt, fade, weak);
      else if (E.kind === 'agonal') this.runPosture(E.pose, dt, fade, weak);
      this.limp();
      return true;
    }
    if (this.pose) { this.runPosture(this.pose, dt, 1, weak); this.limp(); return true; }
    return false;
  }

  /**
   * Myoclonic twitches over whatever the body is doing (lying there, or out cold): rate goes
   * with the damage. A single limb mostly; now and then the whole body startles.
   */
  twitch(dt, dmg) {
    const b = this.b;
    if (!this.tw) {
      if (dmg < 0.08 || this.busy) return;
      this.twCool -= dt * (0.3 + dmg * 2.2);
      if (this.twCool > 0) return;
      this.twCool = rnd(0.6, 5);
      const whole = Math.random() < 0.18;
      this.tw = {
        t: 0, dur: rnd(0.1, 0.28) * (whole ? 1.5 : 1), whole,
        limb: pick(['armL', 'armR', 'legL', 'legR', 'legL', 'armL', 'head']),
        amp: rnd(0.5, 1.2) * (0.6 + dmg * 0.6), dir: V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)),
        again: Math.random() < 0.35 ? (Math.random() * 3 | 0) + 1 : 0, // (a little run of them)
      };
    }
    const T = this.tw;
    T.t += dt;
    const u = T.t / T.dur;
    if (u >= 1) {
      if (T.again > 0) { T.again--; T.t = -rnd(0.05, 0.25); T.amp *= rnd(0.6, 1); }
      else this.tw = null;
      return;
    }
    if (u < 0) return;
    const p = Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 2 * T.amp; // sharp in, slower out
    const s = 0.55 + 0.4 * T.amp;
    const arm = (n, sd, k) => {
      b.rel('upper' + n, -0.6 * p * k + T.dir.x * 0.3 * p, sd * (0.2 + T.dir.y * 0.3) * p, 0, s, 0.6);
      b.rel('fore' + n, -1.1 * p * k, 0, 0, s, 0.6);
    };
    const leg = (n, sd, k) => {
      b.rel('thigh' + n, -0.7 * p * k, sd * T.dir.z * 0.2 * p, 0, s, 0.6);
      b.rel('shin' + n, 1.0 * p * k, 0, 0, s, 0.6);
      b.rel('foot' + n, -0.4 * p * k, 0, 0, s * 0.6, 0.6);
    };
    if (T.whole) {
      // a startle: everything flexes at once, head and shoulders jerk up
      for (const [n, sd] of SIDES) { arm(n, sd, 1); leg(n, sd, 0.7); }
      b.rel('spine', 0.35 * p, 0, 0, s, 0.6);
      b.rel('chest', 0.25 * p, 0, 0, s, 0.6);
      b.rel('head', 0.5 * p, 0, 0, s, 0.6);
      b.grip = [lerp(b.grip[0], 1, p), lerp(b.grip[1], 1, p)];
    } else if (T.limb === 'head') {
      b.rel('head', 0.4 * p * T.dir.x, 0.4 * p * T.dir.y, 0.7 * p * T.dir.z, s, 0.6);
    } else {
      const n = T.limb.slice(-1), sd = n === 'L' ? 1 : -1;
      (T.limb.startsWith('arm') ? arm : leg)(n, sd, 1);
      if (T.limb.startsWith('arm')) b.grip[n === 'L' ? 0 : 1] = lerp(b.grip[n === 'L' ? 0 : 1], 1, p);
    }
    this.limp();
  }

  // ---------------------------------------------------------------- the episodes
  runSeizure(E, dt, fade, weak) {
    const b = this.b, rd = b.rd, t = E.t, sd0 = E.seed;
    const strong = (1 - weak * 0.5) * fade;
    if (t < E.tonic) {
      // tonic: everything locks - the back arches, the jaw and fists clench, legs go straight -
      // and a fine, fast tremor runs through it that builds towards the jerking
      const on = smooth(clamp(t / 0.35, 0, 1)), k = t / E.tonic;
      const tr = (i) => noise(t * E.trem * 6.283, sd0 + i * 3.1) * (0.02 + 0.06 * k);
      const s = (0.55 + 0.4 * on) * strong;
      b.rel('spine', -0.25 * E.arch * on + tr(1), tr(2), 0, s, 0.9);
      b.rel('chest', -0.2 * E.arch * on + tr(3), tr(4), 0, s, 0.9);
      b.rel('head', -0.55 * E.arch * on + tr(5), E.headRoll * on, E.head * on, s, 0.9);
      for (const [n, sd] of SIDES) {
        const L = E.limbs['arm' + n], G = E.limbs['leg' + n];
        if (E.tonicArms === 'flex') {
          b.armIK(n, rd.point('chest', _p.set(sd * 0.07, 0.18 + tr(6 + sd), 0.14), V()), _pole.set(sd * 0.9, -0.35, -0.1).normalize(), s * L.w);
        } else {
          b.armDir(n, _u.set(sd * 0.3, -0.85, 0.35 + tr(7 + sd)), 0.1, s * L.w);
        }
        b.rel('thigh' + n, 0.05 + tr(8 + sd), -sd * 0.05, 0, s * G.w, 0.9);
        b.rel('shin' + n, 0.04 + Math.abs(tr(9 + sd)), 0, 0, s * G.w, 0.9);
        b.rel('foot' + n, 0.7 + tr(10 + sd), 0, 0, s * G.w * 0.7, 0.9);
      }
      b.grip = [E.grip, E.grip];
      return;
    }
    // clonic: rhythmic jerks, slowing as it goes, the beats getting patchier towards the end
    const c = t - E.tonic, u = c / E.clonic;
    const f = lerp(E.f0, E.f1, Math.pow(u, 0.7)) * (1 + 0.2 * noise(t * 0.9, sd0 + 11));
    E.phase += f * 6.283 * dt;
    const ramp = smooth(clamp(c / 0.8, 0, 1)) * (1 - smooth(clamp((u - 0.85) / 0.15, 0, 1)) * 0.6);
    const skip = 0.05 + 0.5 * u * u; // (chance a beat's missed)
    const beat = (L) => {
      const ph = E.phase + L.off;
      const cyc = Math.floor(ph / 6.283);
      if (cyc !== L.cyc) { L.cyc = cyc; L.amp = Math.random() < skip ? rnd(0, 0.25) : rnd(0.55, 1.2); }
      return Math.pow(Math.max(0, Math.sin(ph)), E.sharp) * L.amp * ramp;
    };
    const s0 = (0.5 + 0.3 * ramp) * strong;
    const T = E.trunk, pt = beat(T) * T.w;
    // the trunk: arched between the jerks, pulled in with each one
    b.rel('spine', -0.15 * E.arch + 0.45 * pt + 0.05 * noise(t * 2, sd0 + 20), 0.1 * noise(t * 1.3, sd0 + 21), 0, s0, 0.6);
    b.rel('chest', -0.1 * E.arch + 0.35 * pt, 0.08 * noise(t * 1.1, sd0 + 22), 0, s0, 0.6);
    b.rel('head', -0.3 * E.arch + 0.7 * pt, E.headRoll + 0.1 * noise(t * 1.7, sd0 + 23), E.head + 0.15 * noise(t * 0.8, sd0 + 24), s0 + 0.1, 0.6);
    for (const [n, sd] of SIDES) {
      const A = E.limbs['arm' + n], G = E.limbs['leg' + n];
      const pa = beat(A) * A.w, pl = beat(G) * G.w;
      const sa = s0 * (0.4 + 0.6 * A.w), sl = s0 * (0.4 + 0.6 * G.w);
      // arms: half bent, elbows out; each jerk snaps them in and up
      _u.set(sd * (0.45 - 0.25 * pa), -0.7 + 0.55 * pa, 0.35 + 0.3 * pa).add(_p.set(0.05 * noise(t * 2.3, sd0 + 30 + sd), 0.05 * noise(t * 1.9, sd0 + 32 + sd), 0));
      b.armDir(n, _u, (0.9 * A.bend + 1.1 * pa) * A.w + 0.2, sa, undefined, 0.6);
      // legs: slightly bent; each jerk kicks the hip and knee up
      b.rel('thigh' + n, -0.25 * G.bend - 0.75 * pl, sd * (0.08 + 0.08 * noise(t * 1.2, sd0 + 34 + sd)), 0, sl, 0.6);
      b.rel('shin' + n, 0.4 * G.bend + 1.0 * pl, 0, 0, sl, 0.6);
      b.rel('foot' + n, 0.3 - 0.5 * pl, 0, 0, sl * 0.6, 0.6);
    }
    b.grip = [lerp(0.5, E.grip, ramp), lerp(0.5, E.grip, ramp)];
  }

  runFencing(E, dt, fade, weak) {
    const b = this.b, rd = b.rd, t = E.t;
    const on = smooth(clamp(t / 0.25, 0, 1)) * (1 - smooth(clamp((t - E.dur + 1.2) / 1.2, 0, 1))) * fade;
    const s = (0.35 + 0.5 * E.stiff) * on * (1 - weak * 0.5) + 0.02;
    const tr = (i) => noise(t * 7, E.seed + i) * 0.03;
    const nx = E.side > 0 ? 'L' : 'R';
    const [nb, sb] = E.side > 0 ? ['R', -1] : ['L', 1];
    // the reaching arm: stuck out straight towards where the face is turned
    b.armDir(nx, _u.copy(E.reach).add(_p.set(tr(1), tr(2), 0)), 0.08, s);
    // the other: bent up, the hand up by the head
    b.armIK(nb, rd.point('chest', _p.copy(E.bentHand), V()), _pole.set(sb * 0.8, 0.1, -0.5).normalize(), s);
    b.rel('head', -0.1, 0, E.headYaw * on, s + 0.05);
    b.rel('spine', 0, 0, 0, s * 0.5);
    b.rel('chest', 0, 0, 0, s * 0.5);
    for (const [n] of SIDES) {
      b.rel('thigh' + n, -0.1 + tr(3), 0, 0, s * 0.4);
      b.rel('shin' + n, 0.15, 0, 0, s * 0.4);
      b.rel('foot' + n, 0.4, 0, 0, s * 0.3);
    }
    b.grip = [0.6 * on, 0.6 * on];
  }

  runPosture(P, dt, fade, weak) {
    const b = this.b, rd = b.rd;
    P.t += dt;
    const t = P.t, sd0 = P.seed;
    // intensity: comes on over a second, rolls in slow waves, surges at pain, sometimes eases off
    P.surgeCool -= dt;
    if (P.surgeCool <= 0) { P.surgeCool = rnd(3, 11); P.surge = Math.max(P.surge, rnd(0.6, 1.8)); }
    P.dipCool -= dt;
    if (P.dipCool <= 0) { P.dipCool = rnd(6, 16); P.dip = rnd(1, 3); }
    P.surge = Math.max(0, P.surge - dt);
    P.dip = Math.max(0, P.dip - dt);
    const target = (0.72 + 0.2 * noise(t * P.wave, sd0) + (P.surge > 0 ? 0.35 : 0) - (P.dip > 0 ? 0.45 : 0));
    P.I += (clamp(target, 0.15, 1.2) - P.I) * Math.min(1, dt * (P.surge > 0 ? 6 : 1.6));
    const I = P.I * smooth(clamp(t / P.onset, 0, 1)) * fade;
    const tr = (i, k = 1) => noise(t * P.trem * 6.283, sd0 + i * 2.7) * P.tremA * k * (0.5 + I);
    const s = (0.25 + 0.6 * I) * (1 - weak * 0.5) + 0.02;
    // the trunk and neck: arched hard in decerebrate, only a little in decorticate
    const arch = P.arch * I;
    b.rel('spine', -0.28 * arch + tr(1), 0.04 * noise(t * 0.4, sd0 + 2), 0, s, 0.9);
    b.rel('chest', -0.22 * arch + tr(3), 0, 0, s, 0.9);
    b.rel('head', -0.65 * arch + tr(4), 0.05 * noise(t * 0.3, sd0 + 5), P.headYaw * I + 0.08 * noise(t * 0.5, sd0 + 6), s, 0.9);
    for (const [n, sd] of SIDES) {
      const S = P.sides[n];
      if (S.kind === 'decorticate') {
        // arms drawn in onto the chest, elbows bent tight, fists clenched
        _p.set(sd * (0.05 + S.armJit.x * 0.5), lerp(-0.05, 0.16, I) + S.armJit.y + tr(7 + sd), lerp(0.2, 0.15, I) + S.armJit.z);
        b.armIK(n, rd.point('chest', _p, V()), _pole.set(sd * 0.9, -0.45, -0.15).normalize(), s * S.flex);
        b.grip[n === 'L' ? 0 : 1] = lerp(0.4, 1, I);
      } else {
        // arms rigid, straight down the sides and turned in, wrists bent: pulled back a touch
        _u.set(sd * (0.18 + S.armJit.x) + tr(8 + sd), -1, lerp(0.1, -0.12, I) + S.armJit.z);
        b.armDir(n, _u, 0.05 + 0.1 * (1 - I), s * S.flex, _pole.set(1, 0, lerp(0, sd * S.rot * 3, I)).normalize(), 0.9);
        b.grip[n === 'L' ? 0 : 1] = lerp(0.35, 0.8, I);
      }
      // the legs: straight, pressed together, turned in, toes pointed
      b.rel('thigh' + n, lerp(-0.25, S.hip, I) + tr(9 + sd), -sd * S.add * I, -sd * S.rot * I, s, 0.9);
      b.rel('shin' + n, lerp(0.5, 0.03, I) + Math.abs(tr(10 + sd)), 0, 0, s, 0.9);
      b.rel('foot' + n, lerp(0.2, S.foot, I) + tr(11 + sd, 2), 0, 0, s * 0.8, 0.9);
    }
    return true;
  }

  /** Whatever's paralysed (a broken neck or back) doesn't take part. */
  limp() {
    const L = this.b.inj?.limp;
    if (!L?.size) return;
    for (const p of this.b.rd.list) if (p.parent && L.has(p.name)) p.strength = Math.min(p.strength, 0.012);
  }
}
