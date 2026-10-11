import * as THREE from 'three';
import { blob, part, std, prof, FRONT, BACK, taperedTail, swayTail, hockeyMask } from './costumes.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
  More special looks (special.js), built onto a Character like the rest of costumes.js:
    costume 'seek'   : Seek (DOORS) - a tall figure of glossy black ink, one huge staring white
                       eye, ink dripping off it, red showing through here and there
    costume 'alien'  : a green alien - a long head, huge hypnotic swirling eyes, a ribbed beanie
                       (the hair colour: pick it in the wardrobe), a hoop and a cross for earrings,
                       a chain necklace with a cross. The clothes are the wearer's own.
    costume 'manager': a store manager - white short-sleeved shirt, tie, MANAGER name badge,
                       lanyard and key card, pen in the pocket, glasses, a belt
    costume 'slime'  : a glossy green slime - a soft dome of a head, closed eyes, a flat grin, blue
                       drool stretching off it, a little top hat with a red-white-red band, goo drips
    costume 'emoji'  : a guy in a sharp dark suit (white shirt, black tie, lapels, pocket square)
                       whose head is a big round yellow smiley emoji - two black oval eyes, a smile
    costume 'jason'  : Jason Voorhees - the old yellowed hockey mask with its red chevrons, rows of
                       holes and straps, a lumpy bald scalp with a few wisps of hair, a worn olive
                       work jacket open over a dark shirt, grey work trousers into brown boots
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const Y = (yh) => yh - 0.3; // hips space -> chest group
const shapeK = (ch) => {
  const B = ch.shape.B;
  return { kf: Math.pow(B, 0.8), kx: Math.pow(B, 0.55), front: (yh) => prof(FRONT, yh) * Math.pow(B, 0.8) };
};

// ---------- seek ----------
export function seek(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const { kx, front } = shapeK(ch);
  // wet, glossy black ink all over
  for (const k of ['skin', 'top', 'shorts', 'shoe', 'hair']) { M[k].roughness = 0.22; M[k].metalness = 0.1; }
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  // a lumpier, slightly bigger head
  blob(M.skin, [0, 0.03, -0.006], [0.09, 0.11, 0.1], F);
  blob(M.skin, [0.02, 0.075, -0.02], [0.06, 0.05, 0.07], F);
  // the eye: huge, white, lit a little from inside, a black pupil staring out
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f0ea, emissiveIntensity: 0.55, roughness: 0.2 });
  const black = std(0x020202, { roughness: 0.1 });
  const rim = std(0x050304, { roughness: 0.3 });
  blob(rim, [0, 0.03, 0.094], [0.05, 0.036, 0.018], F);
  const eye = blob(white, [0, 0.03, 0.103], [0.042, 0.03, 0.014], F);
  const pupil = blob(black, [0, 0.03, 0.115], [0.014, 0.014, 0.004], F);
  // ink dripping: off the chin, the chest, the arms and legs - each slowly stretching and letting go
  const ink = new THREE.MeshStandardMaterial({ color: 0x050405, roughness: 0.15, metalness: 0.1 });
  const drip = new THREE.ConeGeometry(1, 1, 8);
  drip.rotateX(Math.PI);
  drip.translate(0, -0.5, 0); // (tip down, the base at the top: y 0)
  const drips = [];
  const addDrip = (parent, pos, len, r) => {
    const d = part(drip, ink, parent, pos);
    d.scale.set(r, len, r);
    drips.push({ m: d, len, t: Math.random() * 10, sp: rnd(0.3, 0.8) });
    ch.detail.push(d);
  };
  for (let i = 0; i < 5; i++) addDrip(F, [rnd(-0.04, 0.04), -0.1, rnd(0.03, 0.07)], rnd(0.02, 0.05), rnd(0.005, 0.009));
  for (let i = 0; i < 7; i++) {
    const yh = rnd(0.25, 0.55), x = rnd(-0.1, 0.1) * kx;
    addDrip(C, [x, Y(yh), front(yh) + 0.004], rnd(0.03, 0.08), rnd(0.005, 0.01));
  }
  for (const a of ch.arms) for (let i = 0; i < 2; i++) addDrip(a.fore, [0, rnd(-0.2, -0.08), rnd(-0.03, 0.03)], rnd(0.03, 0.06), 0.006);
  for (const l of ch.legs) for (let i = 0; i < 2; i++) addDrip(l.shin, [rnd(-0.03, 0.03), rnd(-0.3, -0.1), 0.05], rnd(0.03, 0.07), 0.007);
  // red showing through the ink - on the chest, below the eye, down one leg
  const red = new THREE.MeshStandardMaterial({ color: 0x6a0306, emissive: 0x3a0002, roughness: 0.35 });
  const reds = [];
  for (let i = 0; i < 6; i++) {
    const yh = rnd(0.3, 0.58);
    reds.push(blob(red, [rnd(-0.08, 0.08) * kx, Y(yh), front(yh) + 0.002], [rnd(0.008, 0.02), rnd(0.005, 0.014), 0.004], C, [0, 0, rnd(-1, 1)]));
  }
  reds.push(blob(red, [0.01, -0.03, 0.094], [0.02, 0.008, 0.005], F));
  for (let i = 0; i < 4; i++) reds.push(blob(red, [rnd(-0.03, 0.03), rnd(-0.3, -0.05), 0.058], [0.008, rnd(0.01, 0.02), 0.004], ch.legs[1].shin));
  ch.detail.push(...reds);

  // the eye darts about and blinks now and then; the drips stretch, and fall
  const prev = ch.costumeTick;
  let lookT = 0, blink = 0, blinkT = rnd(2, 6);
  const px = V(), goal = V();
  ch.costumeTick = (dt) => {
    prev?.(dt);
    lookT -= dt;
    if (lookT <= 0) { lookT = rnd(0.4, 2.5); goal.set(rnd(-0.018, 0.018), rnd(-0.01, 0.01), 0); }
    px.lerp(goal, Math.min(1, dt * 14));
    pupil.position.set(px.x, 0.03 + px.y, 0.115);
    blinkT -= dt;
    if (blinkT <= 0) { blinkT = rnd(2.5, 7); blink = 0.16; }
    blink = Math.max(0, blink - dt);
    const lid = blink > 0 ? Math.abs(Math.sin((blink / 0.16) * Math.PI)) : 0;
    eye.scale.y = 0.03 * (1 - lid * 0.92);
    pupil.scale.y = 0.014 * (1 - lid * 0.95);
    for (const d of drips) {
      d.t += dt * d.sp;
      const u = d.t % 1;
      // it stretches out, then snaps back as the drop lets go
      d.m.scale.y = d.len * (0.5 + u * 0.9);
    }
  };
}

// ---------- alien ----------
let SWIRL = null;
function swirlTex() {
  if (SWIRL) return SWIRL;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b8f03a';
  g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(230,255,120,0.9)'); grd.addColorStop(1, 'rgba(90,170,20,0.6)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  // the black spiral
  g.strokeStyle = '#050805';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  for (let a = 0; a < Math.PI * 7; a += 0.05) {
    const r = 3 + a * 2.6;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 61, 0, Math.PI * 2); g.stroke();
  SWIRL = new THREE.CanvasTexture(c);
  SWIRL.colorSpace = THREE.SRGBColorSpace;
  return SWIRL;
}

export function alien(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const { kx, front } = shapeK(ch);
  // a long head: taller, a narrow jaw drawn down to a chin
  F.scale.set(0.95, 1.16, 1.02);
  blob(M.skin, [0, -0.075, 0.035], [0.045, 0.05, 0.055], F);
  blob(std(0x3e8a22, { roughness: 0.6 }), [0, -0.06, 0.088], [0.016, 0.004, 0.006], F); // (a small mouth)
  // the eyes: huge discs with a swirling spiral, turning slowly the whole time
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  const swirlMat = new THREE.MeshStandardMaterial({ map: swirlTex(), emissiveMap: swirlTex(), emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.3 });
  const eyes = [];
  for (const s of [1, -1]) {
    const socket = blob(std(0x0a0f08, { roughness: 0.5 }), [s * 0.041, 0.02, 0.082], [0.039, 0.032, 0.016], F, [0, s * 0.4, 0.15 * s]);
    void socket;
    const piv = new THREE.Group();
    piv.position.set(s * 0.041, 0.02, 0.096);
    piv.rotation.set(0, s * 0.4, 0.15 * s);
    F.add(piv);
    const d = part(new THREE.CircleGeometry(0.034, 32), swirlMat, piv, [0, 0, 0]);
    d.scale.y = 0.88;
    eyes.push({ d, dir: s, sp: rnd(1.4, 2.2) });
    ch.tinyFace.push(d);
  }
  // the beanie: ribbed, turned up at the cuff - its colour is the hair colour
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.hair);
  cap.scale.set(0.094, 0.1, 0.108);
  cap.position.set(0, 0.035, -0.006);
  cap.rotation.x = -0.12;
  F.add(cap);
  const cuff = part(new THREE.TorusGeometry(0.094, 0.016, 8, 32), M.hair, F, [0, 0.038, -0.006], [Math.PI / 2 - 0.12, 0, 0]);
  cuff.scale.set(1, 1.14, 1);
  // jewellery: a silver hoop on one ear, a cross hanging off the other, a chain with a cross
  const silver = new THREE.MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.22, metalness: 1, envMapIntensity: 1 });
  const bits = [];
  bits.push(part(new THREE.TorusGeometry(0.012, 0.0022, 6, 18), silver, F, [0.08, -0.03, -0.006], [0, Math.PI / 2, 0]));
  const hang = new THREE.Group();
  hang.position.set(-0.08, -0.018, -0.006);
  F.add(hang);
  bits.push(part(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03, 4), silver, hang, [0, -0.015, 0]));
  bits.push(part(new THREE.BoxGeometry(0.004, 0.028, 0.003), silver, hang, [0, -0.043, 0]));
  bits.push(part(new THREE.BoxGeometry(0.016, 0.004, 0.003), silver, hang, [0, -0.037, 0]));
  // the necklace: chunky links round the base of the neck, a cross hanging on the chest
  const link = new THREE.TorusGeometry(0.006, 0.0018, 5, 10);
  const R = 0.076;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const x = Math.sin(a) * R * 1.05 * kx, z = Math.cos(a) * R * 0.95;
    const y = 0.235 - (Math.cos(a) * 0.5 + 0.5) * 0.045;
    bits.push(part(link, silver, C, [x, y, z + 0.005], [0, a + (i % 2) * Math.PI / 2, 0]));
  }
  const yc = 0.46;
  bits.push(part(new THREE.BoxGeometry(0.008, 0.05, 0.004), silver, C, [0, Y(yc), front(yc) + 0.006]));
  bits.push(part(new THREE.BoxGeometry(0.03, 0.008, 0.004), silver, C, [0, Y(yc) + 0.01, front(yc) + 0.006]));
  ch.detail.push(...bits);

  const prev = ch.costumeTick;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    for (const e of eyes) e.d.rotation.z += dt * e.sp * e.dir;
    hang.rotation.z = Math.sin(performance.now() * 0.002) * 0.15;
  };
}

// ---------- the store manager ----------
function badgeTex() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#c41e2a'; g.fillRect(0, 0, 128, 14);
  g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
  g.fillText('HELLO MY NAME IS', 64, 11);
  g.fillStyle = '#111'; g.font = 'bold 20px sans-serif';
  g.fillText('MANAGER', 64, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function manager(ch) {
  const F = ch.face, C = ch.chest, M = ch.mat;
  const { kx, front } = shapeK(ch);
  const white = std(0xf6f6f2, { roughness: 0.7 });
  const tie = std(0x1c2c5e, { roughness: 0.5 }), stripe = std(0xb89a2e, { roughness: 0.5 });
  // collar and tie (with a stripe or two), a clip
  for (const s of [1, -1]) blob(white, [s * 0.024, Y(0.556), front(0.556) - 0.002], [0.028, 0.014, 0.012], C, [-0.4, 0, s * 0.55]);
  blob(tie, [0, Y(0.538), front(0.538) + 0.005], [0.013, 0.011, 0.009], C);
  blob(tie, [0, Y(0.45), front(0.45) + 0.006], [0.017, 0.08, 0.005], C, [-0.08, 0, 0]);
  for (const y of [0.49, 0.44, 0.39]) blob(stripe, [0, Y(y), front(y) + 0.011], [0.016, 0.003, 0.002], C, [0, 0, 0.5]);
  part(new THREE.BoxGeometry(0.035, 0.004, 0.004), std(0xc9ccd0, { metalness: 1, roughness: 0.3 }), C, [0, Y(0.47), front(0.47) + 0.013]);
  // shirt buttons and a breast pocket with a pen in it
  for (const y of [0.52, 0.34, 0.26]) blob(white, [0.002, Y(y), front(y) + 0.003], [0.004, 0.004, 0.002], C);
  const px = 0.06 * kx;
  part(new THREE.BoxGeometry(0.05, 0.05, 0.004), white, C, [px, Y(0.47), front(0.47) + 0.004]);
  part(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 8), std(0x1a1a1a, { roughness: 0.3 }), C, [px + 0.012, Y(0.49), front(0.49) + 0.007]);
  // the name badge
  const badge = new THREE.MeshStandardMaterial({ map: badgeTex(), roughness: 0.4 });
  part(new THREE.BoxGeometry(0.075, 0.028, 0.003), badge, C, [-0.065 * kx, Y(0.47), front(0.47) + 0.006], [-0.05, 0, 0]);
  // lanyard and key card
  const lan = std(0xc41e2a, { roughness: 0.8 });
  for (const s of [1, -1]) part(new THREE.BoxGeometry(0.008, 0.2, 0.003), lan, C, [s * 0.03, Y(0.49), front(0.49) + 0.008], [-0.1, 0, s * 0.18]);
  part(new THREE.BoxGeometry(0.045, 0.06, 0.003), std(0xf2f2f2, { roughness: 0.4 }), C, [0, Y(0.37), front(0.37) + 0.012]);
  part(new THREE.BoxGeometry(0.035, 0.012, 0.004), lan, C, [0, Y(0.385), front(0.385) + 0.013]);
  // belt and buckle
  blob(std(0x2a1c12, { roughness: 0.5 }), [0, 0.11, 0.004], [0.145 * kx, 0.013, 0.1], ch.hips);
  part(new THREE.BoxGeometry(0.026, 0.02, 0.006), std(0xc9ccd0, { metalness: 1, roughness: 0.3 }), ch.hips, [0, 0.11, 0.1]);
  // glasses
  const frame = std(0x1a1a1a, { roughness: 0.35 });
  for (const s of [1, -1]) {
    const r = part(new THREE.TorusGeometry(0.016, 0.0022, 6, 20), frame, F, [s * 0.03, 0.012, 0.104], [0, s * 0.2, 0]);
    r.scale.y = 0.8;
    part(new THREE.BoxGeometry(0.003, 0.003, 0.09), frame, F, [s * 0.071, 0.015, 0.058], [0, s * 0.06, 0]);
  }
  part(new THREE.BoxGeometry(0.018, 0.003, 0.003), frame, F, [0, 0.016, 0.108]);
  void M;
}

// ---------- slime: a glossy green slime in a little top hat, drooling ----------
export function slime(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const { kx, front } = shapeK(ch);
  // wet, shiny goo all over, lit a little from inside
  for (const k of ['skin', 'top', 'shorts', 'shoe', 'hair']) {
    M[k].roughness = 0.14;
    M[k].emissive?.setHex(0x0a2a1a);
  }
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  // the head: a soft dome of slime, slumping out wider at the bottom
  blob(M.skin, [0, 0.004, 0.005], [0.105, 0.12, 0.125], F);
  blob(M.skin, [0, -0.07, 0.004], [0.112, 0.06, 0.118], F);
  // the face: two flat closed eyes (a tick down at the outer end), a wide flat grin
  const black = std(0x050505, { roughness: 0.4 });
  const bar = new THREE.CapsuleGeometry(0.0045, 0.028, 3, 8);
  bar.rotateZ(Math.PI / 2);
  const face = [];
  for (const s of [1, -1]) {
    face.push(part(bar, black, F, [s * 0.034, 0.028, 0.121], [0, s * 0.28, 0]));
    const tick = part(new THREE.CapsuleGeometry(0.0042, 0.01, 3, 8), black, F, [s * 0.053, 0.017, 0.113], [0, s * 0.45, s * 0.5]);
    face.push(tick);
  }
  const grin = new THREE.CapsuleGeometry(0.0048, 0.07, 3, 8);
  grin.rotateZ(Math.PI / 2);
  face.push(part(grin, black, F, [0, -0.012, 0.128]));
  for (const s of [1, -1]) face.push(part(new THREE.CapsuleGeometry(0.0045, 0.01, 3, 8), black, F, [s * 0.043, -0.006, 0.122], [0, s * 0.35, s * 0.6]));
  ch.detail.push(...face);
  ch.tinyFace.push(...face);
  // drool: a blue string off one corner of the grin, a drop gathering on the end
  const droolM = new THREE.MeshStandardMaterial({ color: 0x5fcde4, roughness: 0.08, emissive: 0x0e3a48, emissiveIntensity: 0.5 });
  const drip = new THREE.CylinderGeometry(0.0045, 0.0032, 1, 8);
  drip.translate(0, -0.5, 0);
  const string = part(drip, droolM, F, [-0.024, -0.016, 0.126]);
  const drop = blob(droolM, [-0.024, -0.05, 0.126], [0.0065, 0.0085, 0.0065], F);
  ch.detail.push(string, drop);
  // the top hat: a brim, a tall crown, a red-white-red band, cocked a little
  const hat = new THREE.Group();
  hat.position.set(0.012, 0.118, -0.004);
  hat.rotation.set(-0.08, 0, -0.14);
  F.add(hat);
  const felt = std(0x0b0b0d, { roughness: 0.55 });
  part(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 28), felt, hat, [0, 0.004, 0]);
  part(new THREE.CylinderGeometry(0.047, 0.05, 0.085, 28), felt, hat, [0, 0.05, 0]);
  const band = new THREE.MeshStandardMaterial({ map: bandTex(), roughness: 0.6 });
  part(new THREE.CylinderGeometry(0.0508, 0.0508, 0.02, 28, 1, true), band, hat, [0, 0.019, 0]);
  // goo: a few drips hanging off the chin, the chest, the hands
  const goo = new THREE.ConeGeometry(1, 1, 8);
  goo.rotateX(Math.PI);
  goo.translate(0, -0.5, 0);
  const drips = [];
  const add = (parent, pos, len, r) => { const d = part(goo, M.skin, parent, pos); d.scale.set(r, len, r); drips.push({ m: d, len, t: Math.random() * 10, sp: rnd(0.2, 0.5) }); ch.detail.push(d); };
  for (let i = 0; i < 4; i++) add(F, [rnd(-0.07, 0.07), -0.118, rnd(-0.02, 0.07)], rnd(0.015, 0.035), rnd(0.008, 0.012));
  for (let i = 0; i < 5; i++) { const yh = rnd(0.25, 0.5); add(C, [rnd(-0.1, 0.1) * kx, Y(yh), front(yh) - 0.002], rnd(0.02, 0.05), rnd(0.007, 0.011)); }
  for (const a of ch.arms) add(a.hand, [0, -0.07, 0], rnd(0.02, 0.04), 0.008);

  // the drool stretches, gathers and lets go; the goo drips slowly
  const prev = ch.costumeTick;
  let dt0 = Math.random();
  ch.costumeTick = (dt) => {
    prev?.(dt);
    dt0 += dt * 0.45;
    const u = dt0 % 1, len = 0.012 + u * 0.05;
    string.scale.set(1, len, 1);
    drop.position.y = -0.016 - len;
    drop.scale.set(0.0055 + u * 0.003, 0.007 + u * 0.004, 0.0055 + u * 0.003);
    string.updateMatrix(); drop.updateMatrix();
    for (const d of drips) {
      d.t += dt * d.sp;
      d.m.scale.y = d.len * (0.6 + (d.t % 1) * 0.7);
      d.m.updateMatrix();
    }
  };
}
let BAND = null;
function bandTex() {
  if (BAND) return BAND;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  // (round the crown: dark red, white, bright red, twice)
  for (let i = 0; i < 2; i++) {
    g.fillStyle = '#a82c2c'; g.fillRect(i * 64, 0, 20, 16);
    g.fillStyle = '#ffffff'; g.fillRect(i * 64 + 20, 0, 24, 16);
    g.fillStyle = '#e80707'; g.fillRect(i * 64 + 44, 0, 20, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (BAND = t);
}

// ---------- the emoji guy: a dark suit, and a smiley emoji for a head ----------
export function emoji(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const { kx, front } = shapeK(ch);
  // the head: one big glossy yellow ball (the skin - so it still takes every wound)
  M.skin.roughness = 0.32;
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  const R = 0.126, c = [0, 0.004, 0.006];
  blob(M.skin, c, [R, R, R], F);
  const onBall = (x, y, lift = 0) => [x, y, c[2] + Math.sqrt(Math.max(0, (R + lift) ** 2 - x * x - (y - c[1]) ** 2))];
  // the face: two tall black ovals and a wide smile
  const ink = std(0x3a2410, { roughness: 0.45 });
  const face = [];
  for (const s of [1, -1]) {
    const e = blob(ink, onBall(s * 0.04, 0.034, -0.002), [0.0135, 0.025, 0.006], F);
    // (flat against the ball: facing straight out from its centre)
    e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), e.position.clone().sub(new THREE.Vector3(...c)).normalize());
    face.push(e);
  }
  const arc = 0.68 * Math.PI;
  const smile = new THREE.TorusGeometry(0.058, 0.0058, 8, 28, arc);
  smile.rotateZ(-Math.PI / 2 - arc / 2);
  // (bend it round the ball, so it sits on the face all the way to its corners)
  const P = smile.attributes.position, cy = 0.018;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i) + cy, z = P.getZ(i);
    P.setZ(i, onBall(x, y, 0.001)[2] + z);
    P.setY(i, y);
  }
  smile.computeVertexNormals();
  face.push(part(smile, ink, F, [0, 0, 0]));
  ch.detail.push(...face);
  ch.tinyFace.push(...face);
  // the suit: the white shirt in the jacket's V, its collar, a black tie, lapels, two buttons,
  // a white pocket square
  const white = std(0xf4f2ec, { roughness: 0.7 }), black = std(0x0b0b0d, { roughness: 0.45 });
  const lapel = M.top.clone();
  lapel.color.multiplyScalar(0.6);
  blob(white, [0, Y(0.5), front(0.5) - 0.004], [0.036, 0.06, 0.012], C, [-0.2, 0, 0]);
  for (const s of [1, -1]) blob(white, [s * 0.02, Y(0.552), front(0.552) - 0.004], [0.026, 0.014, 0.012], C, [-0.4, 0, s * 0.55]);
  blob(black, [0, Y(0.536), front(0.536) + 0.005], [0.013, 0.011, 0.009], C);
  blob(black, [0, Y(0.46), front(0.46) + 0.006], [0.016, 0.072, 0.005], C, [-0.1, 0, 0]);
  for (const s of [1, -1]) blob(lapel, [s * 0.042 * kx, Y(0.49), front(0.49) + 0.002], [0.018, 0.075, 0.007], C, [-0.15, 0, s * 0.35]);
  for (const y of [0.4, 0.34]) blob(black, [0, Y(y), front(y) + 0.004], [0.006, 0.006, 0.004], C);
  blob(white, [0.07 * kx, Y(0.5), front(0.5) + 0.003], [0.016, 0.009, 0.005], C, [0, 0, 0.2]);
  // white shirt cuffs peeking out of the sleeves
  for (const a of ch.arms) part(new THREE.CylinderGeometry(0.036, 0.036, 0.018, 14), white, a.hand, [0, 0.05, 0]);
}

// ---------- the raccoon: an anthro raccoon - grey fur, the black bandit mask round red eyes,
// a white muzzle and brows, rounded ears, dark paws and a big bushy ringed tail ----------
export function raccoon(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const { kx, front } = shapeK(ch);
  const mask = std(0x17161a, { roughness: 0.9 }), white = std(0xeeeae4, { roughness: 0.9 }), dark = std(0x2a282c, { roughness: 0.85 });
  M.skin.roughness = 0.95;
  // red eyes: red irises, a black pupil in each, a glint
  M.iris.color.setHex(0xd4141c);
  M.iris.emissive?.setHex(0x3a0204);
  const pupil = std(0x050505, { roughness: 0.3 }), shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const e of ch.eyes) {
    // (a touch bigger and further out: bright in the dark of the mask)
    e.eye.scale.setScalar(0.0135);
    e.eye.position.z += 0.005;
    e.iris.position.z += 0.0065;
    e.iris.scale.set(0.0082, 0.0082, 0.0025);
    const p = blob(pupil, [e.side * 0.029, 0.01, 0.1025], [0.0032, 0.0036, 0.0012], F);
    const g = blob(shine, [e.side * 0.029 + 0.003, 0.014, 0.1035], [0.0018, 0.0018, 0.0008], F);
    ch.detail.push(p, g); ch.tinyFace.push(p, g);
    e.brow.material = white; // (the pale brows over the mask)
    e.brow.position.y += 0.008;
  }
  // the bandit mask: a black band across the eyes, sweeping down and back at the sides
  // (flat against the face, just under the eyes' surface: they show through it)
  for (const s of [1, -1]) {
    blob(mask, [s * 0.031, 0.008, 0.076], [0.031, 0.022, 0.02], F, [0, s * 0.35, s * -0.2]);
    blob(mask, [s * 0.05, -0.004, 0.06], [0.022, 0.018, 0.022], F, [0, s * 0.75, s * -0.4]);
  }
  blob(mask, [0, 0.012, 0.084], [0.011, 0.01, 0.008], F); // (the bridge between the eyes)
  // a white face below and above the mask, and the pointed muzzle with a black nose
  blob(white, [0, -0.036, 0.08], [0.05, 0.03, 0.04], F);
  const sn = part(new THREE.ConeGeometry(0.03, 0.06, 18), white, F, [0, -0.03, 0.125], [Math.PI / 2, 0, 0]);
  sn.scale.set(1, 1, 0.8);
  blob(std(0x0c0b0d, { roughness: 0.3 }), [0, -0.026, 0.156], [0.011, 0.009, 0.009], F);
  blob(dark, [0, -0.046, 0.124], [0.012, 0.0025, 0.004], F); // (the mouth line)
  // whiskers
  const wm = std(0xd8d4ce, { roughness: 0.5 }), wg = new THREE.CylinderGeometry(0.0007, 0.0004, 0.07, 4);
  const whiskers = [];
  for (const s of [1, -1]) for (const a of [0.12, 0, -0.12]) whiskers.push(part(wg, wm, F, [s * 0.045, -0.032 + a * 0.05, 0.128], [0, -s * 0.5, Math.PI / 2 + s * a]));
  ch.detail.push(...whiskers);
  // cheek ruffs: fluffy white tufts out to the sides
  for (const s of [1, -1]) {
    const t = part(new THREE.ConeGeometry(0.016, 0.032, 10), white, F, [s * 0.072, -0.045, 0.035], [0, 0, s * 2.3]);
    t.scale.z = 0.6;
  }
  // rounded ears, dark-rimmed, pale inside
  for (const s of [1, -1]) {
    const ear = part(new THREE.ConeGeometry(0.036, 0.06, 16), M.skin, F, [s * 0.058, 0.1, -0.02], [-0.1, 0, -s * 0.35]);
    ear.scale.z = 0.5;
    // (a dark back to each)
    const back = part(new THREE.ConeGeometry(0.034, 0.056, 16), mask, F, [s * 0.058, 0.099, -0.026], [-0.1, 0, -s * 0.35]);
    back.scale.z = 0.35;
    const inn = part(new THREE.ConeGeometry(0.022, 0.04, 12), white, F, [s * 0.057, 0.098, -0.011], [-0.1, 0, -s * 0.35]);
    inn.scale.z = 0.35;
  }
  // a paler chest and belly
  blob(std(0xa6a3a2, { roughness: 0.95 }), [0, Y(0.36), front(0.36) - 0.01], [0.11 * kx, 0.16, 0.04], C);
  // dark paws: black hands and feet
  for (const a of ch.arms) a.hand.traverse((o) => { if (o.isMesh && o.material === M.skin) o.material = dark; });
  // the big bushy tail: thick, ringed grey and black, swinging behind
  const tex = ringTex();
  const tailM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const { mesh, curve } = taperedTail([V(0, -0.02, -0.09), V(0, -0.1, -0.2), V(0, -0.14, -0.33), V(0.02, -0.1, -0.46), V(0.04, 0.0, -0.55)], 0.045, 0.036, tailM, 48);
  const tip = curve.getPointAt(1);
  swayTail(ch, mesh, [blob(mask, [tip.x, tip.y, tip.z], [0.037, 0.037, 0.037], mesh)]);
}
let RINGS = null;
function ringTex() {
  if (RINGS) return RINGS;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const g = c.getContext('2d');
  // (along the tail: the texture's u) grey, a black ring, grey, a black ring... five of them
  g.fillStyle = '#8c8a8c'; g.fillRect(0, 0, 256, 16);
  g.fillStyle = '#1a191c';
  for (let i = 0; i < 5; i++) g.fillRect(28 + i * 46, 0, 20, 16);
  RINGS = new THREE.CanvasTexture(c);
  RINGS.colorSpace = THREE.SRGBColorSpace;
  return RINGS;
}

// ---------- jason ----------
export function jason(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest, B = ch.shape.B;
  const { kx, front } = shapeK(ch);
  const back = (yh) => prof(BACK, yh) * Math.pow(B, 0.7);
  const Y = (yh) => yh - 0.3;
  hockeyMask(ch, true);
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; }
  // the scalp behind the mask: lumpy, bald, a few thin wisps of dark hair
  M.skin.roughness = 0.8;
  for (const [x, y, z, r] of [[0.03, 0.09, -0.04, 0.03], [-0.045, 0.07, -0.06, 0.028], [0.01, 0.06, -0.085, 0.034], [-0.02, 0.1, -0.02, 0.022]]) {
    blob(M.skin, [x, y, z], [r, r * 0.55, r], F);
  }
  const wisp = std(0x2a2118, { roughness: 0.95 });
  for (const [x, y, z, rx, rz] of [[-0.05, 0.075, -0.035, 0.5, 0.6], [0.06, 0.05, -0.05, 0.3, -0.8], [0.02, 0.08, -0.075, 1.0, -0.3], [-0.035, 0.035, -0.09, 1.3, 0.4]]) {
    blob(wisp, [x, y, z], [0.012, 0.022, 0.006], F, [rx, 0, rz]);
  }

  // the work jacket (the body's shirt): a turned-down collar, open down the front over a dark shirt,
  // two flapped chest pockets
  const jacket = M.top, shirt = std(0x3b3833, { roughness: 0.95 });
  M.top.roughness = 0.97; M.shorts.roughness = 0.95;
  blob(shirt, [0, Y(0.46), front(0.46) - 0.002], [0.05 * kx, 0.11, 0.008], C);
  for (const s of [1, -1]) {
    // collar points and lapel edges
    blob(jacket, [s * 0.04 * kx, Y(0.575), front(0.575) + 0.004], [0.036, 0.016, 0.014], C, [0.35, 0, s * 0.5]);
    blob(jacket, [s * 0.04 * kx, Y(0.44), front(0.44) + 0.005], [0.012, 0.12, 0.007], C, [0, 0, -s * 0.08]);
    part(new RoundedBoxGeometry(0.06, 0.058, 0.012, 2, 0.004), jacket, C, [s * 0.085 * kx, Y(0.47), front(0.47) + 0.006], [-0.05, s * 0.18, 0]);
    part(new RoundedBoxGeometry(0.064, 0.018, 0.016, 2, 0.004), jacket, C, [s * 0.085 * kx, Y(0.505), front(0.505) + 0.01], [-0.05, s * 0.18, 0]);
  }
  blob(jacket, [0, Y(0.585), -back(0.585) + 0.004], [0.075 * kx, 0.018, 0.02], C, [-0.3, 0, 0]);
  // work boots: trousers tucked into tall laced shafts
  const boot = M.shoe;
  boot.roughness = 0.7;
  const kl = ch.shape.leg;
  for (const l of ch.legs) {
    part(new THREE.CylinderGeometry(0.052 * kl, 0.048 * kl, 0.13, 14), boot, l.shin, [0, -0.36, 0.004]);
    blob(boot, [0, -0.3, 0.006], [0.056 * kl, 0.012, 0.054 * kl], l.shin);
  }
}

// ---------- dracula ----------
// the Count: deathly pale, black hair slicked back to a widow's peak, red eyes, fangs; a black
// suit over a white shirt, a red medallion on a ribbon. (The cape is off for now.)
export function dracula(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest, B = ch.shape.B;
  const { kx, front } = shapeK(ch);
  const back = (yh) => prof(BACK, yh) * Math.pow(B, 0.7);
  const Y = (yh) => yh - 0.3;
  M.skin.roughness = 0.5;
  M.iris.color.setHex(0xb0101a);
  M.iris.emissive?.setHex(0x3a0306);
  // the widow's peak, and the hair swept back flat
  blob(M.hair, [0, 0.07, 0.07], [0.014, 0.014, 0.006], F, [0.9, 0, Math.PI / 4]);
  // fangs
  const tooth = std(0xf8f6f0, { roughness: 0.25 });
  for (const s of [1, -1]) {
    const f = part(new THREE.ConeGeometry(0.0028, 0.011, 6), tooth, F, [s * 0.009, -0.047, 0.094], [Math.PI, 0, 0]);
    ch.detail.push(f);
  }
  // shirt front, bow at the throat, the medallion
  const white = std(0xf1efe8, { roughness: 0.7 }), red = std(0x8a0d16, { roughness: 0.45 });
  const gold = std(0xd6a640, { roughness: 0.3, metalness: 0.9 });
  blob(white, [0, Y(0.5), front(0.5) - 0.002], [0.036 * kx, 0.07, 0.007], C);
  blob(std(0x0b0b0c, { roughness: 0.5 }), [0, Y(0.558), front(0.558) + 0.006], [0.02, 0.009, 0.008], C);
  for (const s of [1, -1]) part(new THREE.CylinderGeometry(0.0035, 0.0035, 0.1, 6), red, C, [s * 0.03 * kx, Y(0.51), front(0.51) + 0.007], [-0.12, 0, s * 0.5]);
  part(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20), gold, C, [0, Y(0.465), front(0.465) + 0.008], [Math.PI / 2, 0, 0]);
  part(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16), red, C, [0, Y(0.465), front(0.465) + 0.011], [Math.PI / 2, 0, 0]);
}

// ---------- gcap: a red ball cap, and a big red G on the front of a black shirt ----------
function gTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d0141c'; g.font = '900 118px Arial Black, Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('G', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function gcap(ch) {
  const F = ch.face, C = ch.chest;
  const { front } = shapeK(ch);
  const capM = std(0xc3141b, { roughness: 0.75 });
  // the cap: a crown over the head, the brim out front, a button on top
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), capM);
  crown.scale.set(0.094, 0.094, 0.114);
  crown.position.set(0, 0.03, -0.004);
  crown.rotation.x = -0.08;
  F.add(crown);
  const brim = part(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, -Math.PI / 2, Math.PI), capM, F, [0, 0.036, 0.075], [0.16, 0, 0]);
  brim.scale.set(0.088, 0.006, 0.07);
  const btn = blob(capM, [0, 0.122, -0.012], [0.01, 0.006, 0.01], F);
  ch.detail.push(btn);
  // the G, printed on the chest
  const gM = new THREE.MeshStandardMaterial({ map: gTex(), transparent: true, alphaTest: 0.3, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  part(new THREE.PlaneGeometry(0.13, 0.13), gM, C, [0, Y(0.46), front(0.46) + 0.006], [-0.08, 0, 0]);
}
