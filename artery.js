import * as THREE from 'three';
import { settings, bloodCount } from './settings.js';
import { inkOf, noInk } from './inks.js';

/*
  Arterial bleeding: a cut artery (a stump, a round through the femoral, the carotid, the
  brachial, the aorta) pumps blood out in jets, one per heartbeat. The heart speeds up as blood
  runs out, the jets weaken with the pressure, and a heart that has stopped gives a few last
  weak pulses and then nothing. Each jet also drains the body it's in (only on the copy that
  simulates that body; everyone else just sees the blood).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const MAX = 24;
const RATE = 45; // stream points per second, per jet (bloodstream.js joins them into one rope)

export class Arteries {
  constructor(blood) {
    this.blood = blood;
    this.list = [];
  }

  /**
   * A jet from `obj` (a body part's group) at local point `lp`, pointing along local `ln`.
   * k: how big the vessel is (~0.5 small .. 1.5 carotid / femoral / a torso). clot: seconds
   * before it closes up on its own.
   */
  add(actor, obj, lp, ln, k = 1, clot = 45) {
    if (this.list.length >= MAX) this.end(this.list.shift());
    this.list.push({ actor, obj, lp: lp.clone(), ln: ln.clone().normalize(), k, clot, t: 0, ph: Math.random(), deadT: 0 });
  }

  /** A round's wound (from wounds.js: its point and normal, local to the part's group `obj`). */
  wound(actor, obj, w, k) {
    if (!obj || !w?.local) return;
    // out through the hole, along the skin's normal there (or away from the part's axis)
    const n = w.nLocal?.clone() || V(w.local.x, 0, w.local.z);
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
    this.add(actor, obj, w.local, n, k, rnd(35, 60));
  }

  /** A jet gone: its stream stops, what's in the air still falls. */
  end(j) { if (j?.stream) { this.blood?.streams?.close(j.stream); j.stream = null; } }
  clearActor(a) { this.list = this.list.filter((j) => (j.actor !== a ? true : (this.end(j), false))); }
  clear() { this.list.length = 0; }

  update(dt) {
    const B = this.blood;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const j = this.list[i], A = j.actor, O = A.organs;
      j.t += dt;
      // (gone with the body: a respawn heals it)
      // (a puppet's blood isn't ours to know: assume it's run a while)
      const vol = A.remote || !O ? 0.8 : O.blood;
      if (!A.hero.root.parent || vol > (j.vol ?? vol) + 0.15) { this.end(j); this.list.splice(i, 1); continue; }
      j.vol = vol;
      const dead = A.brain.dead;
      if (dead) j.deadT += dt;
      // pressure: what's left in the body, closing off as it clots, gone once the heart stops
      const press = Math.max(0, (vol - 0.28) / 0.72) * Math.exp(-j.t / j.clot) * (dead ? Math.exp(-j.deadT / 0.9) : 1);
      if (press < 0.04) { this.end(j); this.list.splice(i, 1); continue; }
      // the heart races as the blood runs out
      const hz = 1.25 + Math.max(0, 1 - vol) * 2.6;
      j.ph += dt * hz;
      const ph = j.ph % 1;
      // a sharp push each beat, a steady run between
      const beat = ph < 0.22 ? Math.sin((ph / 0.22) * Math.PI) : 0.12;
      const k = j.k * press;
      if (!A.remote && O && !dead && !A.wounds?.dry) O.blood -= dt * 0.006 * k * (0.4 + beat);
      if (!B || !settings.blood || !settings.spurts || !settings.bloodSpray || !(settings.bloodAmount > 0)) { this.end(j); continue; }
      j.obj.updateWorldMatrix(true, false);
      const p = j.obj.localToWorld(_p.copy(j.lp));
      const d = _d.copy(j.ln).transformDirection(j.obj.matrixWorld);
      // the stream: one smooth rope of blood along an arc - surging out far on each beat,
      // sagging back between - drawn as a single ribbon (bloodstream.js), so it costs a handful
      // of light points a second instead of a hail of drops; it pools where it lands
      const speed = (1.1 + 3.4 * beat) * Math.min(1.4, 0.55 + 0.45 * k);
      // (the body's own motion carries the stream with it)
      const pw = j.obj.getWorldPosition(_w);
      const mv = j.last ? _v.subVectors(pw, j.last).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 6) : _v.set(0, 0, 0);
      (j.last ||= V()).copy(pw);
      const S = B.streams;
      if (S) {
        const ink = inkOf(A);
        if (!noInk(ink)) {
          if (!j.stream) j.stream = S.open(A, ink);
          j.acc = (j.acc || 0) + dt * RATE;
          const w = 0.0042 * Math.min(1.35, 0.7 + 0.3 * k) * (0.7 + 0.45 * beat) * Math.sqrt(Math.min(1, press + 0.25));
          while (j.acc >= 1) {
            j.acc -= 1;
            // (a sliver of twist, so it isn't a laser)
            const wob = 0.012 + 0.014 * (1 - beat);
            _q.copy(d);
            _q.x += rnd(-wob, wob); _q.y += rnd(-wob, wob) * 0.6; _q.z += rnd(-wob, wob);
            _q.normalize().multiplyScalar(speed).add(mv);
            // (each one where it would be by now: the rope evenly strung out whatever the frame rate)
            _s.copy(p).addScaledVector(_q, j.acc / RATE);
            S.emit(j.stream, _s, _q, w);
          }
        }
      }
      // and a spit of fine spray off it as each beat hits
      if (beat > 0.6 && !j.spat) { j.spat = true; B.inked(A).spray(p, d, speed * 0.9, bloodCount(4), 0.18, rnd(0.9, 1.3)); }
      if (beat < 0.2) j.spat = false;
    }
  }
}
const _p = V(), _d = V(), _q = V(), _s = V(), _w = V(), _v = V();
