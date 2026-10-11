import * as THREE from 'three';

/*
  The bite (the baseplate): whoever a zombie's teeth get into is infected. It takes its time -
  a fever, the colour going out of them, legs going - and then it kills them. A person who dies
  infected gets back up a little later as one of the dead. You (the player) just sicken and die:
  the world goes grey and swims first. Nothing cures it; a respawn is a clean start.
  Runs on the copy that owns each body; turning is told to everyone (mp 'turn').
*/

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const GREY = new THREE.Color(0x7d8a6a);

export class Infection {
  /** ctx: { hero, npcs(), makeZombie(npc), send(msg), sfx, veil (element) } */
  constructor(ctx) { this.ctx = ctx; }

  /** Teeth in (on the bitten body's owner). */
  bitten(A) {
    if (A.npc?.zombie || A.organs?.undead || A.infected) return;
    A.infected = { t: 0, turnAt: A === this.ctx.hero ? rnd(55, 80) : rnd(25, 45), deadT: 0, skin0: null };
  }

  update(dt) {
    const { hero } = this.ctx;
    for (const n of this.ctx.npcs()) {
      const A = n.actor, I = A.infected;
      if (!I || A.remote || n.zombie) continue;
      I.t += dt;
      this.fade(A, I);
      if (!A.brain.dead) {
        // (the fever: legs going, then it takes them)
        if (I.t > I.turnAt) A.organs?.die();
        else if (I.t > I.turnAt * 0.7 && A.mode === 'anim' && Math.random() < dt * 0.08) A.goRagdoll?.('stumble', { balance: 0.8, decay: 0.3 });
        continue;
      }
      // dead with it in them: a while, and they get up
      I.deadT += dt;
      if (I.deadT > (I.riseAt ||= rnd(5, 9))) this.turn(n);
    }
    // ours: a slow grey, the edges closing in, then it's over
    const I = hero.infected;
    if (I && !hero.brain.dead) {
      I.t += dt;
      this.fade(hero, I);
      if (I.t > I.turnAt) { hero.organs?.die(); this.ctx.sfx?.('groan', 0.6); }
      else if (I.t > I.turnAt * 0.75 && hero.mode === 'anim' && Math.random() < dt * 0.05) hero.goRagdoll?.('stumble', { balance: 0.85, decay: 0.3 });
    }
    const k = I ? clamp(I.t / I.turnAt, 0, 1) : 0;
    const v = this.ctx.veil;
    if (v && v._k !== Math.round(k * 50)) {
      v._k = Math.round(k * 50);
      v.style.opacity = (k * 0.85).toFixed(3);
      v.style.backdropFilter = v.style.webkitBackdropFilter = k > 0 ? `grayscale(${(k * 0.8).toFixed(2)}) blur(${(k * k * 2.5).toFixed(2)}px)` : '';
    }
  }

  /** The colour drains out of them as it goes on. */
  fade(A, I) {
    const m = A.hero.mat?.skin;
    if (!m) return;
    I.skin0 ||= m.color.clone();
    m.color.copy(I.skin0).lerp(GREY, clamp(I.t / I.turnAt, 0, 1) * 0.6);
  }

  /** Up again, one of the dead (the body's owner; everyone else is told). */
  turn(n, remote = false) {
    const A = n.actor;
    if (n.zombie || !n.street) return;
    const skin = A.hero.mat?.skin;
    if (skin) skin.color.copy(A.infected?.skin0 || skin.color).lerp(GREY, 0.75);
    A.infected = null;
    this.ctx.makeZombie(n);
    n.street.zSpeed = 0.7;
    n.cashDropped = true;
    if (A.organs) { if (!remote) A.organs.heal(); A.organs.undead = true; }
    if (!remote) {
      if (A.mode === 'ragdoll') A.getUp?.(false);
      this.ctx.send?.(A);
    }
    this.ctx.sfx?.('groan', 0.8, { vary: 0.2 });
  }
}
