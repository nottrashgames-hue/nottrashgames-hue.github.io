import * as THREE from 'three';
import { blob, part, std, prof, FRONT, BACK } from './costumes.js';

/*
  costume 'bee' (special.js): a queen bee. Yellow and black banded all over, a fuzzy collar,
  big glossy black compound eyes, two antennae, a gold crown on her head, four glassy wings
  buzzing off her back - and a long banded abdomen off the small of her back with the stinger
  at its tip (ch.stinger: hidden while it's pulled out, queen.js).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const YEL = 0xf2b418, BLK = 0x141210;

export function bee(ch) {
  const F = ch.face, C = ch.chest, M = ch.mat;
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  const Y = (yh) => yh - 0.3;
  const black = std(BLK, { roughness: 0.45 });
  const yellow = std(YEL, { roughness: 0.8 });
  const fuzz = std(0xf7d56a, { roughness: 1 });
  const gold = std(0xf0c040, { roughness: 0.25, metalness: 0.9 });
  const gem = std(0xd01848, { roughness: 0.15, metalness: 0.2, emissive: 0x400010 });
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }

  // black bands round the chest (just proud of the shirt, front and back profiles)
  for (const yh of [0.33, 0.44]) {
    const fz = prof(FRONT, yh) * kf, bz = prof(BACK, yh) * kf;
    const band = blob(black, [0, Y(yh), (fz - bz) / 2], [0.155 * kx, 0.032, (fz + bz) / 2 + 0.006], C);
    band.scale.x *= 1.05;
  }
  // the fuzzy collar round the neck
  blob(fuzz, [0, Y(0.585), 0], [0.11 * kx, 0.04, 0.085 * kf], C);

  // big compound eyes, wrapping round the sides of the head, a glint on each
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [1, -1]) {
    const e = blob(std(0x0b0a10, { roughness: 0.12, metalness: 0.3 }), [s * 0.055, 0.02, 0.07], [0.04, 0.058, 0.04], F, [0, s * 0.5, 0]);
    blob(glint, [-0.3 * s, 0.4, 0.8], [0.14, 0.14, 0.1], e).castShadow = false;
    ch.tinyFace?.push(e);
  }
  // a little smile
  const smile = part(new THREE.TorusGeometry(0.018, 0.0028, 4, 12, Math.PI * 0.7), black, F, [0, -0.052, 0.1], [0, 0, Math.PI + Math.PI * 0.15]);
  smile.castShadow = false;
  // antennae: up and out, bent at the elbow, a knob on the end
  const ants = [];
  for (const s of [1, -1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.028, 0.085, 0.07);
    a.rotation.set(-0.35, 0, -s * 0.35);
    F.add(a);
    part(new THREE.CylinderGeometry(0.003, 0.004, 0.09, 5).translate(0, 0.045, 0), black, a, [0, 0, 0]);
    const tip = new THREE.Group();
    tip.position.y = 0.09;
    tip.rotation.x = 0.9;
    a.add(tip);
    part(new THREE.CylinderGeometry(0.0025, 0.003, 0.06, 5).translate(0, 0.03, 0), black, tip, [0, 0, 0]);
    blob(black, [0, 0.062, 0], [0.008, 0.01, 0.008], tip);
    ants.push({ a, s });
  }

  // the crown: a gold band with points, a gem on each, a big one at the front
  const crown = new THREE.Group();
  crown.position.set(0, 0.098, -0.004);
  crown.rotation.x = -0.12;
  F.add(crown);
  part(new THREE.CylinderGeometry(0.062, 0.058, 0.03, 20, 1, true), gold, crown, [0, 0, 0]).material.side = THREE.DoubleSide;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    part(new THREE.ConeGeometry(0.011, 0.034, 4), gold, crown, [Math.sin(a) * 0.06, 0.03, Math.cos(a) * 0.06]);
    blob(gold, [Math.sin(a) * 0.06, 0.05, Math.cos(a) * 0.06], [0.006, 0.006, 0.006], crown);
    if (i % 2 === 0) blob(gem, [Math.sin(a) * 0.062, 0.002, Math.cos(a) * 0.062], [0.007, 0.008, 0.004], crown, [0, a, 0]);
  }
  blob(gem, [0, 0.008, 0.064], [0.012, 0.014, 0.006], crown);

  // wings: two pairs off the shoulder blades, glassy, buzzing
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xdcecff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
  const vein = std(0x2a2a30, { roughness: 0.6 });
  const wings = [];
  for (const s of [1, -1]) for (const [dy, len, tilt] of [[0.52, 0.34, 0.35], [0.44, 0.24, -0.15]]) {
    const w = new THREE.Group();
    w.position.set(s * 0.05, Y(dy), -prof(BACK, dy) * kf + 0.01);
    C.add(w);
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(1, 20), wingMat);
    leaf.scale.set(len * 0.5, len * 0.19, 1);
    leaf.position.set(s * len * 0.5, 0, 0);
    leaf.castShadow = false;
    leaf.renderOrder = 2;
    const bone = part(new THREE.CylinderGeometry(0.0022, 0.0022, len, 4), vein, w, [s * len * 0.5, len * 0.1, 0], [0, 0, Math.PI / 2]);
    bone.castShadow = false;
    w.add(leaf);
    wings.push({ w, s, tilt });
  }

  // the abdomen: big, banded, hanging off the small of the back, the stinger at its tip
  const piv = new THREE.Group();
  piv.position.set(0, 0.1, -0.1);
  piv.rotation.x = -0.75;
  ch.hips.add(piv);
  blob(black, [0, 0, -0.03], [0.05, 0.05, 0.05], piv);
  const L = 0.32;
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const u = (i + 0.5) / rings;
    const r = 0.155 * Math.sin(Math.PI * (0.18 + u * 0.8)) * kx;
    const m = i % 2 ? black : yellow;
    blob(m, [0, 0, -0.06 - u * L], [r, r * 0.95, L / rings * 0.78], piv);
  }
  const sting = part(new THREE.ConeGeometry(0.018, 0.1, 8), black, piv, [0, -0.004, -0.06 - L - 0.03], [-Math.PI / 2, 0, 0]);
  ch.stinger = sting;

  // antennae twitch, wings buzz (a blur while moving, a lazy flutter stood still), the abdomen breathes
  let t = Math.random() * 10;
  const prev = ch.costumeTick;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    const air = ch.grounded === false ? 1 : 0;
    const buzz = Math.max(sp, air, 0.12);
    for (const { w, s, tilt } of wings) {
      const f = Math.sin(t * (8 + buzz * 70)) * (0.25 + buzz * 0.5);
      w.rotation.set(tilt, s * (0.9 - buzz * 0.35), s * f);
    }
    for (const { a, s } of ants) a.rotation.z = -s * (0.35 + Math.sin(t * 2.3 + s) * 0.08);
    piv.rotation.x = -0.75 + sp * 0.2 + Math.sin(t * 1.6) * 0.04;
  };
}
