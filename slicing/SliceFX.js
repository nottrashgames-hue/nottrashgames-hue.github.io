import * as THREE from 'three';
import { GORE, bloodOn } from './GoreSettings.js';
import { inkOf } from '../inks.js';

/*
  SliceFX - what a cut looks, sounds and feels like (BladeCutter calls these):

  enter  the edge bites in: a short sharp haptic pulse (stronger for tougher tissue and a
         faster blade), the slice sound
  drag   while it's dragged through: a lighter, continuous rumble (throttled pulses)
  cut    through: a burst of blood out of both new faces along the plane normal, a spray thrown
         the way the blade was going, blood on the blade, blood decals on the surfaces round
         it, and the layered sound - the slice, the wet impact, a bone crack if it went through
         bone - pitched and pushed by the speed of the cut
  blunt  a knock (the flat, too slow, uncuttable): a dull thud and a thump in the hand
  stall  ran out of push inside: a heavy thud, the blade stops
  stab   point in: a wet punch

  Amounts come from GORE (GoreSettings.js); the player's own switches (settings.js) still win.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const MAX_DECALS = 24;
// how many drops slicing may throw: a steady rate with a burst on top (a long carve through
// someone would otherwise keep the air full of drops, each one tested against every body)
const DROP_RATE = 40, DROP_BURST = 28;
const DECAL_GAP = 260; // ms between new floor decals

function decalTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(110,8,12,0.95)';
  // a splat: a blob and a ring of droplets round it
  g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 34, s = 2 + Math.random() * 7;
    g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SliceFX {
  /** ctx: { scene, blood, sfx, castSeg } */
  constructor(ctx) {
    this.ctx = ctx;
    this.dragT = 0;
    this.budget = DROP_BURST; this.budT = performance.now(); this.decalT = 0; this.bleedT = 0;
    this.decals = [];
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }

  /** Up to n drops, out of what the budget has left right now. */
  take(n) {
    const now = performance.now();
    this.budget = Math.min(DROP_BURST, this.budget + (now - this.budT) / 1000 * DROP_RATE);
    this.budT = now;
    const k = Math.max(0, Math.min(Math.round(n), Math.floor(this.budget)));
    this.budget -= k;
    return k;
  }

  sound(name, vol, rate) { this.ctx.sfx?.(name, clamp(vol, 0, 1), { rate }); }
  speedK(sp) { return clamp(sp / 14, 0, 1); }

  enter(cutter, C, info, sp) {
    const k = this.speedK(sp), T = C.T;
    if (T.kind === 'actor' || T.kind === 'chunk') {
      // the bite: a hard wet hack, a jolt through the hand, blood bursting back out of the entry
      cutter.haptic?.(1, 90);
      this.sound('hack', 0.75 + 0.25 * k, 0.9 + 0.2 * k + rnd(-0.05, 0.05));
      this.sound('flesh', 0.6 + 0.4 * k, 0.75);
      const out = C.vel.lengthSq() > 1e-6 ? C.vel.clone().normalize().negate() : V(0, 1, 0);
      this.bleed(T, C.entry, out, C.vel.clone().multiplyScalar(-0.3), 0.6 + 0.6 * k);
      cutter.w.blood?.add(C.entry, 0.5 + 0.4 * k, T.A ? inkOf(T.A) : 0);
      cutter.w.ctx.shake?.(0.06 + 0.08 * k, cutter.w.owner);
      // they feel it
      if (T.A && !T.A.brain?.dead) {
        // (no scream / pain here: the blow itself - melee.js land -> struck - already makes them cry out once)
      }
      return;
    }
    cutter.haptic?.(clamp(0.45 + info.resistance / 30 + k * 0.35, 0.35, 1), 35);
    this.sound(info.sound === 'flesh' ? 'hack' : info.sound, 0.4 + 0.5 * k, 1.05 + 0.25 * k);
  }

  /** The edge going on deeper into someone: a wet rip, blood, the hand feeling it tear. */
  deeper(cutter, C, point, n, depthK) {
    const now = performance.now();
    if (now - (this.ripT || 0) > 110) {
      this.ripT = now;
      this.sound('rip', 0.55 + 0.4 * depthK, rnd(0.85, 1.15));
    }
    cutter.haptic?.(clamp(0.45 + depthK * 0.4, 0.4, 0.9), 40);
    if (now - this.bleedT < 220) return;
    this.bleedT = now;
    this.bleed(C.T, point, n, C.vel, 0.35 + depthK * 0.4);
    cutter.w.blood?.add(point, 0.25, C.T.A ? inkOf(C.T.A) : 0);
  }

  /** The edge meets the bone: a crack, a hard kick in the hand. */
  bone(cutter, C, point) {
    cutter.haptic?.(1, 120);
    this.sound('bonecrack', 0.95, rnd(0.9, 1.1));
    this.sound('crunch', 0.7, 0.75);
    cutter.w.ctx.shake?.(0.1, cutter.w.owner);
    const B = this.ctx.blood;
    if (B && bloodOn()) (C.T.A ? B.inked(C.T.A) : B).spray(point, V(0, 1, 0), 2.5, this.take(10 * GORE.bloodAmount), 0.6, 1);
  }

  drag(cutter, C, info, sp, res) {
    const now = performance.now();
    if (now - this.dragT < 45) return;
    this.dragT = now;
    const body = C.T.kind === 'actor';
    cutter.haptic?.(clamp((body ? 0.3 : 0.1) + res / 30 + sp / 50, 0.1, body ? 0.85 : 0.5), 50);
  }

  blunt(cutter, C, info, sp) {
    const k = this.speedK(sp);
    if (sp < 1.5) return;
    cutter.haptic?.(clamp(0.3 + k * 0.5, 0.2, 0.9), 45);
    if (C.T.kind === 'mesh') this.sound(info.sound === 'flesh' ? 'punch' : info.sound === 'chop' ? 'bat' : info.sound, 0.3 + 0.4 * k, 0.8);
    else this.sound('punch', 0.4 + 0.4 * k, 0.8);
  }

  stall(cutter, C, info) {
    cutter.haptic?.(0.9, 70);
    this.sound('flesh', 0.6, 0.75);
    this.sound('impact', 0.4, 0.6);
    if (info.bleeds) this.bleed(C.T, C.last, C.vel.clone().normalize().negate(), C.vel, 0.4);
  }

  stab(cutter, C, sp) {
    cutter.haptic?.(clamp(0.6 + sp / 15, 0.6, 1), 70);
    this.sound('hack', 0.7, 1.2);
    this.sound('flesh', 0.8, 0.8);
    this.bleed(C.T, C.entry, C.vel.clone().normalize().negate(), C.vel, 0.7);
  }

  cut(cutter, C, point, n, vel, info, T) {
    const sp = vel.length(), k = this.speedK(sp);
    const body = T.kind === 'actor' || T.kind === 'chunk';
    if (body) {
      // off: the sever, the bone going, a gib - and it pours out of both ends
      this.sound('sever', 0.9 + 0.1 * k, rnd(0.92, 1.05));
      this.sound('bonecrack', 0.7, rnd(0.8, 0.95));
      this.sound('gib', 0.6 + 0.3 * k, 0.9);
      cutter.haptic?.(1, 160);
      cutter.w.ctx.shake?.(0.16 + 0.1 * k, cutter.w.owner);
      this.bleed(T, point, n, vel, 2.2);
      const B = this.ctx.blood;
      if (B && bloodOn()) for (let i = 0; i < 3; i++) (T.A ? B.inked(T.A) : B).spray(point, V(rnd(-0.6, 0.6), rnd(0.2, 1), rnd(-0.6, 0.6)).normalize(), 3 + sp * 0.2, this.take(16 * GORE.bloodAmount), 0.5, 1.1);
      if (cutter.w.blood) cutter.w.blood.add(point, 1.4 * GORE.bladeBlood, T.A ? inkOf(T.A) : 0);
      return;
    }
    this.sound(info.sound === 'flesh' ? 'hack' : info.sound, 0.5 + 0.5 * k, 0.9 + 0.3 * k);
    if (info.bleeds) this.sound('flesh', 0.55 + 0.45 * k, 0.85 + 0.3 * k);
    if (C.bone || info.crack) this.sound('crunch', 0.5 + 0.4 * k, 0.8 + 0.3 * k);
    cutter.haptic?.(clamp(0.6 + k * 0.4, 0.5, 1), 60);
    if (!info.bleeds) return;
    this.bleed(T, point, n, vel, 1);
    if (cutter.w.blood) cutter.w.blood.add(point, (0.6 + 0.5 * k) * GORE.bladeBlood, 0);
  }

  /** Blood out of a cut at point: both faces along n, a spray along the blade, decals near. */
  bleed(T, point, n, vel, amt) {
    const B = this.ctx.blood;
    if (!B || !bloodOn() || GORE.bloodAmount <= 0) return;
    const a = amt * GORE.bloodAmount, sp = vel.length();
    const ink = (b) => (T.A ? b.inked(T.A) : T.c?.actor ? b.inked(T.c.actor) : b);
    // a burst out of both new faces, along the plane normal
    // (fewer, slightly bigger drops when the budget's running low: it still reads as a lot of blood)
    const want = 11 * a + (sp > 1 ? 7 * a : 0), got = this.take(want);
    if (!got) return;
    const sz = 1 + 0.6 * (1 - got / Math.max(1, want));
    const nf = Math.round(got * (sp > 1 ? 0.62 : 1) / 2);
    if (nf) {
      ink(B).spray(point, n, 1.6 + sp * 0.12, nf, 0.45, sz);
      ink(B).spray(point, n.clone().negate(), 1.6 + sp * 0.12, nf, 0.45, sz);
    }
    // flung the way the blade was going
    if (sp > 1 && got - nf * 2 > 0) ink(B).spray(point, vel.clone().divideScalar(sp), sp * 0.35, got - nf * 2, 0.25, 0.9 * sz);
    // decals: where the spray's going to land (down, and along the blade's way) - not every bleed
    const now = performance.now();
    if (now - this.decalT < DECAL_GAP) return;
    this.decalT = now;
    this.decalToward(point, V(0, -1, 0), 2.2, a);
    if (sp > 1) this.decalToward(point, vel.clone().divideScalar(sp).add(V(0, -0.4, 0)).normalize(), 2.5, a);
  }

  decalToward(from, dir, len, amt) {
    const cast = this.ctx.castSeg;
    if (!cast) return;
    const h = cast(from, from.clone().addScaledVector(dir, len));
    if (!h) return;
    let d = this.decals.length >= MAX_DECALS ? this.decals.shift() : null;
    if (!d) {
      d = { mesh: new THREE.Mesh(this.decalGeo, this.decalMat.clone()), t: 0 };
      d.mesh.renderOrder = 2;
    }
    const s = rnd(0.18, 0.4) * (0.7 + 0.5 * amt);
    d.mesh.scale.set(s, s, s);
    d.mesh.position.copy(h.point).addScaledVector(h.normal, 0.004);
    d.mesh.quaternion.setFromUnitVectors(V(0, 0, 1), h.normal);
    d.mesh.rotateZ(Math.random() * Math.PI * 2);
    d.mesh.material.opacity = 0.9;
    d.t = 0;
    this.ctx.scene.add(d.mesh);
    this.decals.push(d);
  }

  update(dt) {
    const life = GORE.decalLifetime;
    if (!life) return;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      const fade = life - d.t;
      if (fade < 3) d.mesh.material.opacity = 0.9 * Math.max(0, fade / 3);
      if (fade <= 0) { d.mesh.removeFromParent(); d.mesh.material.dispose(); this.decals.splice(i, 1); }
    }
  }

  clear() { for (const d of this.decals) d.mesh.removeFromParent(); this.decals.length = 0; }
}
