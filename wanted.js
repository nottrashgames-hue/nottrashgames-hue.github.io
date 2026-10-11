import * as THREE from 'three';

/*
  Wanted level. Crimes (a punch, a shot, a hit-and-run, a car jacked, a body on the pavement)
  build heat; every whole point of heat is a star. A cop who sees it: straight to a star at
  least. Only civilians saw it: nothing yet - until one of them phones it in (police.js).
  While you're wanted the nearest officers (baton, or from three stars a pistol) come after
  you, the patrol car with its lights on. Get out of sight of every cop long enough and the
  stars drain away one by one. Taken down beside a cop: busted (a fine). Dead: it all resets.
*/

const flat = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
// officers on the case, by stars (the station's own only turn out from two)
const COPS_FOR = [0, 2, 3, 5, 7, 8];
const HEAT = { shove: 0.25, fist: 0.6, armed: 1.0, car: 0.8, gunfire: 0.35, shot: 1.5, jack: 1.0, kill: 2.0 };

export class Wanted {
  /** W = { hero, npcs, money, sfx, now(), dead() } */
  constructor(W) {
    this.W = W;
    this.heat = 0;
    this.unreported = 0;  // heat from crimes only civilians saw, until somebody calls it in
    this.police = null;   // (police.js, set once it exists)
    this.cops = new Set();
    this.unseen = 0;      // seconds since a cop last had eyes on you
    this.bustT = 0;
    this.manageT = 0;
    this.lastShotT = -9;
    this.el = document.getElementById('wanted');
    this.banner = document.getElementById('banner');
    this.shown = -1;
    this.render();
  }

  get stars() { return Math.min(5, Math.floor(this.heat + 1e-6)); }
  get evading() { return this.stars > 0 && this.unseen > this.graceT; }
  get graceT() { return 6 + this.stars * 2; }

  /** Anyone alive near `at` to see it (other than the dead). */
  witnessed(at, victim, range = 25) {
    for (const n of this.W.npcs) {
      const A = n.actor;
      if (A.brain.dead || A.remote || (n === victim && A.brain.dead)) continue;
      if (flat(A.hero.pos, at) < range) return true;
    }
    return false;
  }

  /** The player did something. kind: shove | fist | armed | car | gunfire | shot | jack | kill. */
  crime(kind, victim = null, force = false) {
    const W = this.W, hero = W.hero, P = this.police;
    if (hero.brain.dead) return;
    const at = hero.seat ? hero.seat.car.p : hero.hero.pos;
    const st = victim?.street;
    // they had it coming: fighting you, robbing you
    const selfDefence = st && !victim.cop && (st.mode === 'fight' || st.mode === 'mug') && st.target === hero;
    if (selfDefence && kind !== 'kill') return;
    if (kind === 'gunfire') {
      const t = W.now();
      if (t - this.lastShotT < 0.6) return;
      this.lastShotT = t;
    }
    if (victim) victim.heroHitT = W.now();
    let h = HEAT[kind] || 0.5;
    if (selfDefence) h *= 0.4;
    const cop = victim?.cop ? victim : P?.seer(at, kind === 'gunfire' ? 45 : 30, true);
    if (victim?.cop) h += kind === 'kill' ? 3 : 1.5;
    const before = this.stars;
    if (cop || force || before > 0) {
      // seen by the police (or already wanted): on the record right away
      this.heat = Math.min(5.99, Math.max(this.heat + h + this.unreported, 1));
      this.unreported = 0;
      if (cop && !victim?.cop && P.free(cop)) P.engage(cop, hero);
    } else {
      if (!this.witnessed(at, victim, kind === 'gunfire' ? 35 : 25)) return;
      this.unreported = Math.min(5, this.unreported + h);
      P?.report(hero, at, victim);
    }
    // fresh crimes get noticed: the chase is back on
    if (this.stars > 0) this.unseen = Math.min(this.unseen, 1);
    if (this.stars > before) W.sfx?.('dry', 0.4);
  }
  /** A civilian's call about you got through. */
  reported() {
    const before = this.stars;
    this.heat = Math.min(5.99, Math.max(this.heat + this.unreported, 1));
    this.unreported = 0;
    this.unseen = 0;
    if (this.stars > before) this.W.sfx?.('dry', 0.4);
  }

  clear() {
    this.heat = 0;
    this.unreported = 0;
    this.unseen = 0;
    this.bustT = 0;
    for (const n of [...this.cops]) this.release(n);
    this.render();
  }

  // ---------------------------------------------------------------- cops
  /** Swap the weapon they carry (each kind made once and kept). */
  arm(n, type) {
    const st = n.street;
    if (st.P.weapon === type && st.kit && st.kit.state !== 'loose') return;
    st.holster();
    st.kits ||= {};
    if (st.kit && st.P.weapon) st.kits[st.P.weapon] = st.kit;
    st.P.weapon = type;
    st.kit = st.kits[type] && st.kits[type].state === 'hidden' ? st.kits[type] : st.makeKit();
    st.kits[type] = st.kit;
    if (st.mode === 'fight') st.draw();
  }

  /** Off the case: back to the beat. */
  release(n) {
    const st = n.street;
    this.cops.delete(n);
    n.chasing = false;
    if (st.mode === 'fight' && st.target === this.W.hero) st.stop();
    if (st.P.weapon !== 'bat' && !st.mode) this.arm(n, 'bat');
  }

  manage() {
    const W = this.W, hero = W.hero, stars = this.stars, P = this.police;
    if (!P) return;
    const at = hero.seat ? hero.seat.car.p : hero.hero.pos;
    // the nearest officers able to go; the station's own only from two stars
    const want = COPS_FOR[stars];
    const pool = P.cops.filter((n) => {
      const A = n.actor;
      return !A.remote && !A.brain.dead && !(A.organs?.weak > 0.5) && (n.beat !== 'post' || stars >= 2) &&
        !(n.street.mode && n.street.target !== hero);
    }).sort((a, b) => flat(a.actor.hero.pos, at) - flat(b.actor.hero.pos, at));
    const on = new Set(pool.slice(0, want));
    for (const n of [...this.cops]) if (!on.has(n)) this.release(n);
    for (const n of on) {
      this.cops.add(n);
      n.chasing = true;
      n.duty = null;
      if (stars >= 3 && n.street.P.weapon !== 'pistol') this.arm(n, 'pistol');
      const st = n.street;
      if (n.actor.seat || hero.mode === 'ragdoll' || hero.brain.dead) continue;
      if (!(st.mode === 'fight' && st.target === hero) && st.upright) st.startFight(hero);
    }
  }

  update(dt) {
    const W = this.W, hero = W.hero;
    if (hero.brain.dead) { if (this.heat > 0) { this.clear(); this.flash('WASTED'); } return; }
    this.unreported = Math.max(0, this.unreported - dt / 90);
    if (this.heat <= 0) { if (this.shown !== 0) this.render(); return; }
    const at = hero.seat ? hero.seat.car.p : hero.hero.pos;
    this.manageT -= dt;
    if (this.manageT <= 0) { this.manageT = 0.5; this.manage(); }
    // a cop close enough to see you resets the clock
    let seen = false, close = false;
    for (const n of this.police?.cops || []) {
      if (n.actor.brain.dead) continue;
      const d = flat(n.actor.hero.pos, at);
      if (d < (hero.seat ? 16 : 22)) seen = true;
      if (d < 2.6 && n.actor.mode === 'anim') close = true;
    }
    this.unseen = seen ? 0 : this.unseen + dt;
    if (this.unseen > this.graceT) {
      this.heat -= dt / 7; // a star every seven seconds out of sight
      if (this.heat < 1) { this.clear(); return; }
    }
    // down on the ground with a cop standing over you: busted
    if (hero.mode === 'ragdoll' && close) {
      this.bustT += dt;
      if (this.bustT > 3) {
        const fine = W.money.take(Math.min(W.money.amount, 40 * this.stars));
        this.clear();
        this.flash(fine ? `BUSTED  -$${fine}` : 'BUSTED');
      }
    } else this.bustT = Math.max(0, this.bustT - dt);
    this.render();
  }

  flash(text) {
    const b = this.banner;
    if (!b) return;
    b.textContent = text;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
  }

  render() {
    const s = this.stars, ev = this.evading;
    const key = s * 2 + (ev ? 1 : 0);
    if (key === this.shown || !this.el) return;
    this.shown = key;
    if (!this.stars5) {
      const star = '<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.1l-6.1 3.5 1.5-6.8-5.2-4.6 6.9-.7z"/></svg>';
      this.el.innerHTML = star.repeat(5);
      this.stars5 = [...this.el.children];
    }
    this.stars5.forEach((el, i) => el.classList.toggle('on', i < s));
    this.el.classList.toggle('evading', ev);
  }
}
