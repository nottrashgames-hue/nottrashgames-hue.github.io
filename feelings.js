import * as THREE from 'three';
import { line, lineFor, painLine, colorLine, colorName } from './lines.js';

/*
  What people feel, and what it makes them do. One per street person (street.feel).

  - fear / anger / sadness, 0..1: raised by what happens to them and what they see, fading
    slowly (fear quickest, sadness slowest). They colour everything else: a scared person
    runs at the sight of the one who did it, an angry one goes for them, a sad one mopes.
  - Seeing someone die (or finding a body): horror, then - by temperament, and by whether
    they knew them (people who've talked together are friends) - running, calling the killer
    out, going for the killer, or going over to the body to kneel and cry. The same over a
    cut-off arm or leg lying in the street.
  - Pain: a cry naming where it hurt (my left arm, my leg, my head), shot or struck or broken
    or cut clean off.
  - Clothes: they remember what you had on when they last saw you; a change is noticed ("new
    shirt? hiding something?"), and so is a shirt soaked in blood - a white one especially -
    plus the odd remark on the colour itself.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const female = (A) => A?.hero?.look?.sex === 'f';

// how long (s) someone is remembered as the one who hurt somebody (a killing is theirs)
const BLAME_T = 15;
const SEE_R = 22, NOTICE_R = 9;

export class Feelings {
  constructor(street) {
    this.st = street;
    this.npc = street.npc;
    this.A = street.A;
    this.fear = 0; this.anger = 0; this.sad = 0;
    this.bonds = new Map();     // actor -> how well we know them (0..1)
    this.seen = new Set();      // bodies (actors / chunks) already reacted to
    this.killers = new Map();   // actor -> when we saw them kill
    this.grief = null;          // { what: actor | chunk, at(), t, phase, dur, cryT, kneel }
    this.painT = 0;
    this.scanT = rnd(0.5, 1.5);
    this.clothes = null;        // the player's clothes, as we last saw them { top, shorts, shoe, t }
    this.clothCool = rnd(8, 20);
    this.moodT = rnd(10, 25);
  }

  get W() { return this.st.W; }
  reset() {
    this.fear = this.anger = this.sad = 0;
    this.grief = null;
    this.seen.clear();
    this.killers.clear();
    this.clothes = null;
  }

  say(text, tone, force = true) {
    const A = this.A;
    if (A.brain.dead || A.seat || !text) return 0;
    const W = this.W, now = W.now();
    if (!force && (this.st.sayCool > 0 || now - (W.lastLine || 0) < 1.2)) return 0;
    W.lastLine = now;
    const d = W.bubbles.say(A, text, { tone });
    this.st.sayCool = d + rnd(1.5, 3.5);
    return d;
  }

  // ------------------------------------------------------------------ pain
  /** Hurt on `part`: how = 'pain' | 'shot' | 'broke' | 'lost'; sev = how badly. */
  pain(part, how, sev = 1) {
    const A = this.A;
    if (A.brain.dead) return;
    const big = how === 'lost' || how === 'broke' || how === 'shot';
    if (!big && (this.painT > 0 || (sev < 0.3 && Math.random() < 0.5))) return;
    this.painT = big ? 1.6 : rnd(1.1, 1.8);
    this.fear = clamp(this.fear + (big ? 0.5 : 0.1 * sev), 0, 1);
    this.anger = clamp(this.anger + (how === 'pain' ? 0.2 : 0.05), 0, 1);
    // knocked out, or lungs full: no scream in them
    const S = A.organs?.state;
    if (S?.out) return;
    const text = S && S.lung > 1.2 ? '*gasping*' : painLine(part, how);
    // (a second in: first the hit lands)
    setTimeout(() => this.say(text, how === 'lost' || how === 'shot' ? 'scared' : 'pain'), how === 'lost' ? 250 : 120);
    // very hurt, a while after: a plea
    if (big && Math.random() < 0.5) setTimeout(() => { if (!A.brain.dead && (A.organs?.blood ?? 1) < 0.85) this.say(line('hurtBad'), 'sad', false); }, rnd(4000, 7000));
  }

  // ------------------------------------------------------------------ others
  /** How well we know `a` (0..1): people we've talked with are friends. */
  bond(a) { return this.bonds.get(a) || 0; }
  befriend(a, k) { this.bonds.set(a, clamp(this.bond(a) + k, 0, 1)); }

  /** Can we see point p from here (in front of us, or close enough to notice anyway)? */
  sees(p, r = SEE_R) {
    const h = this.A.hero, d = flat(p, h.pos);
    if (d > r) return false;
    if (d < NOTICE_R) return true;
    const f = h.forward ? h.forward() : V(Math.sin(h.yaw), 0, Math.cos(h.yaw));
    return (p.x - h.pos.x) * f.x + (p.z - h.pos.z) * f.z > -0.25 * d;
  }

  /**
   * Somebody died (victim), `killer` the one who last hurt them (or null), `at` the body.
   * `found`: stumbled on a body later rather than watching it happen.
   */
  sawDeath(victim, killer, at, found = false) {
    const A = this.A, npc = this.npc, P = this.st.P;
    if (victim === A || A.brain.dead || this.seen.has(victim) || A.remote) return;
    this.seen.add(victim);
    const d = flat(at, A.hero.pos), close = 1 - clamp(d / SEE_R, 0, 1);
    const knew = this.bond(victim);
    const soft = 1 - P.tough;
    this.fear = clamp(this.fear + (found ? 0.25 : 0.55) * (0.5 + close) * (0.6 + soft), 0, 1);
    this.sad = clamp(this.sad + 0.25 + knew * 0.7, 0, 1);
    if (killer && killer !== A && !killer.brain?.dead) {
      this.killers.set(killer, this.W.now());
      this.anger = clamp(this.anger + 0.3 + knew * 0.6 + P.temper * 0.3, 0, 1);
    }
    if (this.st.cop) return; // (the police deal with it their own way)
    npc.gest.look = at.clone().setY(at.y + 0.3);
    const fem = female(victim);
    // first: the shock of it
    const delay = rnd(250, 900);
    setTimeout(() => {
      if (A.brain.dead) return;
      if (!npc.convo && A.mode === 'anim') npc.gest.play(Math.random() < 0.6 ? 'horror' : 'despair');
      this.say(lineFor(found ? 'mourn' : 'horror', fem), found ? 'sad' : 'scared');
    }, delay);
    // then what they do about it
    const killerNear = killer && !killer.brain?.dead && flat(killer.hero.pos, A.hero.pos) < 18;
    const brave = P.tough * 0.7 + this.anger * 0.6 + (this.st.P.weapon ? 0.25 : 0);
    if (killerNear && knew > 0.3 && brave > 0.7 && !this.st.busy) {
      // they killed my friend
      setTimeout(() => { if (!A.brain.dead && !killer.brain?.dead) { this.say(line('avenge'), 'angry'); this.st.startFight(killer); } }, delay + 900);
      return;
    }
    if (killerNear && (this.fear > 0.45 || soft > 0.55)) {
      // get away from whoever did that
      npc.fearT = Math.max(npc.fearT, rnd(8, 14) * (0.6 + this.fear));
      npc.fleeFrom = killer.hero.pos.clone();
      if (Math.random() < 0.5) setTimeout(() => this.say(lineFor('murderer', fem), 'scared'), delay + 1400);
      return;
    }
    if (killerNear && Math.random() < 0.5) {
      setTimeout(() => { this.say(lineFor('murderer', fem), 'angry'); npc.gest.play(Math.random() < 0.5 ? 'point' : 'shake'); }, delay + 1200);
    }
    // grief: friends, and the soft-hearted, go to the body
    const g = knew * 0.8 + soft * 0.35 + this.sad * 0.3 - this.fear * 0.35 - (killerNear ? 0.3 : 0);
    if (!this.grief && !this.st.busy && Math.random() < g) {
      setTimeout(() => this.startGrief(victim, () => victim.rd?.pos('chest', V()) ?? victim.hero.pos, victim), delay + rnd(1500, 3000));
    }
  }

  /** A body part came off someone (chunk: the piece, lying about now). */
  sawSever(victim, what, chunk, at) {
    const A = this.A, npc = this.npc, P = this.st.P;
    if (victim === A || A.brain.dead || this.seen.has(chunk) || A.remote) return;
    this.seen.add(chunk);
    const soft = 1 - P.tough;
    this.fear = clamp(this.fear + 0.4 * (0.6 + soft), 0, 1);
    this.sad = clamp(this.sad + 0.15, 0, 1);
    if (this.st.cop) return;
    npc.gest.look = at.clone();
    setTimeout(() => {
      if (A.brain.dead) return;
      if (!npc.convo && A.mode === 'anim') npc.gest.play(Math.random() < 0.5 ? 'horror' : 'despair');
      this.say(line('gore'), 'scared');
    }, rnd(300, 900));
    const by = victim?.lastHurt && this.W.now() - victim.lastHurt.t < 5 ? victim.lastHurt.by : null;
    if (by && by !== A && flat(by.hero.pos, A.hero.pos) < 15 && (this.fear > 0.4 || soft > 0.5)) {
      npc.fearT = Math.max(npc.fearT, rnd(6, 12));
      npc.fleeFrom = by.hero.pos.clone();
    }
  }

  /** Found a cut-off limb lying about later (no one in sight did it). */
  foundPart(chunk, at) {
    if (this.seen.has(chunk)) return;
    this.seen.add(chunk);
    const P = this.st.P, soft = 1 - P.tough;
    this.fear = clamp(this.fear + 0.2, 0, 1);
    this.npc.gest.look = at.clone();
    if (this.npc.convo) return;
    this.npc.gest.play('horror');
    this.say(line(Math.random() < 0.5 ? 'gore' : 'griefPart'), 'scared', false);
    const knew = chunk.actor ? this.bond(chunk.actor) : 0;
    if (!this.grief && !this.st.busy && Math.random() < soft * 0.3 + knew * 0.6) {
      this.startGrief(chunk, () => { const t = chunk.body.translation(); return V(t.x, t.y, t.z); }, chunk.actor, true);
    }
  }

  // ------------------------------------------------------------------ grieving
  startGrief(what, at, whose, part = false) {
    if (this.A.brain.dead || this.st.busy || this.npc.fearT > 0) return;
    this.npc.abort();
    this.npc.posture?.stand(true);
    this.grief = {
      what, at, whose, part, t: 0, phase: 'approach',
      dur: rnd(14, 28) * (0.6 + this.sad), cryT: rnd(0.5, 1.5),
      // kneeling down by them, or standing over them
      kneel: Math.random() < 0.65 + this.bond(whose) * 0.3,
    };
  }
  /** Is what we're grieving over still there? */
  griefGone(G) {
    if (G.part) return !this.W.chunks?.().includes(G.what);
    return !G.what.brain?.dead; // (a respawn: back on their feet)
  }
  grieve(dt, colliders) {
    const G = this.grief, A = this.A, h = A.hero, npc = this.npc;
    G.t += dt;
    if (this.griefGone(G) || G.t > G.dur + 25 || npc.fearT > 0) { this.endGrief(); return null; }
    const p = G.at();
    const face = yawTo(h.pos, p);
    npc.gest.look = p.clone().setY(p.y + 0.1);
    const d = flat(p, h.pos);
    if (G.phase === 'approach') {
      if (d > 1.1 && G.t < 25) return this.st.ctrl(this.st.goTo(p, 0.95, colliders, G.t > 6 ? 1 : 0.55), face, d > 8);
      G.phase = 'mourn'; G.t = 0;
      this.say(lineFor(G.part ? 'griefPart' : 'grief', female(G.whose)), 'sad');
    }
    // over the body: crying now and then, a word through the tears
    G.cryT -= dt;
    if (G.cryT <= 0) {
      G.cryT = rnd(4, 7);
      const r = Math.random();
      if (r < 0.55) { npc.gest.play('cry'); if (Math.random() < 0.6) this.say(line('sob'), 'sad', false); }
      else if (r < 0.8) this.say(lineFor(G.part ? 'griefPart' : 'grief', female(G.whose)), 'sad', false);
      else if (!G.kneel) npc.gest.play('despair');
    }
    if (G.t > G.dur) { this.endGrief(true); return null; }
    const c = this.st.ctrl(npc.move.set(0, 0, 0), face);
    if (G.kneel) c.crouch = true;
    return c;
  }
  endGrief(done = false) {
    const G = this.grief;
    this.grief = null;
    if (done && G && Math.random() < 0.5) this.say(lineFor('mourn', female(G.whose)), 'sad', false);
    this.sad = Math.max(0, this.sad - 0.2);
  }

  // ------------------------------------------------------------------ per frame
  tick(dt) {
    this.painT -= dt;
    this.clothCool -= dt;
    this.moodT -= dt;
    // fading: fear fastest, anger, then sadness hanging about longest
    this.fear = Math.max(0, this.fear - dt * 0.012);
    this.anger = Math.max(0, this.anger - dt * 0.008);
    this.sad = Math.max(0, this.sad - dt * 0.004);
    const A = this.A, npc = this.npc;
    if (A.brain.dead) { this.grief = null; return; }
    // people talking together get to know each other
    const cv = npc.convo;
    if (cv && cv.phase === 'talk') this.befriend(cv.other(npc).actor, dt * 0.03);
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = rnd(0.7, 1.2); this.scan(); }
  }

  /** Every second or so: bodies lying about, the killer turning up, your clothes. */
  scan() {
    const A = this.A, npc = this.npc, W = this.W, h = A.hero;
    if (A.mode !== 'anim' || A.seat || A.remote) return;
    // bodies we hadn't seen yet
    for (const o of W.actors?.() || []) {
      if (o === A || !o.brain.dead || this.seen.has(o)) continue;
      const p = o.rd?.pos('chest', V()) ?? o.hero.pos;
      if (flat(p, h.pos) < 10 && this.sees(p, 10)) { this.sawDeath(o, null, p, true); return; }
    }
    for (const c of W.chunks?.() || []) {
      if (this.seen.has(c) || c.what === 'body') continue;
      const t = c.body.translation(), p = V(t.x, t.y, t.z);
      if (flat(p, h.pos) < 7 && this.sees(p, 7)) { this.foundPart(c, p); return; }
    }
    if (this.grief || this.st.busy) return;
    // the one we saw kill someone
    for (const [k, t] of this.killers) {
      if (k.brain.dead || W.now() - t > 300) { this.killers.delete(k); continue; }
      const kp = k.seat ? k.seat.car.p : k.hero.pos, d = flat(kp, h.pos);
      if (d > 12 || !this.sees(kp, 12) || npc.fearT > 0) continue;
      const P = this.st.P;
      if (this.anger > 0.7 && P.tough > 0.55 && !k.seat) { this.say(line('avenge'), 'angry'); this.st.startFight(k); return; }
      npc.fearT = rnd(6, 10);
      npc.fleeFrom = kp.clone();
      npc.gest.look = k.hero.head.getWorldPosition(V());
      this.say(line('seeKiller'), 'scared');
      return;
    }
    this.clothesCheck();
    // still upset, a while later
    if (this.moodT <= 0 && !npc.convo && npc.fearT <= 0) {
      this.moodT = rnd(20, 40);
      if (this.sad > 0.45 && Math.random() < 0.5) { this.say(line(Math.random() < 0.5 ? 'stillShaking' : 'sob'), 'sad', false); if (this.sad > 0.7) npc.gest.play('cry', rnd(2, 3)); }
    }
  }

  /** Your clothes, as seen by us: changed since we last looked? covered in blood? */
  clothesCheck() {
    const W = this.W, pl = W.player, A = this.A, npc = this.npc, h = A.hero;
    if (!pl || pl.seat || pl.brain.dead) return;
    const pp = pl.hero.pos, d = flat(pp, h.pos);
    if (d > 7 || !this.sees(pp, 7)) return;
    const lk = pl.hero.look, now = W.now();
    const was = this.clothes;
    this.clothes = { top: lk.top, shorts: lk.shorts, shoe: lk.shoe, t: now };
    if (this.clothCool > 0 || npc.convo || npc.fearT > 0 || now - (W.lastRoast || -99) < 4) return;
    const mouth = this.st.P.mouth;
    let text = null, tone = 'say';
    const killer = this.killers.has(pl);
    // changed clothes since we last saw them (not too long ago: we'd have forgotten)
    if (was && now - was.t < 240 && (was.top !== lk.top || was.shorts !== lk.shorts)) {
      if (Math.random() < 0.55 + mouth * 0.3) {
        text = colorLine(killer ? 'newClothesKiller' : 'newClothes', lk.top);
        tone = killer ? 'angry' : 'say';
      }
    } else {
      // blood soaked into the shirt
      const Wp = pl.wounds?.parts;
      const wet = Wp ? Math.max(Wp.chest?.wet || 0, Wp.spine?.wet || 0, Wp.pelvis?.wet || 0) : 0;
      const cname = colorName(lk.top);
      if (wet > 0.25 && Math.random() < 0.3 + mouth * 0.4) {
        text = line(cname === 'white' || cname === 'beige' || cname === 'baby blue' || cname === 'silver' ? 'bloodyWhite' : 'bloodyShirt');
        tone = 'scared';
      } else if (d < 4.5 && Math.random() < mouth * 0.12) {
        // a word about the colour itself
        const own = A.hero.look?.top;
        const kind = own != null && colorName(own) === cname ? 'matching'
          : cname === 'white' ? 'whiteShirt' : cname === 'navy' ? 'copColors' : cname === 'red' || cname === 'maroon' ? 'redShirt'
            : cname === 'black' ? 'blackShirt' : cname === 'pink' ? 'pinkShirt' : null;
        if (kind) text = line(kind);
      }
    }
    if (!text) return;
    this.clothCool = rnd(25, 60);
    W.lastRoast = now;
    npc.gest.look = pl.hero.head.getWorldPosition(V());
    this.say(text, tone, false);
    if (tone === 'scared' && Math.random() < 0.5) npc.gest.play('point');
  }

  /** Takes over the controls while grieving (null: carry on). */
  control(dt, colliders) {
    if (!this.grief) return null;
    if (this.A.mode !== 'anim' || this.A.seat) return null;
    return this.grieve(dt, colliders);
  }
}
