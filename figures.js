import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { part, std, prof, FRONT, BACK } from './costumes.js';
import { withRim } from './rim.js';

/*
  Two more special bodies (special.js), built onto a Character like the rest of costumes.js:
    costume 'false'  : @false - a body of separate black pieces, each outlined in glowing red and
                       then white: a box head with a red "no" sign for a face, a box chest with a
                       red bar chart on it, beads down the upper arms growing toward the elbows,
                       a big square arch of a hand, bars for thighs and shins, round knees.
    costume 'figure' : The Figure (DOORS) - tall and thin, raw faceted orange-red flesh shading off
                       into blue-black at its edges (rim.js), no eyes: the whole face one round
                       mouth of teeth, lit orange from inside, and glowing ribs through the chest.
                       It bleeds its own flesh (ink 'figure', inks.js).
*/

const Y = (yh) => yh - 0.3; // hips space -> chest group
const hideEyes = (ch) => { for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; } };

// ---------- false ----------
// an outline: the back faces of the same mesh, pushed out a fixed width in view space
const HULLS = new Map();
function hullMat(color, w) {
  const key = color + ':' + w;
  if (HULLS.has(key)) return HULLS.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      mvPosition.xyz += normalize(normalMatrix * normal) * ${w.toFixed(4)};
      gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey = () => 'false-hull-' + w;
  HULLS.set(key, m);
  return m;
}
/** A black piece outlined red, then white (the outlines ride along as children: cut up with it). */
function piece(geo, parent, pos, rot, M) {
  const m = part(geo, M.core, parent, pos, rot);
  for (const h of [M.red, M.white]) {
    const o = new THREE.Mesh(geo, h);
    o.userData.decal = true;
    m.add(o);
  }
  return m;
}
const rbox = (w, h, d, r = 0.012) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const BALL = new THREE.SphereGeometry(1, 20, 14);
const ball = (r) => BALL.clone().scale(r, r, r);

export function falseBody(ch) {
  const F = ch.face, C = ch.chest, B = ch.shape.B;
  hideEyes(ch);
  const M = {
    core: std(0x060607, { roughness: 0.45 }),
    red: hullMat(0xff1414, 0.0075),
    white: hullMat(0xffffff, 0.0115),
  };
  const neon = new THREE.MeshBasicMaterial({ color: 0xff1a14 });
  // (the body under the pieces: a flat black nothing between them)
  for (const k of ['skin', 'top', 'shorts', 'shoe']) { ch.mat[k].roughness = 1; ch.mat[k].color.setHex(0x020203); }

  // the head: a box, and a red "no" sign on its face
  piece(rbox(0.21, 0.22, 0.21), F, [0, 0.012, 0.004], null, M);
  const sign = new THREE.Group();
  sign.position.set(0, 0.012, 0.111);
  F.add(sign);
  part(new THREE.TorusGeometry(0.068, 0.0085, 8, 40), neon, sign, [0, 0, 0]);
  part(new THREE.BoxGeometry(0.13, 0.014, 0.008), neon, sign, [0, 0, 0], [0, 0, Math.PI / 4]);

  // the chest: a tall box, a red bar chart on the front
  const kx = Math.pow(B, 0.55), kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7);
  const cf = prof(FRONT, 0.45) * kf + 0.016, cb = prof(BACK, 0.45) * kb + 0.016;
  piece(rbox(0.3 * kx, 0.36, cf + cb), C, [0, Y(0.43), (cf - cb) / 2], null, M);
  const bars = [[-0.05, 0.11], [0, 0.07], [0.05, 0.085]];
  for (const [x, h] of bars) part(new THREE.BoxGeometry(0.034, h, 0.008), neon, C, [x * kx, Y(0.33) + h / 2, cf + 0.001]);

  // the arms: beads, growing toward the elbows - and a big square arch of a hand
  // (sized off the build, not the thin limbs underneath: special.js gives it limb 0.62)
  const ka = ch.shape.arm / ch.shape.LW;
  for (const a of ch.arms) {
    piece(ball(0.042 * ka), a.upper, [0, -0.035, 0], null, M);
    piece(ball(0.05 * ka), a.upper, [0, -0.135, 0], null, M);
    piece(ball(0.058 * ka), a.upper, [0, -0.25, 0], null, M);
    piece(ball(0.066 * ka), a.fore, [0, -0.1, 0], null, M);
    // (the hand's own x is mirrored per side: the arch is the same shape both ways)
    const w = 0.19 * ka, t = 0.052 * ka, h = 0.19;
    piece(rbox(w, t, t * 1.05), a.hand, [0, -0.01, 0], null, M);
    for (const s of [1, -1]) piece(rbox(t, h, t * 1.05), a.hand, [s * (w - t) / 2, -0.01 - h / 2 + t / 2, 0], null, M);
  }
  // the legs: a bar for each thigh, a round knee, a bar of a shin flaring out into the foot
  const kl = ch.shape.leg / ch.shape.LW;
  for (const l of ch.legs) {
    piece(rbox(0.1 * kl, 0.34, 0.1 * kl), l.thigh, [0, -0.2, 0.004], null, M);
    piece(ball(0.066 * kl), l.shin, [0, -0.005, 0.01], null, M);
    piece(rbox(0.09 * kl, 0.33, 0.095 * kl), l.shin, [0, -0.23, 0.004], null, M);
    piece(rbox(0.1 * kl, 0.06, 0.22), l.foot, [0, -0.045, 0.05], null, M);
  }
}

// ---------- figure ----------
const FIG_RIM = 0x14254a;
/** A lumpy, faceted ball (vertices pushed in and out a little): chunks of the Figure's flesh. */
function lump(r, detail = 2, rough = 0.08, seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // (the same jitter at the same place, so the seams between triangles stay shut)
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 1 + (rnd() - 0.5) * 2 * rough);
    v.multiplyScalar(seen.get(k));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(r[0], r[1], r[2]);
  g.computeVertexNormals();
  return g;
}
let MOUTH = null;
function mouthTex() {
  if (MOUTH) return MOUTH;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  // a hot glowing throat, then rings of teeth pointing in toward it
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, '#fff2b0'); r.addColorStop(0.3, '#ffb040'); r.addColorStop(0.75, '#e5641a'); r.addColorStop(1, '#8a2a0c');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  for (const [n, r0, r1, col] of [[26, 124, 70, '#ffd9a0'], [20, 92, 44, '#ffe7b8'], [14, 60, 22, '#fff4d8']]) {
    for (let i = 0; i < n; i++) {
      const a = (i + (r0 % 2) * 0.5) / n * Math.PI * 2, da = Math.PI / n * 0.85;
      g.beginPath();
      g.moveTo(128 + Math.cos(a - da) * r0, 128 + Math.sin(a - da) * r0);
      g.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
      g.lineTo(128 + Math.cos(a + da) * r0, 128 + Math.sin(a + da) * r0);
      g.closePath();
      g.fillStyle = col; g.fill();
      g.strokeStyle = 'rgba(140,50,10,0.6)'; g.lineWidth = 1.5; g.stroke();
    }
  }
  MOUTH = new THREE.CanvasTexture(c);
  MOUTH.colorSpace = THREE.SRGBColorSpace;
  return MOUTH;
}
let GLOW = null;
function glowTex() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,220,140,1)'); r.addColorStop(0.3, 'rgba(255,140,40,0.55)'); r.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  GLOW = new THREE.CanvasTexture(c);
  return GLOW;
}

export function figure(ch) {
  const F = ch.face, C = ch.chest, B = ch.shape.B, Mt = ch.mat;
  hideEyes(ch);
  // the whole body: faceted raw flesh, shading off to blue-black at its edges
  for (const k of ['skin', 'top', 'shorts', 'shoe']) {
    const m = Mt[k];
    m.roughness = 0.78; m.metalness = 0; m.flatShading = true;
    withRim(m, FIG_RIM, 0.95);
    m.needsUpdate = true;
  }
  const flesh = Mt.skin;
  // the head: a lumpy round skull over the face
  part(lump([0.105, 0.112, 0.104], 2, 0.07, 7), flesh, F, [0, 0.012, -0.004]);
  // the mouth: the whole front of the head, a thick lip round a disc of teeth glowing from within
  const mouth = new THREE.Group();
  mouth.position.set(0, 0.0, 0.088);
  F.add(mouth);
  const lip = new THREE.TorusGeometry(0.074, 0.02, 8, 28);
  part(lip, flesh, mouth, [0, 0, 0.004]);
  const teeth = new THREE.MeshBasicMaterial({ map: mouthTex() });
  part(new THREE.CircleGeometry(0.076, 32), teeth, mouth, [0, 0, 0.006]);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffa050, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.position.set(0, 0, 0.04);
  glow.scale.setScalar(0.34);
  glow.userData.decal = true;
  mouth.add(glow);

  // ribs: glowing bars through the chest, either side of the breastbone
  const rib = new THREE.MeshStandardMaterial({ color: 0xffb048, emissive: 0xff8a2a, emissiveIntensity: 1.3, roughness: 0.6, flatShading: true });
  const kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  for (let i = 0; i < 4; i++) {
    const yh = 0.575 - i * 0.052, z = prof(FRONT, yh) * kf + 0.002;
    for (const s of [1, -1]) {
      const len = 0.085 - i * 0.006;
      part(lump([len / 2, 0.011, 0.012], 1, 0.12, 11 + i * 2 + (s > 0 ? 1 : 0)), rib, C, [s * (0.018 + len / 2) * kx, Y(yh), z - 0.004], [0, -s * 0.35, -s * 0.22]);
    }
  }
  // (the mouth breathes: the glow swells and flickers)
  const prev = ch.costumeTick;
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    const f = 0.85 + 0.1 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 13.1) * Math.sin(t * 7.3);
    glow.scale.setScalar(0.34 * f);
    glow.material.opacity = 0.75 + 0.25 * f;
  };
}
