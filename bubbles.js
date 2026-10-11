import * as THREE from 'three';

/*
  Speech bubbles: a line of text floating over someone's head, tracking them on screen.
  One bubble per person; a new line replaces the old one.
*/
const _p = new THREE.Vector3();

export class Bubbles {
  constructor(camera, parent = document.body) {
    this.camera = camera;
    this.root = document.createElement('div');
    this.root.id = 'bubbles';
    parent.appendChild(this.root);
    this.live = new Map(); // actor -> { el, t, dur }
  }

  /** tone: 'say' | 'angry' | 'scared' | 'sad' | 'pain' */
  say(actor, text, { dur = 2.8, tone = 'say', toName = null, showNpc = false } = {}) {
    if (actor?.npc && !showNpc) return 0;
    let b = this.live.get(actor);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'bubble';
      this.root.appendChild(el);
      b = { el, t: 0, dur };
      this.live.set(actor, b);
    }
    b.el.textContent = text;
    // (a line aimed at someone: whose it is, over the words)
    if (toName) {
      const to = document.createElement('span');
      to.className = 'to';
      to.textContent = `@${toName}`;
      b.el.prepend(to);
    }
    b.el.dataset.tone = tone;
    // (special bodies have a bubble of their own, whatever the tone)
    b.el.toggleAttribute('data-gold', !!actor.hero?.look?.gold);
    b.t = 0;
    b.dur = Math.max(dur, 1.2 + text.length * 0.055);
    return b.dur;
  }
  talking(actor) { return this.live.has(actor); }
  clear() { for (const b of this.live.values()) b.el.remove(); this.live.clear(); }

  update(dt) {
    const cam = this.camera, w = innerWidth, h = innerHeight;
    for (const [actor, b] of this.live) {
      b.t += dt;
      if (b.t >= b.dur || actor.brain?.dead) { b.el.remove(); this.live.delete(actor); continue; }
      // (a body that's out of sight, e.g. parked: its head is nowhere near where the bubble would go)
      if (actor.hero.shown === false) { b.el.style.display = 'none'; continue; }
      actor.hero.head.getWorldPosition(_p);
      _p.y += 0.32;
      const dist = _p.distanceTo(cam.position);
      _p.project(cam);
      const off = _p.z > 1 || dist > 34 || Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2;
      b.el.style.display = off ? 'none' : '';
      if (off) continue;
      const fade = Math.min(1, b.t / 0.12, (b.dur - b.t) / 0.3);
      const s = Math.max(0.55, Math.min(1, 9 / dist));
      b.el.style.opacity = fade.toFixed(2);
      b.el.style.transform = `translate(${((_p.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _p.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      b.el.style.zIndex = String(1000 - Math.round(dist * 10));
    }
  }
}
