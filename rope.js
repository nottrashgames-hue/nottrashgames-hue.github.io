import * as THREE from 'three';
import { capsuleOf } from './strike.js';
import { pullPart } from './grabbing.js';

/*
  Rope: tie someone up hand and foot, then lead them - or drag them - about on the end of it.
    hold K on someone in reach    - tie them up (it takes a moment; they have to stay put)
    tap K                          - take up the loose end of a tied person's rope / let it go
    hold K on someone tied         - untie them (the rope's yours again)
    tied yourself: mash Space      - work your way out of it
  Tied people go down and stay down: wrists and ankles are held together, and with the rope
  in someone's hand, its length pulls them along behind (their wrists first). The body's owner
  does the physics (the leash holder's hand is just another body it can see); 'tie' messages
  tell everyone who's tied and who's holding them.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const ROPE_START = 2;
const LEN = 2.2;       // m of rope between hand and wrists
const REACH = 1.6;     // m to tie / take hold of someone
const TIE_T = 1.8, UNTIE_T = 1.3, TAP = 0.3;
const WRIST = 0.84, ANKLE = 0.88;
const FREE_N = 22;     // Space presses to struggle out of it

const MAT = new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 0.95 });
const _a = V(), _b = V(), _q = Q(), _h = V(), _w = V();

/** The point near the far end of a limb part (wrist / ankle), local to its body. */
function endLocal(A, name, k) {
  const cap = capsuleOf(A, name);
  if (!cap) return V();
  const [near, far] = cap.a.y > cap.b.y ? [cap.a, cap.b] : [cap.b, cap.a];
  return near.clone().lerp(far, k);
}
function partWorld(A, name, local, out) {
  if (A.mode === 'ragdoll' && !A.remote && A.rd.parts[name]) return A.rd.point(name, local, out);
  const g = A.groups[name];
  g.updateWorldMatrix(true, false);
  return out.copy(local).applyMatrix4(g.matrixWorld);
}

export class Ropes {
  /** ctx: { hero, actors(), sfx, scene, send(A, on, by), onHud() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.pocket = ROPE_START;
    this.job = null;     // { kind: 'tie' | 'untie', A, t, at }
    this.down = 0;       // K held since
    this.struggle = 0;
    this.shown = new Map(); // A -> { loops, line }
  }
  get progress() { return this.job ? clamp(this.job.t / (this.job.kind === 'tie' ? TIE_T : UNTIE_T), 0, 1) : 0; }
  get label() { return this.job ? (this.job.kind === 'tie' ? 'Tying them up' : 'Untying them') : ''; }
  refill() { this.pocket = Math.max(this.pocket, ROPE_START); this.ctx.onHud?.(); }
  give(n) { this.pocket += n; this.ctx.onHud?.(); }

  /** Who's in reach: the crosshair's person if close, else the nearest. */
  target(pk) {
    const me = this.ctx.hero, p = me.hero.pos;
    const near = (A) => A && A !== me && A.hero.root.parent && !A.seat && A.focus().distanceTo(p) < REACH + 0.4;
    if (near(pk?.actor)) return pk.actor;
    let best = null, bd = REACH;
    for (const A of this.ctx.actors()) {
      if (!near(A)) continue;
      const d = A.focus().distanceTo(p);
      if (d < bd) { bd = d; best = A; }
    }
    return best;
  }
  leading() { const me = this.ctx.hero; return this.ctx.actors().filter((A) => A.tied?.by === me); }

  press(pk) {
    const me = this.ctx.hero;
    if (me.brain.dead || me.seat) return;
    if (me.tied) { this.wriggle(); return; }
    this.down = performance.now();
    this.pk = pk;
  }
  release() {
    if (!this.down) return;
    const held = (performance.now() - this.down) / 1000;
    this.down = 0;
    if (this.job) { this.job = null; this.ctx.onHud?.(); return; }
    if (held > TAP) return;
    const me = this.ctx.hero;
    // a tap: let go of whoever we're leading, else pick up a tied one's rope
    const lead = this.leading();
    if (lead.length) { for (const A of lead) this.set(A, true, null); this.ctx.sfx?.('pickup', 0.3); return; }
    const A = this.target(this.pk);
    if (A?.tied && !A.tied.by) { this.set(A, true, me); this.ctx.sfx?.('pickup', 0.4); }
    else if (A && !A.tied) this.ctx.say?.('Hold K to tie them up');
  }
  /** Tied up ourselves: each Space works it looser. */
  wriggle() {
    const me = this.ctx.hero;
    if (!me.tied || me.brain.dead) return;
    this.struggle++;
    if (me.mode === 'ragdoll') me.pending ||= { imp: V((Math.random() - 0.5) * 8, 4, (Math.random() - 0.5) * 8), part: 'chest', point: me.rd.point('chest', V()) };
    if (this.struggle >= FREE_N) { this.struggle = 0; this.set(me, false, null); this.ctx.sfx?.('pickup', 0.5); }
  }

  /** Tied (on), and who's holding the rope (by) - here and for everyone. */
  set(A, on, by, remote = false) {
    const was = !!A.tied;
    A.tied = on ? { by: by || null } : null;
    if (on && !was && !A.remote) {
      if (A.mode === 'anim') A.goRagdoll('collapse');
      A.meleeHeld?.drop?.(); A.meleeHeldL?.drop?.();
    }
    if (A === this.ctx.hero) this.struggle = 0;
    if (!remote) this.ctx.send?.(A, on, by);
    this.ctx.onHud?.();
  }

  update(dt) {
    const me = this.ctx.hero;
    // K held: tying / untying whoever's in reach
    if (this.down && !this.job && (performance.now() - this.down) / 1000 > TAP) {
      const A = this.target(this.pk);
      if (A && A.tied) this.job = { kind: 'untie', A, t: 0, at: me.hero.pos.clone() };
      else if (A && this.pocket > 0) this.job = { kind: 'tie', A, t: 0, at: me.hero.pos.clone() };
      else { this.down = 0; this.ctx.say?.(A ? 'No rope' : 'Nobody in reach'); }
    }
    const J = this.job;
    if (J) {
      if (me.brain.dead || me.mode !== 'anim' || me.seat || me.hero.pos.distanceTo(J.at) > 0.6 || J.A.focus().distanceTo(me.hero.pos) > REACH + 0.6 || !J.A.hero.root.parent) this.job = null;
      else if ((J.t += dt) >= (J.kind === 'tie' ? TIE_T : UNTIE_T)) {
        this.job = null;
        this.down = 0;
        if (J.kind === 'tie') { this.pocket--; this.set(J.A, true, me); }
        else { this.pocket++; this.set(J.A, false, null); }
        this.ctx.sfx?.('clap', 0.3);
      }
      this.ctx.onHud?.();
    }
    // leading someone and they're gone / we're down: the rope drops
    for (const A of this.ctx.actors()) {
      const T = A.tied;
      if (T?.by && (T.by.brain.dead || !T.by.hero.root.parent || T.by.seat || !this.ctx.actors().includes(T.by))) {
        if (T.by === me || !A.remote) this.set(A, true, null); else T.by = null;
      }
    }
    this.draw();
  }

  /** Physics, for the tied bodies we simulate: bound wrists and ankles, and the pull of the rope. */
  preStep(H) {
    for (const A of this.ctx.actors()) {
      const T = A.tied;
      if (!T || A.remote || A.mode !== 'ragdoll' || !A.rd) continue;
      const L = (A._ropeL ||= { wl: endLocal(A, 'foreL', WRIST), wr: endLocal(A, 'foreR', WRIST), al: endLocal(A, 'shinL', ANKLE), ar: endLocal(A, 'shinR', ANKLE) });
      // the pairs held together (each pulled toward the middle of the two)
      for (const [n1, l1, n2, l2] of [['foreL', L.wl, 'foreR', L.wr], ['shinL', L.al, 'shinR', L.ar]]) {
        if (A.rd.parts[n1]?.gone || A.rd.parts[n2]?.gone) continue;
        const p1 = A.rd.point(n1, l1, _a), p2 = A.rd.point(n2, l2, _b);
        const mid = _w.addVectors(p1, p2).multiplyScalar(0.5);
        if (p1.distanceTo(p2) < 0.08) continue;
        pullPart({ A, name: n1, local: l1, T: mid.clone(), vT: V() }, H, 6);
        pullPart({ A, name: n2, local: l2, T: mid.clone(), vT: V() }, H, 6);
      }
      // on the end of someone's rope: taut past its length, it hauls the wrists after the hand
      if (!T.by) continue;
      const hand = this.handOf(T.by, _h);
      const wr = A.rd.point('foreL', L.wl, _a).add(A.rd.point('foreR', L.wr, _b)).multiplyScalar(0.5);
      const d = wr.distanceTo(hand);
      if (d <= LEN) continue;
      const goal = hand.clone().addScaledVector(_w.subVectors(wr, hand).normalize(), LEN * 0.92);
      const vT = T.by.hero.vel?.clone() || V();
      pullPart({ A, name: 'foreL', local: L.wl, T: goal.clone(), vT }, H, 1.2);
      pullPart({ A, name: 'foreR', local: L.wr, T: goal, vT }, H, 1.2);
    }
  }

  handOf(A, out) {
    const hand = A.hero.arms?.[0]?.hand;
    if (!hand) return out.copy(A.hero.pos).setY(A.hero.pos.y + 1);
    hand.updateWorldMatrix(true, false);
    return hand.getWorldPosition(out);
  }

  /** The rope, on everyone's screen: loops round wrists and ankles, and the line to the hand. */
  draw() {
    for (const [A, S] of this.shown) {
      if (A.tied && A.hero.root.parent) continue;
      for (const m of S.loops) m.removeFromParent();
      S.line.removeFromParent(); S.line.geometry.dispose();
      this.shown.delete(A);
    }
    for (const A of this.ctx.actors()) {
      if (!A.tied || !A.hero.root.parent) continue;
      let S = this.shown.get(A);
      if (!S) {
        S = { loops: [], line: new THREE.Mesh(new THREE.BufferGeometry(), MAT) };
        const L = { foreL: WRIST, foreR: WRIST, shinL: ANKLE, shinR: ANKLE };
        for (const [n, k] of Object.entries(L)) {
          const g = A.groups[n], cap = capsuleOf(A, n);
          if (!g || !cap) continue;
          const loop = new THREE.Mesh(new THREE.TorusGeometry(cap.r * 1.05, 0.007, 5, 14), MAT);
          loop.position.copy(endLocal(A, n, k));
          loop.rotation.x = Math.PI / 2;
          loop.userData.decal = true;
          g.add(loop);
          S.loops.push(loop);
        }
        this.ctx.scene.add(S.line);
        S.line.frustumCulled = false;
        this.shown.set(A, S);
      }
      const by = A.tied.by;
      S.line.visible = !!by;
      if (!by) continue;
      const a = this.handOf(by, _h).clone();
      const L = A._ropeL || { wl: endLocal(A, 'foreL', WRIST), wr: endLocal(A, 'foreR', WRIST) };
      const b = partWorld(A, 'foreL', L.wl, _a).clone().add(partWorld(A, 'foreR', L.wr, _b)).multiplyScalar(0.5);
      // slack hangs: the less of it is taken up, the lower the middle sags
      const d = a.distanceTo(b), sag = Math.sqrt(Math.max(0, LEN * LEN - d * d)) * 0.5;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)));
      }
      S.line.geometry.dispose();
      S.line.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.009, 4, false);
    }
  }
}
