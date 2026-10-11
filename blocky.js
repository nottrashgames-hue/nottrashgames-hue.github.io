import * as THREE from 'three';
import { part, std, prof, FRONT, BACK } from './costumes.js';

/*
  Blocky bodies (special.js), built onto a Character like the rest of costumes.js: a box round
  every part of the body - chest and pelvis, upper and lower arms and legs, the feet and the head -
  sized to the body's own build so nothing round shows through.
    costume 'fatboy'    : Fatboy (The Battle Bricks) - big and dark navy, a black helmet over a
                          white panel of a face (round staring eyes, a grin full of teeth) and a
                          huge black bomb held up over the head on two posts off the back, its fuse
                          lit. It goes off when he dies (look.deathFx 'explode', throwables.js).
*/

const Y = (yh) => yh - 0.3; // hips space -> chest group
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Boxes over every limb and the torso. mats: { chest, belly, upper, fore, thigh, shin, foot } */
export function boxBody(ch, mats, pad = 1) {
  const B = ch.shape.B, kx = Math.pow(B, 0.55), kxl = Math.pow(B, 0.8);
  const kf = Math.pow(B, 0.8) + Math.max(0, B - 1.05) * 1.1, kb = Math.pow(B, 0.7);
  const C = ch.chest, H = ch.hips;
  // the chest: shoulders to the belly (hips space 0.26 .. 0.62)
  const cw = 0.19 * kx * pad, cf = prof(FRONT, 0.45) * kf * 1.08 + 0.012, cbk = prof(BACK, 0.45) * kb * 1.08 + 0.012;
  part(box(cw * 2, 0.37, cf + cbk), mats.chest, C, [0, Y(0.44), (cf - cbk) / 2]);
  // the belly and pelvis (hips space -0.14 .. 0.3)
  const bw = 0.172 * kxl * pad, bf = 0.106 * kf + 0.012, bb = 0.118 * kb + 0.012;
  part(box(bw * 2, 0.45, bf + bb), mats.belly, H, [0, 0.08, (bf - bb) / 2]);
  const ka = ch.shape.arm * 1.12 * pad, kl = ch.shape.leg * 1.12 * pad;
  for (const a of ch.arms) {
    part(box(0.12 * ka, 0.33, 0.12 * ka), mats.upper, a.upper, [0, -0.13, 0]);
    part(box(0.1 * ka, 0.27, 0.1 * ka), mats.fore, a.fore, [0, -0.12, 0]);
  }
  for (const l of ch.legs) {
    part(box(0.16 * kl, 0.46, 0.18 * kl), mats.thigh, l.thigh, [0, -0.2, 0.004]);
    part(box(0.14 * kl, 0.44, 0.15 * kl), mats.shin, l.shin, [0, -0.18, 0.004]);
    part(box(0.11 * kl, 0.085, 0.3), mats.foot, l.foot, [0, -0.035, 0.055]);
  }
}
const hideEyes = (ch) => { for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; } };

/** A canvas texture, drawn crisp (no smoothing between its pixels). */
function canvasTex(w, h, draw, nearest) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  return t;
}

// ---------- fatboy ----------
let FAT_FACE = null;
function fatFace() {
  return (FAT_FACE ||= canvasTex(256, 256, (g) => {
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#0a0a0c';
    // the eyes: round, staring, a black dot in each
    for (const x of [78, 178]) {
      g.beginPath(); g.arc(x, 78, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, 78, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0a0a0c'; g.beginPath(); g.arc(x + 2, 80, 9, 0, Math.PI * 2); g.fill();
    }
    // the grin: a wide black mouth full of square teeth
    g.fillRect(36, 142, 184, 86);
    g.fillStyle = '#f2f0ea';
    for (let i = 0; i < 7; i++) { g.fillRect(44 + i * 25.5, 150, 20, 30); g.fillRect(44 + i * 25.5, 190, 20, 30); }
  }));
}
export function fatboy(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  hideEyes(ch);
  for (const k of ['skin', 'top', 'shorts', 'shoe']) M[k].roughness = 0.78;
  boxBody(ch, { chest: M.top, belly: M.top, upper: M.skin, fore: M.skin, thigh: M.shorts, shin: M.shorts, foot: M.shoe }, 1.04);
  // the helmet: a black box round the whole head, a lip round the face opening, a ridge on top
  const helm = std(0x0b0c10, { roughness: 0.5, metalness: 0.15 });
  part(box(0.21, 0.24, 0.24), helm, F, [0, 0.01, 0.004]);
  part(box(0.22, 0.02, 0.2), helm, F, [0, 0.13, -0.004]);
  part(box(0.04, 0.03, 0.22), helm, F, [0, 0.145, -0.004]);
  for (const s of [1, -1]) part(box(0.03, 0.05, 0.05), helm, F, [s * 0.108, 0.02, 0.02]);
  // the face: a white panel set into it
  const faceM = new THREE.MeshStandardMaterial({ map: fatFace(), roughness: 0.6 });
  part(box(0.165, 0.16, 0.006), faceM, F, [0, -0.018, 0.125]);

  // the bomb: a huge black drum up over the head, on two thick posts off the back
  const bomb = new THREE.Group();
  C.add(bomb);
  ch.fatBomb = bomb;
  const black = std(0x101114, { roughness: 0.42, metalness: 0.2 });
  const kx = Math.pow(ch.shape.B, 0.55);
  const back = -prof(BACK, 0.45) * Math.pow(ch.shape.B, 0.7) * 1.08 - 0.06;
  for (const s of [1, -1]) {
    part(box(0.1, 0.66, 0.14), black, bomb, [s * 0.2 * kx, 0.5, back - 0.02]);
    part(box(0.14, 0.12, 0.16), black, bomb, [s * 0.2 * kx, 0.18, back - 0.02]);
  }
  const drum = new THREE.CylinderGeometry(0.19, 0.19, 0.62, 24);
  drum.rotateZ(Math.PI / 2);
  const by = 0.92, bz = back + 0.01;
  bomb.userData.core = part(drum, black, bomb, [0, by, bz]);
  const rim = new THREE.CylinderGeometry(0.195, 0.195, 0.03, 24);
  rim.rotateZ(Math.PI / 2);
  for (const s of [1, -1]) part(rim, black, bomb, [s * 0.29, by, bz]);
  // the fuse: out of one end, curling up, burning at the tip
  const fx = -0.31;
  const fuse = new THREE.CatmullRomCurve3([
    new THREE.Vector3(fx, by + 0.1, bz), new THREE.Vector3(fx - 0.07, by + 0.16, bz),
    new THREE.Vector3(fx - 0.17, by + 0.15, bz + 0.01), new THREE.Vector3(fx - 0.25, by + 0.1, bz + 0.02),
  ]);
  part(new THREE.TubeGeometry(fuse, 16, 0.009, 6, false), std(0x1a1512, { roughness: 0.9 }), bomb, [0, 0, 0]);
  const tip = fuse.getPoint(1);
  const ember = part(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }), bomb, [tip.x, tip.y, tip.z]);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffb050, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flame.position.copy(tip);
  flame.scale.setScalar(0.12);
  flame.userData.decal = true;
  bomb.add(flame);
  ch.tinyFace.push(ember);
  // (gone when it goes off, back on a respawn. Each part hidden on its own, as a worn-or-not
  // piece: a cut through the chest then leaves a spent bomb out of it - slice.js, wounds.js)
  bomb.traverse((o) => { if (o !== bomb) o.userData.wardrobe = true; });
  ch.setBomb = (on) => bomb.traverse((o) => { if (o !== bomb) o.visible = on; });

  // the fuse sputters
  const prev = ch.costumeTick;
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    const f = 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 17.3) + 0.15 * Math.sin(t * 7);
    flame.scale.setScalar(0.1 * f + 0.03);
    flame.material.opacity = Math.min(1, 0.6 + f * 0.4);
  };
}
let GLOW = null;
function glowTex() {
  return (GLOW ||= canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,230,1)'); r.addColorStop(0.25, 'rgba(255,190,80,0.9)'); r.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  }));
}
