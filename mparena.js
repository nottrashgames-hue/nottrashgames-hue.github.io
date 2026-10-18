import * as THREE from 'three';

/*
  The multiplayer arena (sandbox-maps.js buildArena({ mp: true })): everyone spawns straight into
  the pit with a random melee weapon (a different one every life - main.js giveKnife), fights,
  dies (ragdoll and all), and is back in a few seconds somewhere else in the pit. No reset, no
  weapon wheel, no hotbar here (main.js applyMode / vr.js noReset, noWheel).

  This file is the local player's side only: the health bar on your left hand, and the respawn.
  Other players come in through multiplayer/session.js (see multiplayer/GUIDE.md) - their bodies
  are ordinary actors, so they die and ragdoll the same way.

  o = { hero, respawn() }
*/

const RESPAWN_T = 4;   // s dead before you're back
const BAR_W = 0.13, BAR_H = 0.022;

/** 0..1: how alive an actor is - blood left (death at 0.3) and brain damage (death at ~0.45). */
export function healthOf(A) {
  if (!A || A.brain?.dead) return 0;
  const O = A.organs;
  if (!O) return 1;
  const blood = (O.blood - 0.3) / 0.7;
  const brain = 1 - (O.brainDmg || 0) / 0.45;
  return Math.max(0, Math.min(1, blood, brain));
}

/** A little bar strapped to the back of a hand: always faces you, drawn over everything. */
export class HandBar {
  constructor(hand) {
    this.c = document.createElement('canvas');
    this.c.width = 128; this.c.height = 24;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, toneMapped: false }));
    this.sprite.scale.set(BAR_W, BAR_H, 1);
    this.sprite.position.set(0, 0.05, 0); // (just off the back of the hand)
    this.sprite.renderOrder = 999;
    this.sprite.frustumCulled = false;
    hand.add(this.sprite);
    this.shown = -1;
    this.set(1);
  }
  set(f) {
    const k = Math.round(f * 100);
    if (k === this.shown) return;
    this.shown = k;
    const g = this.c.getContext('2d'), W = this.c.width, H = this.c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,6,6,0.75)';
    g.beginPath(); g.roundRect(0, 0, W, H, 6); g.fill();
    // green, through yellow, to red
    g.fillStyle = `hsl(${Math.round(f * 120)}, 85%, 48%)`;
    g.beginPath(); g.roundRect(3, 3, (W - 6) * f, H - 6, 4); g.fill();
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.sprite.removeFromParent();
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

export class MpArena {
  constructor(o) {
    Object.assign(this, o);
    this.deadT = 0;
    // (arms[0]: the left)
    this.bar = new HandBar(this.hero.hero.arms[0].hand);
  }
  get active() { return true; }
  deadText() { return 'Respawning in ' + Math.max(1, Math.ceil(RESPAWN_T - this.deadT)) + '…'; }
  update(dt) {
    const A = this.hero;
    this.bar.set(healthOf(A));
    if (A.brain.dead) {
      if ((this.deadT += dt) >= RESPAWN_T) { this.deadT = 0; this.respawn(); }
    } else this.deadT = 0;
  }
  dispose() { this.bar.dispose(); }
}
