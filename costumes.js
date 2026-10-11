import * as THREE from 'three';
import { spider } from './spider.js';
import { threefold } from './threefold.js';
import { seek, alien, manager, slime, emoji, raccoon, jason, dracula, gcap } from './looks2.js';
import { fatboy, boxBody } from './blocky.js';
import { bee } from './bee.js';
import { falseBody, figure } from './figures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tube } from './shapes.js';
import { psyTick } from './psy.js';

/*
  Extra body parts for special looks (special.js), built onto a Character before it's
  finished (so they're part of its meshes: stained, sliced, hidden far away like the rest):
    costume 'suit'   : white collar and red tie, a tactical vest, a white hockey mask
    costume 'hoodie' : the hood down behind the neck, a front pocket, drawstrings (the top's colour)
    costume 'baldi'  : one curly hair on a bald head, wide staring eyes, a big thin smile
    costume 'flowery': closed happy eyes, a smile, spiky yellow hair, green shirt / orange sleeves, white collar, black bow
    costume 'seek' / 'alien' / 'manager': see looks2.js
    costume 'fatboy': a boxy body, see blocky.js      costume 'slime' / 'emoji': see looks2.js
    costume 'mj'     : Michael Jackson - black fedora, curls, white shirt under a black jacket, one sequined glove, white socks
    costume 'goldsuit': a shining gold suit - white shirt collar, black tie, lapels, buttons, pocket square
    costume 'rat'    : a pale pink rat - round ears, snout, whiskers, closed smiling eyes, a heart-shaped tail
    costume 'scout'  : ball cap + headset, dog tags, messenger bag, belt, hand wraps, knee-length trousers, socks
    cat 'cute'       : round ears, white muzzle and cheeks, pink nose, whiskers, big eyes, curly tail
    costume 'fallen' : a red line-drawn devil-angel - lit outline, glowing eyes, horns, a halo, bladed wings, a long spiral tail
    costume 'zombie' : milky eyes in sunken sockets, a torn gaping mouth, rotting wounds, bite marks, filth on the clothes
    costume 'hev'    : Gordon Freeman's HEV suit - chest plate with the lambda, armoured arms and legs, black gloves, glasses, goatee
    costume 'psy'    : a living fractal over the whole body (psy.js), a spinning fractal mandala halo
    costume 'slugcat': Rain World's Saint - round head, nub ears, fur tufts, white glowing eyes, a long swaying tongue, a thick tail
    cat 'sleek'      : tall pointed ears, a narrow muzzle, slit eyes, a long thin tail
    toon             : a black outline round every surface (the toon materials are the Character's)
  Frames: chest group (y up from 0.3 m above the hips; +z forward), the face group (head
  surface out to about x ±0.08, y ±0.11, nose tip z 0.123), the hips group.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);

export function blob(mat, pos, scale, parent, rot) {
  const m = new THREE.Mesh(SPHERE, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}
export function part(geo, mat, parent, pos, rot) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });

// the shirt's front and back profile (hips-space y -> radius, see Character.buildBody), for
// things worn on the chest
export const FRONT = [[0.605, 0.05], [0.585, 0.06], [0.56, 0.072], [0.525, 0.086], [0.47, 0.1], [0.4, 0.104], [0.33, 0.098], [0.26, 0.092], [0.19, 0.086], [0.11, 0.08]];
export const BACK = [[0.605, 0.055], [0.585, 0.068], [0.56, 0.078], [0.525, 0.088], [0.47, 0.096], [0.4, 0.1], [0.33, 0.094], [0.26, 0.088], [0.19, 0.08], [0.11, 0.076]];
export function prof(rows, y) {
  for (let i = 0; i < rows.length - 1; i++) {
    const [y0, r0] = rows[i], [y1, r1] = rows[i + 1];
    if (y <= y0 && y >= y1) return r0 + (r1 - r0) * (y0 - y) / (y0 - y1);
  }
  return y > rows[0][0] ? rows[0][1] : rows[rows.length - 1][1];
}

export function dress(ch) {
  const L = ch.look;
  if (L.costume === 'suit') suit(ch);
  if (L.costume === 'hoodie') hoodie(ch);
  if (L.costume === 'baldi') baldi(ch);
  if (L.costume === 'neon') neon(ch);
  if (L.costume === 'glitch') glitch(ch);
  if (L.costume === 'radiant') radiant(ch);
  if (L.costume === 'prismaticWings') prismaticWings(ch);
  if (L.costume === 'scout') scout(ch);
  if (L.cat) cat(ch, L.cat);
  if (L.costume === 'slugcat') slugcat(ch);
  if (L.costume === 'papyrus') papyrus(ch);
  if (L.costume === 'psy') psy(ch);
  if (L.costume === 'hev') hev(ch);
  if (L.costume === 'zombie') zombie(ch);
  if (L.costume === 'fallen') fallen(ch);
  if (L.costume === 'greyoli') greyoli(ch);
  if (L.costume === 'birch') birch(ch);
  if (L.costume === 'spider') spider(ch);
  if (L.costume === 'threefold') threefold(ch);
  if (L.costume === 'flowery') flowery(ch);
  if (L.costume === 'rat') rat(ch);
  if (L.costume === 'goldsuit') goldsuit(ch);
  if (L.costume === 'mj') mj(ch);
  if (L.costume === 'seek') seek(ch);
  if (L.costume === 'alien') alien(ch);
  if (L.costume === 'manager') manager(ch);
  if (L.costume === 'fatboy') fatboy(ch);
  if (L.costume === 'slime') slime(ch);
  if (L.costume === 'emoji') emoji(ch);
  if (L.costume === 'raccoon') raccoon(ch);
  if (L.costume === 'jason') jason(ch);
  if (L.costume === 'dracula') dracula(ch);
  if (L.costume === 'gcap') gcap(ch);
  if (L.costume === 'false') falseBody(ch);
  if (L.costume === 'figure') figure(ch);
  if (L.costume === 'bee') bee(ch);
  if (L.toon) outline(ch);
}

// ---------- birch: a black silhouette - a box head with a doodled pastel screen for a face,
// long thin limbs, and a long ragged robe down to the ground ----------
function birch(ch) {
  const F = ch.face, M = ch.mat, B = ch.shape.B, kw = Math.pow(B, 0.8);
  const ink = std(0x09090b, { roughness: 0.92 });
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  // the head: a black box round the whole skull
  part(new RoundedBoxGeometry(0.2, 0.215, 0.23, 3, 0.02), ink, F, [0, 0.005, 0.008]);
  // the face: a screen of colour patches with scribbles on it, lit a little from within
  const tex = birchScreen();
  const scr = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.55 });
  part(new THREE.BoxGeometry(0.17, 0.18, 0.006), scr, F, [0, 0.005, 0.124]);

  // the robe: from the waist, flaring out to a torn hem at the ankles
  const hips = ch.hips, len = 1.03;
  const geo = robeGeo(0.16 * kw, 0.35 * kw, len);
  const robe = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.95, side: THREE.DoubleSide }));
  const piv = new THREE.Group();
  piv.position.set(0, 0.12, 0);
  piv.add(robe);
  hips.add(piv);

  // it swings with the stride, and trails back on the move
  const prev = ch.costumeTick;
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    t += dt * (1.2 + sp * 5);
    piv.rotation.x = -sp * 0.12 + Math.sin(t * 0.9) * 0.02;
    piv.rotation.z = Math.sin(t) * (0.015 + sp * 0.04);
  };
}
/** A flared open tube (hips-space, hanging down from y 0), its bottom edge torn into rags. */
function robeGeo(r0, r1, len) {
  const N = 48, R = 14, pos = [], idx = [];
  const rag = (a) => 0.06 * Math.abs(Math.sin(a * 7.3)) + 0.04 * Math.abs(Math.sin(a * 13.1 + 1)) + 0.03 * Math.sin(a * 23.7 + 2);
  for (let j = 0; j <= R; j++) {
    const v = j / R;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      // (a narrower front and back than sides, like the body under it)
      const r = r0 + (r1 - r0) * Math.pow(v, 1.6);
      const y = -len * v + (j === R ? rag(a) : v > 0.85 ? rag(a) * (v - 0.85) / 0.15 : 0);
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r * 0.78);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + N + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
let BIRCH_TEX = null;
function birchScreen() {
  if (BIRCH_TEX) return BIRCH_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  // four soft patches of colour
  const cols = [['#f39fcb', 0, 0], ['#f5dc5c', 128, 0], ['#56c8dc', 0, 128], ['#f4a24e', 128, 128]];
  for (const [col, x, y] of cols) { g.fillStyle = col; g.fillRect(x, y, 128, 128); }
  g.globalAlpha = 0.5;
  const mix = g.createLinearGradient(0, 0, 256, 256);
  mix.addColorStop(0, 'rgba(255,255,255,0)'); mix.addColorStop(0.5, 'rgba(255,240,200,0.6)'); mix.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = mix; g.fillRect(0, 0, 256, 256);
  g.globalAlpha = 1;
  // scribbles: a diamond eye up top, a ring, a squiggle, crosses
  g.strokeStyle = '#141414'; g.lineWidth = 7; g.lineCap = g.lineJoin = 'round';
  g.beginPath(); g.moveTo(128, 40); g.lineTo(162, 82); g.lineTo(128, 124); g.lineTo(94, 82); g.closePath(); g.stroke();
  g.beginPath(); g.arc(128, 82, 12, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(178, 170, 26, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(40, 170); for (let x = 40; x <= 110; x += 10) g.lineTo(x, 170 + (((x - 40) / 10) % 2 ? -14 : 14)); g.stroke();
  for (const [x, y] of [[50, 60], [206, 58], [100, 222]]) {
    g.beginPath(); g.moveTo(x - 10, y - 10); g.lineTo(x + 10, y + 10); g.moveTo(x + 10, y - 10); g.lineTo(x - 10, y + 10); g.stroke();
  }
  g.lineWidth = 12; g.strokeRect(6, 6, 244, 244);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (BIRCH_TEX = t);
}

// ---------- greyoli: red spiked hair, blue/red headphones, black-and-orange split shirt,
// striped black trousers, pink shoes, big black oval eyes ----------
function greyoli(ch) {
  const F = ch.face, M = ch.mat;
  const black = std(0x141416, { roughness: 0.85 });
  // (the shirt: orange, its right half black - stain.js splits the torso down the middle)
  M.top.userData.split = 0x141416;
  black.userData.cloth = true;
  for (const a of ch.arms) {
    if (a.side !== -1) continue;
    for (const g of [a.upper, a.fore]) g.traverse((o) => { if (o.isMesh && o.material === M.top) o.material = black; });
  }

  // the eyes: two tall black ovals, nothing else on the face
  for (const e of ch.eyes) {
    e.eye.visible = false;
    e.brow.visible = false;
    e.iris.position.set(e.side * 0.03, 0.006, 0.094);
    e.iris.scale.set(0.0135, 0.023, 0.009);
    e.iris.rotation.y = e.side * 0.3;
  }
  M.iris.color.setHex(0x050505);
  M.iris.roughness = 0.35;

  // the hair: a crest of red spikes, swept up and back
  const dark = std(0x6e0806, { roughness: 0.75 });
  const cone = new THREE.ConeGeometry(1, 1, 7);
  cone.translate(0, 0.5, 0);
  const spikes = [
    // [x, y, z, length, radius, tilt back, tilt side]
    [0, 0.1, 0.03, 0.09, 0.028, -0.35, 0], [0.03, 0.098, 0.02, 0.075, 0.024, -0.45, -0.5], [-0.03, 0.098, 0.02, 0.075, 0.024, -0.45, 0.5],
    [0, 0.102, -0.015, 0.1, 0.03, -0.8, 0], [0.04, 0.09, -0.02, 0.08, 0.026, -0.85, -0.65], [-0.04, 0.09, -0.02, 0.08, 0.026, -0.85, 0.65],
    [0.02, 0.08, -0.055, 0.085, 0.026, -1.2, -0.3], [-0.02, 0.08, -0.055, 0.085, 0.026, -1.2, 0.3], [0, 0.05, -0.08, 0.07, 0.024, -1.6, 0],
    [0.06, 0.06, 0.0, 0.055, 0.02, -0.4, -1.1], [-0.06, 0.06, 0.0, 0.055, 0.02, -0.4, 1.1],
  ];
  for (const [x, y, z, l, r, rx, rz] of spikes) {
    const m = part(cone, M.hair, F, [x, y, z], [rx, 0, rz]);
    m.scale.set(r, l, r);
    // (a darker core at the root)
    const c = part(cone, dark, F, [x, y - 0.004, z], [rx, 0, rz]);
    c.scale.set(r * 1.06, l * 0.35, r * 1.06);
  }
  // a cap of hair over the crown, under the spikes
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.hair);
  crown.scale.set(0.086, 0.09, 0.104);
  crown.position.set(0, 0.03, -0.006);
  crown.rotation.x = -0.12;
  F.add(crown);

  // headphones: a dark band over the top, blue on the right ear, red on the left
  const band = part(new THREE.TorusGeometry(0.1, 0.006, 6, 24, Math.PI), black, F, [0, 0.0, -0.01]);
  band.scale.set(0.99, 1.22, 1);
  for (const [x, col] of [[1, 0xd4201c], [-1, 0x1f3fd6]]) {
    const cupM = std(col, { roughness: 0.35 });
    part(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 20), cupM, F, [x * 0.092, -0.008, -0.01], [0, 0, Math.PI / 2]);
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 18), black, F, [x * 0.078, -0.008, -0.01], [0, 0, Math.PI / 2]);
  }

  // trousers: a white stripe down the front of each leg
  const stripe = std(0xf2f2f2, { roughness: 0.7 });
  const kl = ch.shape.leg;
  for (const l of ch.legs) {
    ch.detail.push(
      part(new THREE.BoxGeometry(0.014, 0.3, 0.006), stripe, l.thigh, [0, -0.2, 0.086 * kl], [0.1, 0, 0]),
      part(new THREE.BoxGeometry(0.012, 0.26, 0.006), stripe, l.shin, [0, -0.19, 0.048 * kl], [0.03, 0, 0]),
    );
  }
}

// ---------- fallen: dark red all through, drawn in glowing red lines; halo, wings, spiral tail ----------
function fallen(ch) {
  const F = ch.face, M = ch.mat, kf = Math.pow(ch.shape.B, 0.8);
  const Y = (yh) => yh - 0.3;
  const fill = std(0x4a080b, { roughness: 0.7 });
  const line = new THREE.MeshBasicMaterial({ color: 0xff2424 });
  const deco = (m) => { m.userData.decal = true; m.castShadow = false; return m; };
  // eyes: lit red, a white point in each
  M.eye = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff1010, emissiveIntensity: 1.4, roughness: 0.3 });
  M.iris = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0e0, emissiveIntensity: 2, roughness: 0.3 });
  for (const e of ch.eyes) {
    e.eye.material = M.eye; e.iris.material = M.iris;
    e.eye.scale.multiplyScalar(1.15);
    e.iris.scale.multiplyScalar(0.6);
    const glow = deco(new THREE.Sprite(redGlow()));
    glow.position.set(e.side * 0.029, 0.01, 0.1);
    glow.scale.setScalar(0.07);
    F.add(glow);
  }
  // horns: swept up and back off the crown
  for (const s of [1, -1]) {
    const h = part(new THREE.ConeGeometry(0.018, 0.1, 8), fill, F, [s * 0.052, 0.1, -0.01], [-0.35, 0, -s * 0.45]);
    h.scale.set(1, 1, 0.8);
  }
  // the halo, hanging over the head, bobbing
  const halo = deco(part(new THREE.TorusGeometry(0.075, 0.006, 6, 40), line, F, [0, 0.2, -0.02], [Math.PI / 2 - 0.25, 0, 0]));
  const halo2 = deco(part(new THREE.TorusGeometry(0.062, 0.002, 4, 40), line, halo, [0, 0, 0]));

  // wings: off the shoulder blades, a leading bone and a fan of long bladed feathers
  const wings = [];
  for (const s of [1, -1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.06, Y(0.5), -prof(BACK, 0.5) * kf + 0.01);
    ch.chest.add(w);
    const arm = new THREE.Group();
    arm.rotation.set(-0.25, s * 0.5, -s * 0.9);
    w.add(arm);
    part(new THREE.CapsuleGeometry(0.012, 0.36, 4, 8), fill, arm, [0, 0.19, 0]);
    const tip = new THREE.Group();
    tip.position.y = 0.37;
    tip.rotation.z = -s * 0.9;
    arm.add(tip);
    part(new THREE.CapsuleGeometry(0.009, 0.3, 4, 8), fill, tip, [0, 0.15, 0]);
    const blade = (parent, y, len, rot) => {
      const b = part(new THREE.ConeGeometry(0.035, len, 4), fill, parent, [0, y, 0], [0, 0, rot]);
      b.geometry.translate(0, len / 2, 0);
      b.scale.set(1, 1, 0.18);
    };
    for (let i = 0; i < 4; i++) blade(arm, 0.08 + i * 0.09, 0.28 + i * 0.07, -s * (2.4 - i * 0.22));
    for (let i = 0; i < 4; i++) blade(tip, 0.04 + i * 0.08, 0.5 + i * 0.04, -s * (1.1 - i * 0.26));
    wings.push({ w, s });
  }

  // the tail: out of the base of the spine, down and back, curling round into a spiral, ringed
  const pts = [V(0, -0.02, -0.09), V(0, -0.1, -0.2), V(0.01, -0.22, -0.36)];
  const C = { y: -0.6, z: -0.6 };
  for (let k = 0; k <= 16; k++) {
    const th = 1.35 + k * 0.5, r = 0.24 * (1 - k / 22);
    pts.push(V(0.02 + k * 0.004, C.y + Math.sin(th) * r, C.z + Math.cos(th) * r));
  }
  const { mesh: tail, curve } = taperedTail(pts, 0.03, 0.008, fill);
  tail.castShadow = true;
  const ringGeo = new THREE.TorusGeometry(1, 0.12, 4, 14);
  const q = new THREE.Quaternion(), Z = V(0, 0, 1);
  for (let i = 1; i < 26; i++) {
    const u = i / 26, r = 0.03 + (0.008 - 0.03) * u;
    const ring = deco(new THREE.Mesh(ringGeo, line));
    ring.position.copy(curve.getPointAt(u));
    ring.quaternion.copy(q.setFromUnitVectors(Z, curve.getTangentAt(u)));
    ring.scale.setScalar(r * 1.05);
    tail.add(ring);
  }
  const barb = part(new THREE.ConeGeometry(0.02, 0.05, 4), fill, tail, curve.getPointAt(1).toArray());
  barb.quaternion.copy(q.setFromUnitVectors(V(0, 1, 0), curve.getTangentAt(1)));
  swayTail(ch, tail, []);

  // all of it drawn in glowing red line
  outline(ch, 0xff1818);
  const tailTick = ch.costumeTick;
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    tailTick(dt);
    t += dt;
    halo.position.y = 0.2 + Math.sin(t * 1.6) * 0.008;
    halo.rotation.z += dt * 0.4;
    // a slow beat of the wings, quicker on the move
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    for (const { w, s } of wings) { w.rotation.y = s * (0.15 + 0.2 * Math.sin(t * (1.4 + sp * 2))); w.rotation.z = s * 0.08 * Math.sin(t * (1.4 + sp * 2) + 0.6); }
  };
}
let RED_GLOW = null;
function redGlow() {
  if (RED_GLOW) return RED_GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [k, col] of [[0, 'rgba(255,240,240,1)'], [0.2, 'rgba(255,60,50,0.8)'], [0.55, 'rgba(255,0,0,0.22)'], [1, 'rgba(255,0,0,0)']]) gr.addColorStop(k, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (RED_GLOW = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true }));
}

// ---------- zombie: milky eyes, sunken sockets, a torn open mouth, rot and wounds ----------
function zombie(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  const C = ch.chest, F = ch.face, M = ch.mat;
  const Y = (yh) => yh - 0.3;
  const front = (yh) => prof(FRONT, yh) * kf;
  const r = (a, b) => a + Math.random() * (b - a);
  const socket = std(0x2a1d16, { roughness: 0.9 });
  const gore = std(0x5a1c12, { roughness: 0.35 });          // wet, dark, rotten
  const rot = std(0x3d3a22, { roughness: 0.95 });           // grey-green decay
  const bone = std(0xd8ccb0, { roughness: 0.6 });
  const filth = std(0x2e2418, { roughness: 1, transparent: true, opacity: 0.7, depthWrite: false });
  const tooth = std(0xc9b98a, { roughness: 0.5 });
  const face = [];
  // milky, clouded eyes; the lids gone dark and sunken round them
  M.eye.color.setHex(0xd6cfae);
  M.iris.color.setHex(0xcfd2c4);
  for (const e of ch.eyes) {
    e.iris.scale.multiplyScalar(0.85);
    const x = e.side * 0.029;
    face.push(blob(socket, [x, 0.008, 0.078], [0.019, 0.016, 0.01], F));
    e.brow.position.y -= 0.004;
  }
  // the mouth hangs open: a dark hole, a jagged row of teeth top and bottom, the lip torn at one side
  const mz = 0.098;
  face.push(blob(socket, [0, -0.05, mz - 0.006], [0.028, 0.018, 0.012], F));
  for (let i = 0; i < 7; i++) {
    const x = -0.021 + i * 0.007;
    face.push(part(new THREE.BoxGeometry(0.0045, r(0.006, 0.01), 0.004), tooth, F, [x, -0.037, mz - 0.001], [0, 0, r(-0.2, 0.2)]));
    if (i % 2) face.push(part(new THREE.BoxGeometry(0.0045, r(0.005, 0.008), 0.004), tooth, F, [x, -0.064, mz - 0.003], [0, 0, r(-0.3, 0.3)]));
  }
  const tear = Math.random() < 0.5 ? 1 : -1;
  face.push(blob(gore, [tear * 0.03, -0.052, mz - 0.01], [0.012, 0.009, 0.008], F));
  // rot on the face: a patch or two of grey-green, a raw gash
  face.push(blob(rot, [r(-0.05, 0.05), r(0.02, 0.06), 0.085], [r(0.012, 0.02), r(0.01, 0.018), 0.008], F, [0, 0, r(0, 3)]));
  face.push(blob(gore, [-tear * r(0.04, 0.055), r(-0.03, 0.0), 0.086], [0.006, 0.02, 0.006], F, [0, 0, r(-0.4, 0.4)]));
  ch.detail.push(...face);
  ch.tinyFace.push(...face);

  // the clothes: filth soaked through, a torn hole down to the ribs on one side
  for (let i = 0; i < 4; i++) {
    const yh = r(0.2, 0.52), x = r(-0.08, 0.08) * kx;
    const d = blob(filth, [x, Y(yh), front(yh) - 0.004], [r(0.03, 0.06), r(0.03, 0.07), 0.012], C, [0, 0, r(0, 3)]);
    d.userData.decal = true; d.castShadow = false;
  }
  const side = Math.random() < 0.5 ? 1 : -1, ry = 0.36;
  const hole = new THREE.Group();
  hole.position.set(side * 0.1 * kx, Y(ry), front(ry) * 0.72);
  hole.rotation.y = side * 0.75;
  C.add(hole);
  blob(gore, [0, 0, 0], [0.045, 0.055, 0.02], hole);
  for (let i = 0; i < 3; i++) ch.detail.push(part(new THREE.CapsuleGeometry(0.004, 0.05, 3, 6), bone, hole, [0, 0.03 - i * 0.022, 0.012], [0, 0, Math.PI / 2 + side * 0.15]));

  // the arms: a bite taken out of one, rot on the other; the hands grey and dirty-nailed
  const ka = ch.shape.arm;
  ch.arms.forEach((a, i) => {
    if (i === 0) {
      const bite = blob(gore, [0.028 * ka, -0.12, 0.01], [0.014, 0.028, 0.02], a.fore);
      ch.detail.push(bite, part(new THREE.CapsuleGeometry(0.003, 0.03, 3, 6), bone, a.fore, [0.03 * ka, -0.12, 0.01], [0, 0, 0]));
    } else blob(rot, [0, -0.08, 0.03 * ka], [0.03, 0.05, 0.02], a.fore);
  });
  // (one leg of the trousers torn off at the knee, the shin bitten raw)
  const l = ch.legs[Math.random() < 0.5 ? 0 : 1];
  blob(gore, [0, -0.2, 0.05 * ch.shape.leg], [0.03, 0.05, 0.02], l.shin);
}

// ---------- hev: Gordon Freeman's hazard suit, his glasses and goatee ----------
function hev(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7), kx = Math.pow(B, 0.55);
  const C = ch.chest, F = ch.face, M = ch.mat;
  const Y = (yh) => yh - 0.3;
  const front = (yh) => prof(FRONT, yh) * kf, back = (yh) => prof(BACK, yh) * kb;
  const plate = std(0x3d4145, { roughness: 0.4, metalness: 0.35 });
  const dark = std(0x1b1c1e, { roughness: 0.7 });
  const glove = std(0x141415, { roughness: 0.55 });
  const amber = std(0xe8a23a, { roughness: 0.4, emissive: 0x6a3a00, emissiveIntensity: 0.4 });
  const frame = std(0x0e0e0f, { roughness: 0.3, metalness: 0.4 });
  const lensM = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false });

  // glasses: two rounded-rectangle frames, a bridge, arms back to the ears
  const rrect = (cx, cy, cz, w, h, ry) => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const k = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(sn), 4), 0.25); // squircle
      pts.push(V(c * k * w, sn * k * h, 0));
    }
    const g = new THREE.Group();
    g.position.set(cx, cy, cz);
    g.rotation.y = ry;
    F.add(g);
    ch.detail.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 32, 0.0017, 5, true), frame, g, [0, 0, 0]));
    const glass = part(new THREE.CircleGeometry(1, 20), lensM, g, [0, 0, -0.0005]);
    glass.scale.set(w * 1.05, h * 1.05, 1);
    glass.userData.decal = true; glass.castShadow = false;
    ch.detail.push(glass);
    ch.tinyFace.push(glass);
  };
  for (const s of [1, -1]) {
    rrect(s * 0.03, 0.009, 0.104, 0.017, 0.0105, s * 0.18);
    const arm = new THREE.CatmullRomCurve3([V(s * 0.047, 0.012, 0.099), V(s * 0.07, 0.013, 0.07), V(s * 0.081, 0.01, 0.02), V(s * 0.08, -0.004, -0.008)]);
    ch.detail.push(part(new THREE.TubeGeometry(arm, 12, 0.0015, 5, false), frame, F, [0, 0, 0]));
  }
  const bridge = new THREE.CatmullRomCurve3([V(0.013, 0.013, 0.107), V(0, 0.017, 0.112), V(-0.013, 0.013, 0.107)]);
  ch.detail.push(part(new THREE.TubeGeometry(bridge, 8, 0.0016, 5, false), frame, F, [0, 0, 0]));

  // the goatee: a moustache, strands down past the mouth, a pointed chin tuft
  const tuft = [
    blob(M.hair, [0, -0.042, 0.101], [0.026, 0.006, 0.007], F, [0.1, 0, 0]),
    blob(M.hair, [0.022, -0.058, 0.093], [0.006, 0.016, 0.007], F, [0, 0, -0.15]),
    blob(M.hair, [-0.022, -0.058, 0.093], [0.006, 0.016, 0.007], F, [0, 0, 0.15]),
    blob(M.hair, [0, -0.083, 0.07], [0.03, 0.026, 0.03], F),
  ];
  ch.detail.push(...tuft);

  // neck seal: a thick grey ring round the collar
  const seal = part(new THREE.TorusGeometry(0.07 * kx, 0.02, 10, 28), plate, C, [0, 0.245, -0.004], [Math.PI / 2 - 0.12, 0, 0]);
  seal.scale.set(1.12, 1, 1);
  part(new THREE.TorusGeometry(0.052, 0.012, 8, 24), dark, ch.neck, [0, 0.02, 0], [Math.PI / 2, 0, 0]);

  // the chest plate, the lambda in its orange circle
  const cp = part(new RoundedBoxGeometry(0.2 * kx, 0.13, 0.04, 3, 0.016), plate, C, [0, Y(0.5), front(0.5) - 0.004], [-0.22, 0, 0]);
  void cp;
  const lz = front(0.5) + 0.017;
  const disc = part(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 28), M.top, C, [0, Y(0.5), lz], [Math.PI / 2 - 0.22, 0, 0]);
  const lam = new THREE.Group();
  lam.position.set(0, Y(0.5), lz + 0.0035);
  lam.rotation.x = -0.22;
  C.add(lam);
  ch.detail.push(
    part(new THREE.BoxGeometry(0.0065, 0.044, 0.003), dark, lam, [0.004, 0, 0], [0, 0, 0.42]),
    part(new THREE.BoxGeometry(0.0065, 0.024, 0.003), dark, lam, [-0.008, -0.01, 0], [0, 0, -0.5]),
  );
  void disc;
  // ribbed belly bands
  for (const [yh, w] of [[0.39, 0.17], [0.33, 0.165], [0.27, 0.16]]) {
    part(new RoundedBoxGeometry(w * kx, 0.034, 0.02, 2, 0.008), plate, C, [0, Y(yh), front(yh) + 0.002], [-0.02, 0, 0]);
  }
  // the back unit: a plate, two grey canisters
  part(new RoundedBoxGeometry(0.2 * kx, 0.22, 0.04, 3, 0.015), plate, C, [0, Y(0.43), -back(0.43) - 0.006], [0.06, 0, 0]);
  for (const s of [1, -1]) {
    part(new THREE.CylinderGeometry(0.019, 0.019, 0.15, 14), dark, C, [s * 0.05 * kx, Y(0.43), -back(0.43) - 0.035], [0.06, 0, 0]);
  }
  // big shoulder armour
  for (const s of [1, -1]) {
    const k = Math.pow(B, 0.5) * ch.shape.LW;
    blob(M.top, [s * 0.172, 0.205, -0.012], [0.074 * k, 0.062 * k, 0.07 * k], ch.ribcage);
    blob(plate, [s * 0.19, 0.19, -0.012], [0.05 * k, 0.05 * k, 0.062 * k], ch.ribcage);
  }

  // the belt with its amber buckle light, pouches at the hips
  part(tube([[0.135, 0.152, 0.095, 0.095], [0.095, 0.15, 0.094, 0.094]].map(([y, a, b, c]) => [y, a * Math.pow(B, 0.8), b * kf, c * kb]), { caps: [false, false], n: 2.3 }), dark, ch.hips, [0, 0, 0]);
  part(new RoundedBoxGeometry(0.05, 0.038, 0.014, 2, 0.005), plate, ch.hips, [0, 0.115, 0.095 * kf + 0.004]);
  ch.detail.push(blob(amber, [0, 0.115, 0.095 * kf + 0.012], [0.008, 0.008, 0.003], ch.hips));
  for (const s of [1, -1]) part(new RoundedBoxGeometry(0.035, 0.05, 0.05, 2, 0.01), plate, ch.hips, [s * 0.15 * Math.pow(B, 0.8), 0.1, 0.02]);

  // arms: grey armour over the forearm, an orange plate on the upper arm, black gloves
  const ka = ch.shape.arm;
  const A = (rows) => rows.map(([y, p, q, r]) => [y, p * ka, q * ka, r * ka]);
  for (const a of ch.arms) {
    blob(M.top, [0, -0.13, 0], [0.052 * ka, 0.07, 0.053 * ka], a.upper);
    part(tube(A([[-0.02, 0.046, 0.042, 0.044], [-0.08, 0.047, 0.043, 0.043], [-0.16, 0.04, 0.036, 0.036], [-0.215, 0.035, 0.03, 0.03]]), { capScale: 0.4 }), plate, a.fore, [0, 0, 0]);
    blob(M.top, [0, -0.1, 0], [0.036 * ka, 0.05, 0.047 * ka], a.fore);
    part(new THREE.TorusGeometry(0.031 * ka, 0.007, 6, 20), glove, a.fore, [0, -0.225, 0], [Math.PI / 2, 0, 0]);
    a.hand.traverse((o) => { if (o.isMesh && o.material === M.skin) o.material = glove; });
  }

  // legs: orange thigh plates, grey knee pads, armoured shins, heavy boots
  const kl = ch.shape.leg;
  const L = (rows) => rows.map(([y, p, q, r]) => [y, p * kl, q * kl, r * kl]);
  for (const l of ch.legs) {
    blob(M.top, [0, -0.2, 0.045 * kl], [0.078 * kl, 0.15, 0.05 * kl], l.thigh);
    blob(plate, [0, -0.015, 0.05 * kl], [0.05 * kl, 0.058, 0.032 * kl], l.shin);
    part(tube(L([[-0.08, 0.07, 0.074, 0.07], [-0.2, 0.062, 0.066, 0.064], [-0.3, 0.056, 0.058, 0.056]]), { caps: [false, false] }), M.top, l.shin, [0, 0, 0]);
    part(tube(L([[-0.3, 0.064, 0.064, 0.066], [-0.36, 0.06, 0.06, 0.06], [-0.43, 0.058, 0.062, 0.058]]), { caps: [false, false] }), M.shoe, l.shin, [0, 0, 0]);
  }
}

// ---------- psy: the fractal skin, and a mandala that keeps unfolding behind the head ----------
function psy(ch) {
  const M = ch.mat;
  // every surface a different part of the colour wheel (stain.js draws the fractal)
  const hues = { skin: 0, top: 0.33, shorts: 0.66, shoe: 0.5, hair: 0.15 };
  for (const [k, h] of Object.entries(hues)) if (M[k]) M[k].userData.psy = h;
  // the halo: rings of rings of rings, each level turning against the one it hangs from
  const F = ch.face;
  const mats = [];
  const glow = (h) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(h, 1, 0.6), transparent: true, opacity: 0.9, depthWrite: false });
    mats.push({ m, h });
    return m;
  };
  const deco = (m) => { m.userData.decal = true; m.castShadow = false; return m; };
  const root = new THREE.Group();
  root.position.set(0, 0.03, -0.12);
  F.add(root);
  const spin = [];
  const level = (parent, r, n, depth, h) => {
    const g = new THREE.Group();
    parent.add(g);
    spin.push({ g, k: (depth % 2 ? -1 : 1) * (0.5 + depth * 0.45) });
    const ring = deco(new THREE.Mesh(new THREE.TorusGeometry(r, 0.0035 / (depth + 1) + 0.0012, 5, 48), glow(h)));
    g.add(ring);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const at = new THREE.Group();
      at.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      g.add(at);
      if (depth < 2) level(at, r * 0.36, depth ? 5 : 7, depth + 1, h + 0.22);
      else at.add(deco(new THREE.Mesh(new THREE.OctahedronGeometry(0.006), glow(h + 0.4))));
    }
  };
  level(root, 0.12, 9, 0, 0);
  // a wire star turning inside it
  const star = deco(new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), glow(0.8)));
  star.material.wireframe = true;
  root.add(star);
  let t = Math.random() * 10;
  const prev = ch.costumeTick;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    psyTick();
    t += dt;
    for (const s of spin) s.g.rotation.z += dt * s.k;
    star.rotation.x += dt * 0.7; star.rotation.y += dt * 1.1;
    const b = 1 + 0.06 * Math.sin(t * 2.3);
    root.scale.set(b, b, b);
    for (const { m, h } of mats) m.color.setHSL((h + t * 0.08) % 1, 1, 0.5 + 0.08 * Math.sin(t * 3 + h * 20));
  };
}

// ---------- papyrus: a skull, the battle body, the long red scarf, trunks and boots ----------
function papyrus(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7), kx = Math.pow(B, 0.55);
  const C = ch.chest, F = ch.face, M = ch.mat;
  const Y = (yh) => yh - 0.3;
  const front = (yh) => prof(FRONT, yh) * kf;
  const bone = std(0xf3efe4, { roughness: 0.55 });
  const dark = std(0x0d0b0c, { roughness: 0.9 });
  const red = std(0xc4302b, { roughness: 0.75 });
  const gold = std(0xd9b24a, { roughness: 0.35, metalness: 0.35 });
  const blue = std(0x3552a8, { roughness: 0.6 });

  // the skull over the head: a big cranium and a long jaw (the face underneath doesn't show)
  blob(bone, [0, 0.022, 0], [0.097, 0.102, 0.135], F);
  blob(bone, [0, -0.055, 0.025], [0.078, 0.06, 0.108], F);
  const zOn = (x, y) => Math.max(
    0.135 * Math.sqrt(Math.max(0, 1 - (x / 0.097) ** 2 - ((y - 0.022) / 0.102) ** 2)),
    0.025 + 0.108 * Math.sqrt(Math.max(0, 1 - (x / 0.078) ** 2 - ((y + 0.055) / 0.06) ** 2)));
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  const face = [];
  // narrowed eye sockets (slanted down to the middle: determined), a tiny light in each
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [1, -1]) {
    const x = s * 0.034, y = 0.016;
    face.push(blob(dark, [x, y, zOn(x, y) - 0.004], [0.021, 0.014, 0.01], F, [0, s * 0.3, s * 0.32]));
    face.push(blob(glint, [x - s * 0.004, y + 0.001, zOn(x, y) + 0.004], [0.0035, 0.0035, 0.002], F));
  }
  // the nose hole
  const nose = part(new THREE.ConeGeometry(0.009, 0.017, 3), dark, F, [0, -0.016, zOn(0, -0.016) - 0.001], [0, 0, 0]);
  nose.scale.z = 0.4;
  face.push(nose);
  // the big toothy grin: a dark mouth, a row of teeth, the gaps between them
  face.push(blob(dark, [0, -0.052, zOn(0, -0.052) - 0.006], [0.052, 0.021, 0.012], F));
  face.push(blob(bone, [0, -0.051, zOn(0, -0.051) - 0.003], [0.047, 0.014, 0.01], F));
  for (let x = -0.035; x <= 0.0351; x += 0.0117) {
    face.push(part(new THREE.BoxGeometry(0.0016, 0.026, 0.006), dark, F, [x, -0.051, zOn(x, -0.051) + 0.001], [0, Math.atan2(x, 0.1), 0]));
  }
  ch.detail.push(...face);
  ch.tinyFace.push(...face);

  // the battle body: big white shoulder pads with gold bands at the sleeves
  for (const s of [1, -1]) {
    const k = Math.pow(B, 0.5) * ch.shape.LW;
    blob(M.top, [s * 0.17, 0.2, -0.012], [0.078 * k, 0.07 * k, 0.074 * k], ch.ribcage);
  }
  const ka = ch.shape.arm;
  for (const a of ch.arms) {
    const band = part(new THREE.TorusGeometry(0.051 * ka, 0.009, 8, 24), gold, a.upper, [0, -0.115, 0], [Math.PI / 2, 0, 0]);
    ch.detail.push(band);
    // red gloves: flared cuffs with a gold band, over the palm
    part(tube([[0.04, 0.038, 0.04, 0.04], [0.0, 0.026, 0.03, 0.03]], { caps: [false, false] }), red, a.hand, [0, 0, 0]);
    ch.detail.push(part(new THREE.TorusGeometry(0.036, 0.006, 6, 20), gold, a.hand, [0, 0.036, 0], [Math.PI / 2, 0, 0]));
    part(tube([[0.006, 0.021, 0.024, 0.024], [-0.025, 0.023, 0.038, 0.036], [-0.07, 0.021, 0.044, 0.042], [-0.094, 0.015, 0.042, 0.04]], { seg: 20, capScale: 0.5 }), red, a.hand, [0, 0, 0]);
  }

  // the scarf: bunched round the neck, draped over the chest, one long end flying out behind
  const collar = part(new THREE.TorusGeometry(0.08 * kx, 0.032, 10, 28), red, C, [0, 0.25, -0.004], [Math.PI / 2 - 0.12, 0, 0]);
  collar.scale.set(1.1, 1, 1);
  part(new THREE.TorusGeometry(0.056, 0.022, 8, 24), red, ch.neck, [0, 0.03, 0], [Math.PI / 2, 0, 0]);
  blob(red, [0, Y(0.53), front(0.53) + 0.01], [0.085 * kx, 0.055, 0.022], C, [-0.25, 0, 0]);
  const piv = new THREE.Group();
  piv.position.set(-0.06 * kx, 0.25, -0.07);
  C.add(piv);
  const { mesh: tail } = taperedTail([
    V(0, 0, 0), V(-0.07, -0.02, -0.06), V(-0.16, -0.05, -0.12), V(-0.27, -0.03, -0.17), V(-0.38, -0.08, -0.2), V(-0.47, -0.05, -0.2),
  ], 0.034, 0.016, red);
  tail.scale.set(1, 0.55, 1);
  piv.add(tail);

  // blue trunks with a gold waistband
  const kw = Math.pow(B, 0.8);
  blob(blue, [0, 0.05, 0.004], [0.172 * kw, 0.14, 0.118 * kf], ch.hips);
  part(tube([[0.175, 0.166, 0.108, 0.108], [0.14, 0.17, 0.11, 0.11]].map(([y, a, b, c]) => [y, a * kw, b * kf, c * kb]), { caps: [false, false], n: 2.3 }), gold, ch.hips, [0, 0, 0]);

  // tall red boots up the shin, with a turned-over cuff
  const kl = ch.shape.leg;
  const L = (rows) => rows.map(([y, p, q, r]) => [y, p * kl, q * kl, r * kl]);
  for (const l of ch.legs) {
    part(tube(L([[-0.2, 0.06, 0.058, 0.064], [-0.26, 0.056, 0.054, 0.058], [-0.35, 0.052, 0.05, 0.052], [-0.43, 0.054, 0.056, 0.052]]), { caps: [false, false] }), M.shoe, l.shin, [0, 0, 0]);
    part(tube(L([[-0.18, 0.066, 0.064, 0.07], [-0.23, 0.064, 0.062, 0.068]]), { caps: [false, false] }), M.shoe, l.shin, [0, 0, 0]);
  }

  // the scarf end streams back, flapping harder on the move
  const prev = ch.costumeTick;
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    t += dt * (2 + sp * 6);
    piv.rotation.y = -0.5 + Math.sin(t) * (0.15 + sp * 0.2) - sp * 0.3;
    piv.rotation.z = Math.sin(t * 1.7 + 1) * (0.08 + sp * 0.12);
    piv.rotation.x = -0.1 + Math.sin(t * 0.8) * 0.06 - sp * 0.25;
  };
}

// ---------- the scout: cap and headset, bag across the chest, wrapped hands, knee-length trousers ----------
// the shirt's half-width (hips-space y -> x radius)
const SIDE = [[0.605, 0.055], [0.585, 0.1], [0.56, 0.15], [0.525, 0.178], [0.47, 0.176], [0.4, 0.168], [0.33, 0.156], [0.26, 0.146], [0.19, 0.134], [0.11, 0.128]];
function scout(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7);
  const kxOf = (yh) => Math.pow(B, yh < 0.45 ? 0.8 : 0.55);
  const C = ch.chest, F = ch.face, M = ch.mat;
  const Y = (yh) => yh - 0.3;
  const front = (yh) => prof(FRONT, yh) * kf, back = (yh) => prof(BACK, yh) * kb, half = (yh) => prof(SIDE, yh) * kxOf(yh);
  // a point on the shirt's surface at (x, hips-space y), front (+1) or back (-1), pushed out by `out`
  const onShirt = (x, yh, fb, out = 0.008) => {
    const rx = half(yh), rz = fb > 0 ? front(yh) : back(yh);
    const u = Math.min(0.98, Math.abs(x) / rx);
    const z = rz * Math.pow(1 - Math.pow(u, 2.5), 1 / 2.5);
    return V(x, Y(yh), fb * (z + out));
  };
  const black = std(0x151517, { roughness: 0.7 }), grey = std(0xa9abae, { roughness: 0.35, metalness: 0.15 });
  const strapM = std(0x2a2a2c, { roughness: 0.85 }), wrap = std(0xd9d9d4, { roughness: 0.95 });
  const orange = std(0xe2782c, { roughness: 0.45 }), capM = std(0x2b2b2e, { roughness: 0.8 });

  // ball cap: crown over the head, brim out front, a button on top
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), capM);
  crown.scale.set(0.094, 0.094, 0.114);
  crown.position.set(0, 0.03, -0.004);
  crown.rotation.x = -0.08;
  F.add(crown);
  const brim = part(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, -Math.PI / 2, Math.PI), capM, F, [0, 0.036, 0.075], [0.16, 0, 0]);
  brim.scale.set(0.088, 0.006, 0.07);
  const btn = blob(capM, [0, 0.122, -0.012], [0.01, 0.006, 0.01], F);
  // the headset: band over the cap, a cup on each ear, a mic boom round to the mouth
  const band = part(new THREE.TorusGeometry(0.1, 0.0045, 6, 24, Math.PI), black, F, [0, 0.0, -0.012], [0, 0, 0]);
  band.scale.set(0.97, 1.2, 1);
  for (const x of [1, -1]) {
    const cup = part(new THREE.CylinderGeometry(0.029, 0.029, 0.022, 20), orange, F, [x * 0.09, -0.008, -0.012], [0, 0, Math.PI / 2]);
    part(new THREE.CylinderGeometry(0.018, 0.018, 0.024, 16), black, F, [x * 0.093, -0.008, -0.012], [0, 0, Math.PI / 2]);
    ch.detail.push(cup);
  }
  const boom = new THREE.CatmullRomCurve3([V(-0.1, -0.012, -0.004), V(-0.095, -0.045, 0.04), V(-0.065, -0.065, 0.088), V(-0.028, -0.058, 0.108)]);
  const mic = part(new THREE.TubeGeometry(boom, 16, 0.0028, 6, false), black, F, [0, 0, 0]);
  const micTip = blob(black, [-0.024, -0.057, 0.109], [0.007, 0.006, 0.006], F);
  ch.detail.push(btn, mic, micTip);

  // dog tags on a chain, lying on the chest
  const chain = part(new THREE.TorusGeometry(0.068 * Math.pow(B, 0.5), 0.0022, 5, 28), grey, C, [0, Y(0.585), 0.014], [Math.PI / 2 - 0.55, 0, 0]);
  chain.scale.set(1, 1.25, 1);
  const tagP = onShirt(0, 0.53, 1, 0.004);
  const tags = [
    part(new RoundedBoxGeometry(0.02, 0.03, 0.003, 1, 0.004), grey, C, [tagP.x - 0.007, tagP.y, tagP.z], [-0.35, 0, 0.12]),
    part(new RoundedBoxGeometry(0.02, 0.03, 0.003, 1, 0.004), grey, C, [tagP.x + 0.007, tagP.y - 0.004, tagP.z + 0.003], [-0.35, 0, -0.1]),
  ];
  ch.detail.push(chain, ...tags);

  // the messenger bag: strap over the right shoulder, across the chest to the left hip, bag behind
  const k = kxOf(0.3);
  const path = [
    V(-0.1 * k, Y(0.612), -0.004),
    onShirt(-0.085 * k, 0.575, 1), onShirt(-0.045 * k, 0.5, 1), onShirt(0.01 * k, 0.42, 1), onShirt(0.06 * k, 0.34, 1),
    onShirt(0.1 * k, 0.27, 1), onShirt(0.13 * k, 0.21, 1, 0.012),
    V(half(0.18) + 0.012, Y(0.17), 0),
    onShirt(0.12 * k, 0.24, -1, 0.012), onShirt(0.06 * k, 0.33, -1), onShirt(0.0, 0.42, -1), onShirt(-0.05 * k, 0.5, -1), onShirt(-0.085 * k, 0.575, -1),
  ];
  const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, true), 64, 0.011, 6, true), strapM);
  strap.scale.z = 1;
  C.add(strap);
  const bag = part(new RoundedBoxGeometry(0.2, 0.2, 0.075, 3, 0.03), strapM, C, [0.11 * k, Y(0.24), -back(0.24) - 0.05], [0.12, 0.35, -0.15]);
  // the belt, with its buckle
  const belt = part(tube([[0.125, 0.15, 0.093, 0.093], [0.09, 0.149, 0.092, 0.092]].map(([y, a, b, c]) => [y, a * Math.pow(B, 0.8), b * kf, c * kb]), { caps: [false, false], n: 2.3 }), black, ch.hips, [0, 0, 0]);
  const buckle = part(new RoundedBoxGeometry(0.05, 0.034, 0.01, 1, 0.004), grey, ch.hips, [0, 0.107, 0.093 * kf + 0.004]);
  ch.detail.push(buckle);
  void bag; void belt;

  // hand wraps: round the wrist and the palm (fingers bare)
  const ka = ch.shape.arm;
  for (const a of ch.arms) {
    part(tube([[-0.19, 0.03, 0.026, 0.026], [-0.22, 0.03, 0.025, 0.025], [-0.26, 0.028, 0.021, 0.021]].map(([y, p, q, r]) => [y, p * ka, q * ka, r * ka]), { caps: [false, true] }), wrap, a.fore, [0, 0, 0]);
    part(tube([[0.006, 0.024, 0.026, 0.026], [-0.025, 0.027, 0.039, 0.037], [-0.07, 0.025, 0.045, 0.043]], { caps: [false, false], seg: 20 }), wrap, a.hand, [0, 0, 0]);
  }
  // knee-length trousers (baggy at the knee, a cuff), grey socks up to them, stripes on the shoes
  const kl = ch.shape.leg;
  const sock = std(0xc9cacd, { roughness: 0.9 }), stripe = std(0xf2f2f2, { roughness: 0.6 });
  const L = (rows) => rows.map(([y, p, q, r]) => [y, p * kl, q * kl, r * kl]);
  for (const l of ch.legs) {
    part(tube(L([[0.03, 0.094, 0.094, 0.094], [-0.08, 0.09, 0.094, 0.088], [-0.2, 0.08, 0.086, 0.076], [-0.33, 0.07, 0.072, 0.064], [-0.44, 0.068, 0.068, 0.066]]), { caps: [true, false] }), M.shorts, l.thigh, [0, 0, 0]);
    part(tube(L([[0.04, 0.068, 0.068, 0.066], [-0.04, 0.07, 0.07, 0.072], [-0.12, 0.066, 0.064, 0.074], [-0.17, 0.062, 0.06, 0.07]]), { caps: [false, true], capScale: 0.2 }), M.shorts, l.shin, [0, 0, 0]);
    part(tube(L([[-0.15, 0.046, 0.04, 0.066], [-0.24, 0.039, 0.035, 0.046], [-0.34, 0.033, 0.031, 0.034], [-0.43, 0.032, 0.03, 0.033]]), { caps: [false, false] }), sock, l.shin, [0, 0, 0]);
    for (const x of [1, -1]) for (const dz of [0, 0.02]) {
      ch.detail.push(part(new THREE.BoxGeometry(0.003, 0.008, 0.05), stripe, l.foot, [x * 0.05, -0.05, 0.045 + dz], [0.5, 0, 0]));
    }
  }
}

// ---------- baldi: the one hair, the stare, the smile ----------
function baldi(ch) {
  const F = ch.face, M = ch.mat;
  // a single curl standing up off the crown
  const curl = new THREE.CatmullRomCurve3([
    V(0, 0.104, -0.01), V(0.002, 0.13, -0.004), V(0.012, 0.15, 0.01), V(0.028, 0.148, 0.022), V(0.032, 0.134, 0.018), V(0.022, 0.128, 0.008),
  ]);
  const hair = part(new THREE.TubeGeometry(curl, 24, 0.0024, 6, false), std(0x2a1a10, { roughness: 0.8 }), F, [0, 0, 0]);
  ch.detail.push(hair);
  // wide eyes, small pupils
  for (const e of ch.eyes) {
    e.eye.scale.multiplyScalar(1.3);
    e.iris.scale.set(0.0045, 0.0045, 0.002);
    e.iris.position.z += 0.004;
    e.brow.position.y += 0.006;
  }
  M.iris.color.setHex(0x0b0b0b);
  // the smile: a thin dark arc, ear to ear-ish
  const arc = 0.78 * Math.PI;
  const smile = part(new THREE.TorusGeometry(0.036, 0.0032, 6, 28, arc), std(0x4a1414, { roughness: 0.5 }), F, [0, -0.028, 0.093], [-0.25, 0, Math.PI + (Math.PI - arc) / 2]);
  smile.scale.z = 0.6;
  ch.tinyFace.push(smile);
}

/** Closed, happy eyes: a thin dark arch over each eye (no eyeballs), brows kept unless told. */
function closedEyes(ch, color, { r = 0.011, y = 0.012, brows = true } = {}) {
  const mat = std(color, { roughness: 0.5 });
  const geo = new THREE.TorusGeometry(r, 0.0023, 6, 18, Math.PI);
  for (const e of ch.eyes) {
    e.eye.visible = false;
    e.iris.visible = false;
    if (!brows) e.brow.visible = false;
    const arch = part(geo, mat, ch.face, [e.side * 0.029, y, 0.0935], [-0.15, e.side * 0.3, 0]);
    arch.scale.z = 0.7;
    ch.tinyFace.push(arch);
  }
}
/** A thin dark smile: an arc across the face. */
function smile(ch, color, pos, r = 0.026, tilt = -0.25, arc = 0.72 * Math.PI) {
  const m = part(new THREE.TorusGeometry(r, 0.003, 6, 24, arc), std(color, { roughness: 0.5 }), ch.face, pos, [tilt, 0, Math.PI + (Math.PI - arc) / 2]);
  m.scale.z = 0.6;
  ch.tinyFace.push(m);
  return m;
}

// ---------- me67or: an all-green humanoid with a white lowercase m; no nose ----------
function neon(ch) {
  const M = ch.mat, F = ch.face, green = 0x2da449;
  for (const mat of [M.skin, M.top, M.shorts, M.shoe, M.hair]) {
    mat.color.setHex(green);
    mat.emissive?.setHex(0x000000);
    mat.metalness = 0;
    mat.roughness = 0.78;
  }

  // Replace the sculpted face and nose with a smooth, rounded head.
  for (const child of F.children) child.visible = false;
  const rx = 0.084, ry = 0.108, rz = 0.09, headY = 0.002;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), M.skin);
  head.scale.set(rx, ry, rz);
  head.position.y = headY;
  F.add(head);

  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 104px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('m', 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mark = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const markGeo = new THREE.PlaneGeometry(0.064, 0.064, 12, 12);
  const positions = markGeo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    const nx = x / rx, ny = (0.012 + y - headY) / ry;
    positions.setZ(i, rz * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) + 0.001);
  }
  markGeo.computeVertexNormals();
  part(markGeo, mark, F, [0, 0.012, 0]);
}

// ---------- glitch: chromatic flicker, broken scanlines, and drifting pixel fragments ----------
function glitch(ch) {
  const M = ch.mat, C = ch.chest;
  const light = (mat, base, glow, intensity) => {
    mat.color.setHex(base); mat.emissive.setHex(glow); mat.emissiveIntensity = intensity;
    mat.roughness = 0.3; mat.metalness = 0.28;
  };
  light(M.skin, 0x101426, 0x182b78, 0.8);
  light(M.top, 0x111424, 0x5117a2, 0.62);
  light(M.shorts, 0x101222, 0x0a5170, 0.48);
  light(M.shoe, 0x090b16, 0x9221a8, 0.7);
  light(M.hair, 0x37206a, 0x651cff, 1.25);
  M.eye = new THREE.MeshStandardMaterial({ color: 0xfff1ff, emissive: 0xff28ed, emissiveIntensity: 3.5, roughness: 0.12 });
  M.iris = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x45faff, emissiveIntensity: 4.5, roughness: 0.1 });
  for (const e of ch.eyes) { e.eye.material = M.eye; e.iris.material = M.iris; }

  const marks = [];
  const deco = (mesh) => { mesh.userData.decal = true; mesh.castShadow = false; mesh.renderOrder = 2; return mesh; };
  const addBar = (parent, x, y, z, w, h, hue) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 1, 0.58), transparent: true, opacity: 0.82, depthWrite: false });
    const mesh = deco(part(new THREE.BoxGeometry(w, h, 0.003), mat, parent, [x, y, z]));
    marks.push({ mesh, mat, x, y, z, hue, phase: Math.random() * 9, amp: 0.004 + Math.random() * 0.018 });
  };

  const front = (yh) => prof(FRONT, yh) * Math.pow(ch.shape.B, 0.8);
  const Y = (yh) => yh - 0.3;
  for (const [yh, w, hue] of [[0.49, 0.14, 0.82], [0.455, 0.09, 0.5], [0.42, 0.12, 0.94]]) {
    addBar(C, (Math.random() - 0.5) * 0.045, Y(yh), front(yh) + 0.006, w, 0.006 + Math.random() * 0.008, hue);
  }
  for (let i = 0; i < 6; i++) {
    addBar(ch.face, (Math.random() - 0.5) * 0.045, 0.075 - i * 0.022, 0.12, 0.035 + Math.random() * 0.07, 0.003 + Math.random() * 0.004, i % 2 ? 0.51 : 0.84);
  }

  const fragments = [];
  for (let i = 0; i < 18; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(i % 3 ? 0.78 : 0.52, 1, 0.62),
      transparent: true, opacity: 0.75, depthWrite: false,
    });
    const mesh = deco(part(new THREE.BoxGeometry(0.012 + Math.random() * 0.028, 0.006 + Math.random() * 0.02, 0.008), mat, ch.root, [0, 0, 0]));
    const origin = new THREE.Vector3((Math.random() - 0.5) * 0.48, 0.38 + Math.random() * 1.08, (Math.random() - 0.5) * 0.18);
    fragments.push({ mesh, mat, origin, phase: Math.random() * Math.PI * 2, speed: 2 + Math.random() * 5 });
  }

  const prev = ch.costumeTick;
  let t = Math.random() * 20;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 7));
    M.eye.emissiveIntensity = 2.6 + pulse * 2;
    M.iris.emissiveIntensity = 3.2 + pulse * 2.2;
    for (const m of marks) {
      const snap = Math.sin(t * 17 + m.phase) > 0.91;
      m.mesh.position.set(m.x + Math.sin(t * 4 + m.phase) * 0.002 + (snap ? (Math.random() - 0.5) * m.amp * 2 : 0), m.y, m.z);
      m.mat.color.setHSL((m.hue + t * 0.035 + (snap ? 0.34 : 0)) % 1, 1, 0.54 + pulse * 0.1);
      m.mat.opacity = snap ? 0.35 + Math.random() * 0.65 : 0.78;
    }
    for (const f of fragments) {
      const burst = Math.sin(t * f.speed + f.phase) > 0.94;
      const k = burst ? 2.2 : 1;
      f.mesh.position.set(f.origin.x + Math.sin(t * 3 + f.phase) * 0.022 * k + (burst ? (Math.random() - 0.5) * 0.025 : 0), f.origin.y + Math.sin(t * 2 + f.phase) * 0.035, f.origin.z);
      f.mesh.rotation.y = Math.sin(t * 2 + f.phase) * 0.22;
      f.mesh.material.opacity = burst ? 0.95 : 0.28 + 0.3 * pulse;
      f.mat.color.setHSL((0.52 + f.phase * 0.08 + t * 0.07) % 1, 1, 0.6);
    }
  };
}

// ---------- radiant: porcelain-white glow and blazing golden eyes ----------
function radiant(ch) {
  const M = ch.mat;
  for (const k of ['skin', 'top', 'shorts', 'shoe', 'hair']) {
    const m = M[k];
    m.color.setHex(k === 'skin' ? 0xffffff : 0xf7f8ff);
    m.emissive.setHex(k === 'shoe' ? 0xfff0b0 : 0xdde8ff);
    m.emissiveIntensity = k === 'skin' ? 0.95 : 0.72;
    m.roughness = 0.28;
    m.metalness = 0.08;
  }
  M.eye = new THREE.MeshStandardMaterial({ color: 0xfffbd1, emissive: 0xffc400, emissiveIntensity: 10, roughness: 0.08 });
  M.iris = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe326, emissiveIntensity: 14, roughness: 0.05 });
  for (const e of ch.eyes) { e.eye.material = M.eye; e.iris.material = M.iris; }

  const prev = ch.costumeTick;
  let t = Math.random() * 8;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    M.eye.emissiveIntensity = 8 + pulse * 4;
    M.iris.emissiveIntensity = 11 + pulse * 5;
  };
}

// ---------- prismatic wings: only the wings are added; their glow cycles through the spectrum ----------
function prismaticWings(ch) {
  const wings = [], glowMats = [];
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.16, -0.02, 0.35, 0.07);
  shape.quadraticCurveTo(0.62, 0.2, 0.56, 0.38);
  shape.quadraticCurveTo(0.52, 0.58, 0.4, 0.54);
  shape.quadraticCurveTo(0.27, 0.48, 0.19, 0.38);
  shape.quadraticCurveTo(0.08, 0.25, 0, 0);
  const membraneGeo = new THREE.ShapeGeometry(shape, 12);
  const membrane = new THREE.MeshBasicMaterial({ color: 0x75eaff, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const featherMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.26, metalness: 0.12, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const veinMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  glowMats.push(membrane, featherMat);

  for (const s of [1, -1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.055, 0.2, -prof(BACK, 0.48) * Math.pow(ch.shape.B, 0.7) - 0.015);
    wing.scale.x = s;
    ch.chest.add(wing);
    const web = new THREE.Mesh(membraneGeo, membrane);
    web.position.z = -0.01; web.userData.decal = true; web.renderOrder = 2; wing.add(web);
    const fan = new THREE.Group();
    wing.add(fan);
    const featherGeo = new THREE.ConeGeometry(0.045, 0.4, 5);
    featherGeo.translate(0, 0.2, 0);
    for (let i = 0; i < 6; i++) {
      const f = part(featherGeo, featherMat, fan, [0.11 + i * 0.065, 0.08 + i * 0.035, -0.018], [0, 0, -0.95 + i * 0.18]);
      f.userData.decal = true; f.renderOrder = 2;
    }
    const vein = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      V(0, 0, 0), V(0.15, 0.12, -0.016), V(0.33, 0.28, -0.016), V(0.5, 0.43, -0.016),
    ]), 16, 0.004, 5, false), veinMat);
    vein.userData.decal = true; vein.renderOrder = 3; wing.add(vein);
    wings.push({ wing, fan, side: s });
  }

  const prev = ch.costumeTick;
  let colorBeat = -1, t = 0;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    const beat = Math.floor(Date.now() / 500);
    if (beat !== colorBeat) {
      colorBeat = beat;
      const hue = ((beat % 12) + 12) % 12 / 12;
      for (const mat of glowMats) {
        mat.color.setHSL(hue, 0.92, mat === membrane ? 0.62 : 0.72);
        if (mat.emissive) { mat.emissive.copy(mat.color); mat.emissiveIntensity = 1.8; }
      }
    }
    const flying = !!ch.actor?.wingFlying || !ch.grounded;
    const rate = flying ? 19 : 4.2;
    const beatAmt = flying ? 0.48 : 0.12;
    for (const { wing, fan, side } of wings) {
      wing.rotation.z = -side * (0.08 + beatAmt * (0.5 + 0.5 * Math.sin(t * rate)));
      wing.rotation.y = side * (flying ? 0.18 : 0.06) * Math.sin(t * (flying ? 8 : 1.8));
      fan.rotation.z = -side * (flying ? 0.1 : 0.035) * Math.sin(t * rate + 0.7);
    }
  };
}

// ---------- flowery: closed happy eyes and a smile, spiky yellow hair, a green shirt with
// orange sleeves and a band, a small white collar with a black bow ----------
function flowery(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7), kx = Math.pow(B, 0.55);
  const front = (yh) => prof(FRONT, yh) * kf, back = (yh) => prof(BACK, yh) * kb;
  const Y = (yh) => yh - 0.3;
  closedEyes(ch, 0x2a1810, { brows: false });
  smile(ch, 0x5a2218, [0, -0.03, 0.094]);

  // the hair: spikes over the short cap - bangs over the brow, a crest on top, tufts at the back
  const cone = new THREE.ConeGeometry(1, 1, 6);
  cone.translate(0, 0.5, 0);
  const spikes = [
    // [x, y, z, length, radius, tilt (0 up, + forward), tilt side]
    [0, 0.07, 0.07, 0.05, 0.02, 2.2, 0], [0.028, 0.068, 0.066, 0.045, 0.018, 2.35, -0.35], [-0.028, 0.068, 0.066, 0.045, 0.018, 2.35, 0.35],
    [0.052, 0.05, 0.05, 0.04, 0.016, 2.5, -0.7], [-0.052, 0.05, 0.05, 0.04, 0.016, 2.5, 0.7],
    [0, 0.1, 0.03, 0.065, 0.022, 0.45, 0], [0.03, 0.098, 0.01, 0.06, 0.02, 0.2, -0.45], [-0.03, 0.098, 0.01, 0.06, 0.02, 0.2, 0.45],
    [0, 0.1, -0.03, 0.06, 0.022, -0.5, 0], [0.04, 0.085, -0.04, 0.05, 0.018, -0.8, -0.5], [-0.04, 0.085, -0.04, 0.05, 0.018, -0.8, 0.5],
    [0, 0.06, -0.085, 0.05, 0.02, -1.9, 0], [0.065, 0.055, -0.01, 0.04, 0.016, -0.2, -1.2], [-0.065, 0.055, -0.01, 0.04, 0.016, -0.2, 1.2],
  ];
  for (const [x, y, z, l, r, rx, rz] of spikes) part(cone, M.hair, F, [x, y, z], [rx, 0, rz]).scale.set(r, l, r);

  // the shirt: green, orange sleeves, an orange band across the chest
  const orange = std(0xee7d22, { roughness: 0.8 });
  orange.userData.cloth = true;
  for (const a of ch.arms) for (const g of [a.upper, a.fore]) g.traverse((o) => { if (o.isMesh && o.material === M.top) o.material = orange; });
  const yb = 0.4, d = (front(yb) + back(yb)) / 2;
  blob(orange, [0, Y(yb), (front(yb) - back(yb)) / 2], [0.168 * kx, 0.026, d + 0.014], C);
  // a small white collar, trimmed in black, with a little black bow
  const white = std(0xf6f4ee, { roughness: 0.7 }), black = std(0x111113, { roughness: 0.6 });
  for (const s of [1, -1]) {
    blob(white, [s * 0.026, Y(0.553), front(0.553) - 0.004], [0.03, 0.017, 0.014], C, [-0.4, 0, s * 0.5]);
    blob(black, [s * 0.034, Y(0.542), front(0.542) + 0.001], [0.022, 0.003, 0.008], C, [-0.4, 0, s * 0.5]);
    blob(black, [s * 0.012, Y(0.528), front(0.528) + 0.008], [0.011, 0.008, 0.005], C, [0, 0, s * 0.35]);
  }
  blob(black, [0, Y(0.528), front(0.528) + 0.01], [0.005, 0.006, 0.005], C);
}

// ---------- rat: a chubby pale pink rat - big round ears, a pointed snout with whiskers,
// closed smiling eyes, a pale belly and a long pink tail curled into a heart ----------
function rat(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  const front = (yh) => prof(FRONT, yh) * kf;
  const Y = (yh) => yh - 0.3;
  const pink = std(0xf4a6d2, { roughness: 0.7 }), line = 0x6e2c68;
  closedEyes(ch, line, { brows: false, y: 0.016 });
  // the snout: the face drawn out to a point, a dark nose on the end, a smile under it
  blob(M.skin, [0, -0.028, 0.098], [0.05, 0.04, 0.052], F);
  const sn = part(new THREE.ConeGeometry(0.036, 0.075, 18), M.skin, F, [0, -0.026, 0.148], [Math.PI / 2, 0, 0]);
  sn.scale.set(1, 1, 0.85);
  blob(std(0x7a2a62, { roughness: 0.35 }), [0, -0.024, 0.186], [0.009, 0.008, 0.008], F);
  smile(ch, line, [0, -0.046, 0.128], 0.03, -0.9, 0.6 * Math.PI);
  // whiskers
  const wm = std(0x9a6a96, { roughness: 0.5 });
  const wg = new THREE.CylinderGeometry(0.0007, 0.0004, 0.075, 4);
  const whiskers = [];
  for (const s of [1, -1]) for (const a of [0.14, 0, -0.14]) {
    whiskers.push(part(wg, wm, F, [s * 0.05, -0.028 + a * 0.05, 0.15], [0, -s * 0.5, Math.PI / 2 + s * a]));
  }
  ch.detail.push(...whiskers);
  // big round ears, pink inside
  for (const s of [1, -1]) {
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 24), M.skin, F, [s * 0.066, 0.1, -0.02], [Math.PI / 2 - 0.2, 0, -s * 0.45]);
    part(new THREE.CylinderGeometry(0.037, 0.037, 0.006, 22), pink, F, [s * 0.066 + s * 0.001, 0.099, -0.013], [Math.PI / 2 - 0.2, 0, -s * 0.45]);
  }
  // a paler belly
  blob(std(0xfdf0f8, { roughness: 0.85 }), [0, Y(0.3), front(0.3) - 0.012], [0.12 * kx, 0.15, 0.04], C);
  // the tail: back and up behind, then round in a heart
  const pts = [V(0, -0.02, -0.09), V(0, -0.1, -0.2), V(0.03, -0.08, -0.32), V(0.06, 0.05, -0.38), V(0.075, 0.2, -0.39)];
  const tip = V(0.08, 0.32, -0.39), u = V(1, 0, -0.55).normalize(), k = 0.0058;
  for (let i = 0; i <= 18; i++) {
    const t = Math.PI - (i / 18) * 1.88 * Math.PI;
    const hx = 16 * Math.sin(t) ** 3, hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 17;
    pts.push(tip.clone().addScaledVector(u, hx * k).setY(tip.y + hy * k));
  }
  const { mesh } = taperedTail(pts, 0.02, 0.006, pink, 96);
  swayTail(ch, mesh, []);
}

// ---------- mj: Michael Jackson - a black fedora with a white band, black curls, a white shirt
// open in a black jacket, one white sequined glove, trousers cut high over white socks ----------
function mj(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest;
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  const front = (yh) => prof(FRONT, yh) * kf;
  const Y = (yh) => yh - 0.3;
  const black = std(0x0b0b0d, { roughness: 0.55 }), white = std(0xf5f4f0, { roughness: 0.65 });
  // the fedora: a pinched crown, a white band, a wide brim - tipped forward over one eye
  const hat = new THREE.Group();
  hat.position.set(0.004, 0.078, -0.006);
  hat.rotation.set(0.2, 0, -0.08);
  F.add(hat);
  const crown = part(new THREE.CylinderGeometry(0.074, 0.088, 0.078, 24), black, hat, [0, 0.042, 0]);
  crown.scale.z = 1.12;
  const dent = blob(std(0x050506, { roughness: 0.7 }), [0, 0.081, 0], [0.05, 0.008, 0.07], hat);
  dent.scale.x = 0.035;
  const band = part(new THREE.CylinderGeometry(0.0895, 0.09, 0.016, 24), white, hat, [0, 0.01, 0]);
  band.scale.z = 1.12;
  const brim = part(new THREE.CylinderGeometry(0.14, 0.14, 0.006, 32), black, hat, [0, 0.0, 0]);
  brim.scale.z = 1.08;
  // black curls: ringlets down by the ears, and the one that falls over the forehead
  const hair = M.hair, curl = new THREE.TorusGeometry(0.009, 0.0045, 6, 12);
  for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
    part(curl, hair, F, [s * (0.08 - i * 0.002), 0.035 - i * 0.022, -0.01 - i * 0.004], [0, Math.PI / 2, i * 0.8]);
  }
  for (let i = 0; i < 3; i++) part(curl, hair, F, [-0.03 + i * 0.004, 0.058 - i * 0.017, 0.095 - i * 0.003], [0, 0, i * 0.9]);

  // the white shirt open in the jacket's V, and the jacket's lapels
  blob(white, [0, Y(0.49), front(0.49) + 0.001], [0.034, 0.075, 0.01], C, [-0.18, 0, 0]);
  for (const s of [1, -1]) {
    blob(white, [s * 0.022, Y(0.553), front(0.553) - 0.003], [0.026, 0.014, 0.012], C, [-0.4, 0, s * 0.55]);
    blob(std(0x1c1c20, { roughness: 0.35 }), [s * 0.046 * kx, Y(0.49), front(0.49) + 0.002], [0.019, 0.08, 0.007], C, [-0.15, 0, s * 0.35]);
  }
  // one glove: the left hand, white and sequined
  const glove = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 1, sheenColor: 0xcfe8ff, emissive: 0x303038 });
  for (const a of ch.arms) if (a.side === 1) a.hand.traverse((o) => { if (o.isMesh && o.material === M.skin) o.material = glove; });
  // trousers cut high over white socks, and loafers
  for (const l of ch.legs) {
    l.shin.traverse((o) => { if (o.isMesh && o.material === M.shorts) o.position.y += 0.05; });
    part(new THREE.CylinderGeometry(0.037 * ch.shape.leg, 0.035 * ch.shape.leg, 0.13, 16), white, l.foot, [0, 0.055, -0.004]);
  }
}

// ---------- goldsuit: a gold two-piece - the shirt collar and a black tie in the jacket's V,
// lapels, buttons, a white pocket square (the gold cloth itself: look.goldSuit, character.js) ----------
function goldsuit(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  const C = ch.chest, M = ch.mat;
  const front = (yh) => prof(FRONT, yh) * kf;
  const Y = (yh) => yh - 0.3;
  const white = std(0xf4f2ec, { roughness: 0.7 }), black = std(0x0d0d0f, { roughness: 0.45 });
  const lapel = M.top.clone();
  lapel.color.setHex(0xd9a526);
  // the shirt showing in the V, its collar, and the tie
  blob(white, [0, Y(0.5), front(0.5) - 0.004], [0.036, 0.06, 0.012], C, [-0.2, 0, 0]);
  for (const s of [1, -1]) blob(white, [s * 0.02, Y(0.552), front(0.552) - 0.004], [0.026, 0.014, 0.012], C, [-0.4, 0, s * 0.55]);
  blob(black, [0, Y(0.536), front(0.536) + 0.005], [0.013, 0.011, 0.009], C);
  blob(black, [0, Y(0.46), front(0.46) + 0.006], [0.016, 0.072, 0.005], C, [-0.1, 0, 0]);
  // lapels: a darker gold strip down each side of the V
  for (const s of [1, -1]) {
    blob(lapel, [s * 0.042 * kx, Y(0.49), front(0.49) + 0.002], [0.018, 0.075, 0.007], C, [-0.15, 0, s * 0.35]);
  }
  // buttons, and a pocket square
  for (const y of [0.4, 0.34]) blob(black, [0, Y(y), front(y) + 0.004], [0.006, 0.006, 0.004], C);
  blob(white, [0.07 * kx, Y(0.5), front(0.5) + 0.003], [0.016, 0.009, 0.005], C, [0, 0, 0.2]);
}

// ---------- the suit: collar + tie, tactical vest, hockey mask ----------
function suit(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7), kx = Math.pow(B, 0.55);
  const C = ch.chest;
  const front = (yh) => prof(FRONT, yh) * kf, back = (yh) => prof(BACK, yh) * kb;
  const Y = (yh) => yh - 0.3; // hips space -> chest group
  const white = std(0xf2f2ee, { roughness: 0.7 }), red = std(0xb3121a, { roughness: 0.45 });
  // shirt collar showing in the jacket's V, and the tie
  blob(white, [0, Y(0.548), front(0.548) - 0.006], [0.042, 0.03, 0.02], C, [-0.5, 0, 0]);
  blob(red, [0, Y(0.533), front(0.533) + 0.005], [0.015, 0.013, 0.01], C);
  blob(red, [0, Y(0.44), front(0.44) + 0.004], [0.019, 0.095, 0.006], C, [-0.11, 0, 0]);

  // the vest: front and back plates, side panels, shoulder straps, magazine pouches
  const vest = std(0x2b3024, { roughness: 0.92 }), strap = std(0x1d211a, { roughness: 0.9 });
  const w = 0.25 * kx;
  part(new RoundedBoxGeometry(w, 0.23, 0.035, 2, 0.012), vest, C, [0, Y(0.31), front(0.33) + 0.014], [-0.04, 0, 0]);
  part(new RoundedBoxGeometry(w, 0.25, 0.03, 2, 0.012), vest, C, [0, Y(0.33), -back(0.33) - 0.012], [0.03, 0, 0]);
  for (const s of [1, -1]) {
    part(new RoundedBoxGeometry(0.03, 0.12, (front(0.28) + back(0.28)) * 0.95, 2, 0.01), strap, C, [s * 0.148 * kx, Y(0.27), (front(0.28) - back(0.28)) / 2]);
    part(new RoundedBoxGeometry(0.045, 0.014, (front(0.5) + back(0.5)) + 0.03, 2, 0.006), strap, C, [s * 0.085 * kx, Y(0.556), (front(0.5) - back(0.5)) / 2], [0, 0, 0]);
  }
  for (const x of [-0.07, 0, 0.07]) part(new RoundedBoxGeometry(0.058, 0.075, 0.03, 2, 0.008), strap, C, [x * kx, Y(0.235), front(0.25) + 0.038]);

  hockeyMask(ch);
}

/**
 * A hockey mask over the face: a white shell, eye holes, breathing holes, red chevrons.
 * jason: Jason Voorhees' own - an old yellowed off-white, rows of holes all over it, the three
 * red chevrons (forehead and cheeks) and black straps round the back of the head.
 */
export function hockeyMask(ch, jason = false) {
  const F = ch.face;
  const mask = new THREE.MeshStandardMaterial({ color: jason ? 0xe6dfc8 : 0xf4f2ea, roughness: jason ? 0.55 : 0.35, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20, Math.PI / 2 - 1.05, 2.1, 0.4, 2.15), mask);
  shell.scale.set(0.086, 0.118, 0.13);
  shell.position.set(0, -0.005, 0);
  F.add(shell);
  // a point on the shell
  const on = (x, y) => 0.13 * Math.sqrt(Math.max(0, 1 - (x / 0.086) ** 2 - ((y + 0.005) / 0.118) ** 2));
  const hole = std(0x0c0c0c, { roughness: 0.9 });
  for (const s of [1, -1]) blob(hole, [s * 0.029, 0.013, on(s * 0.029, 0.013)], [0.016, 0.011, 0.006], F, [0, s * 0.25, 0]);
  const dots = [];
  const HOLES = jason
    ? [[-0.012, -0.04], [0, -0.04], [0.012, -0.04], [-0.006, -0.052], [0.006, -0.052], [-0.012, -0.064], [0, -0.064], [0.012, -0.064], [-0.006, -0.076], [0.006, -0.076],
      [-0.028, -0.03], [0.028, -0.03], [-0.03, -0.045], [0.03, -0.045], [-0.026, -0.06], [0.026, -0.06],
      [-0.012, 0.045], [0, 0.05], [0.012, 0.045], [-0.022, 0.07], [0.022, 0.07], [-0.048, 0.03], [0.048, 0.03], [-0.05, 0.005], [0.05, 0.005]]
    : [[-0.012, -0.045], [0, -0.045], [0.012, -0.045], [-0.006, -0.058], [0.006, -0.058], [-0.012, -0.071], [0, -0.071], [0.012, -0.071], [-0.03, -0.03], [0.03, -0.03]];
  for (const [x, y] of HOLES) dots.push(blob(hole, [x, y, on(x, y)], [0.0032, 0.0032, 0.003], F));
  const chev = std(0xb3121a, { roughness: 0.4 });
  const marks = [];
  // (a chevron: two little strokes meeting at a point, pointing up)
  const chevron = (x, y, sz, tilt = 0) => {
    for (const s of [1, -1]) marks.push(blob(chev, [x + s * sz * 0.45 * Math.cos(tilt), y - sz * 0.35, on(x, y) + 0.001], [sz * 0.55, sz * 0.16, 0.003], F, [0, 0, tilt - s * 0.75]));
  };
  if (jason) {
    chevron(0, 0.08, 0.026);
    chevron(-0.046, -0.018, 0.024, 0.35);
    chevron(0.046, -0.018, 0.024, -0.35);
    // the straps: round the back of the head from the temples
    const strap = std(0x141312, { roughness: 0.7 });
    for (const y of [0.05, -0.035]) {
      // (a flat ring lying round the head, only the back half of it: from one temple to the other)
      const t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 6, 28, Math.PI * 0.96), strap);
      t.scale.set(0.093, 0.106, 0.09);
      t.rotation.set(Math.PI / 2, 0, Math.PI * 1.02);
      t.position.set(0, y, -0.008);
      F.add(t);
    }
  } else {
    for (const [x, y, r] of [[-0.03, 0.058, 0.5], [0.03, 0.058, -0.5], [-0.05, -0.02, 0.9], [0.05, -0.02, -0.9], [0, 0.075, 0]]) {
      marks.push(blob(chev, [x, y, on(x, y)], [0.004, 0.012, 0.003], F, [0, 0, r]));
    }
  }
  ch.detail.push(...dots, ...marks);
  // (the face underneath doesn't show: no need to draw it)
  for (const e of ch.eyes) e.brow.visible = false;
}

// ---------- the hoodie: hood down, pouch pocket, drawstrings (the shirt is the body) ----------
function hoodie(ch) {
  const B = ch.shape.B, kf = Math.pow(B, 0.8), kb = Math.pow(B, 0.7), kx = Math.pow(B, 0.55);
  const C = ch.chest;
  const front = (yh) => prof(FRONT, yh) * kf, back = (yh) => prof(BACK, yh) * kb;
  const Y = (yh) => yh - 0.3;
  const cloth = ch.mat.top || std(0x121214, { roughness: 0.95 });
  const dark = std(0x050506, { roughness: 1 });
  // the hood, bunched behind the neck and lying on the upper back
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.03, 10, 24, Math.PI * 1.25), cloth);
  hood.rotation.set(Math.PI / 2 - 0.35, 0, Math.PI * 0.875);
  hood.position.set(0, Y(0.6), -0.01);
  hood.scale.set(1.15 * kx, 1.05, 1);
  C.add(hood);
  // its opening (dark inside) and the drop of it down the back
  blob(cloth, [0, Y(0.555), -back(0.555) - 0.018], [0.075 * kx, 0.06, 0.026], C, [0.25, 0, 0]);
  blob(dark, [0, Y(0.575), -back(0.575) - 0.002], [0.05 * kx, 0.035, 0.012], C, [0.35, 0, 0]);
  // drawstrings
  const str = std(0x2a2a2e, { roughness: 0.9 });
  const sg = new THREE.CylinderGeometry(0.0028, 0.0028, 0.085, 6);
  for (const s of [1, -1]) {
    part(sg, str, C, [s * 0.022, Y(0.5), front(0.5) + 0.006], [-0.12, 0, s * 0.06]);
    blob(str, [s * 0.024, Y(0.455), front(0.455) + 0.008], [0.0045, 0.007, 0.0045], C);
  }
  // the pouch pocket across the belly
  part(new RoundedBoxGeometry(0.17 * kx, 0.085, 0.02, 2, 0.008), cloth, C, [0, Y(0.3), front(0.3) + 0.004], [-0.03, 0, 0]);
  for (const s of [1, -1]) blob(dark, [s * 0.078 * kx, Y(0.3), front(0.3) + 0.012], [0.004, 0.036, 0.004], C, [0, 0, s * 0.4]);
  // the ribbed hem
  blob(cloth, [0, Y(0.2), (front(0.2) - back(0.2)) / 2], [0.14 * kx, 0.018, (front(0.2) + back(0.2)) / 2 + 0.006], C);
}

// ---------- cats ----------
export function taperedTail(points, r0, r1, mat, T = 24) {
  const curve = new THREE.CatmullRomCurve3(points);
  const R = 10;
  const geo = new THREE.TubeGeometry(curve, T, 1, R, false);
  const p = geo.attributes.position;
  const c = V();
  for (let k = 0; k < p.count; k++) {
    const i = Math.floor(k / (R + 1)), u = i / T;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u;
    p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r);
  }
  geo.computeVertexNormals();
  return { mesh: new THREE.Mesh(geo, mat), curve };
}

function cat(ch, kind) {
  if (kind === 'scratch') return scratchCat(ch);
  const F = ch.face, M = ch.mat;
  const cute = kind === 'cute';
  if (cute) {
    // round ears with pink insides
    const pink = std(0xf7a1b5, { roughness: 0.7 });
    const white = std(0xfff8f0, { roughness: 0.85 });
    for (const s of [1, -1]) {
      const ear = part(new THREE.ConeGeometry(0.036, 0.062, 18), M.skin, F, [s * 0.05, 0.1, -0.012], [0, 0, -s * 0.38]);
      ear.scale.z = 0.55;
      const inner = part(new THREE.ConeGeometry(0.024, 0.044, 14), pink, F, [s * 0.049, 0.097, -0.004], [0, 0, -s * 0.38]);
      inner.scale.z = 0.4;
    }
    // muzzle, cheeks, nose, whiskers
    blob(white, [0, -0.04, 0.094], [0.034, 0.024, 0.03], F);
    for (const s of [1, -1]) blob(white, [s * 0.021, -0.034, 0.1], [0.024, 0.02, 0.022], F);
    blob(pink, [0, -0.017, 0.124], [0.011, 0.0075, 0.007], F);
    const wh = std(0xffffff, { roughness: 0.5 });
    const wg = new THREE.CylinderGeometry(0.0009, 0.0005, 0.07, 5);
    const whiskers = [];
    for (const s of [1, -1]) for (const [dy, a] of [[0.004, 0.12], [-0.004, 0], [-0.012, -0.12]]) {
      whiskers.push(part(wg, wh, F, [s * 0.058, -0.03 + dy, 0.098], [0, -s * 0.35, Math.PI / 2 + s * a]));
    }
    ch.detail.push(...whiskers);
    // big round eyes with a shine
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    M.iris.color.setHex(0x1d1410);
    for (const e of ch.eyes) {
      e.eye.scale.multiplyScalar(1.4);
      e.eye.position.y += 0.004;
      e.iris.scale.set(0.011, 0.0125, 0.003);
      e.iris.position.set(e.side * 0.029, 0.014, 0.0985);
      const sh = blob(shine, [e.side * 0.029 + 0.004, 0.019, 0.1015], [0.0032, 0.0032, 0.0015], F);
      ch.detail.push(sh);
      ch.tinyFace.push(sh);
    }
    ch.head.scale.multiplyScalar(1.1);
    // a curly tail, white at the tip
    const { mesh, curve } = taperedTail([V(0, -0.02, -0.09), V(0, -0.1, -0.19), V(0, -0.07, -0.31), V(0, 0.05, -0.37), V(0.02, 0.16, -0.34)], 0.024, 0.02, M.skin);
    const tip = curve.getPointAt(1);
    swayTail(ch, mesh, [blob(white, [tip.x, tip.y, tip.z], [0.026, 0.026, 0.026], mesh)]);
  } else {
    // tall, pointed ears
    const inner = std(0x0f5e5b, { roughness: 0.8 });
    for (const s of [1, -1]) {
      const ear = part(new THREE.ConeGeometry(0.03, 0.105, 14), M.skin, F, [s * 0.047, 0.118, -0.018], [-0.08, 0, -s * 0.22]);
      ear.scale.z = 0.5;
      const ein = part(new THREE.ConeGeometry(0.019, 0.075, 12), inner, F, [s * 0.046, 0.112, -0.01], [-0.08, 0, -s * 0.22]);
      ein.scale.z = 0.35;
    }
    // a narrow muzzle, dark nose
    blob(M.skin, [0, -0.042, 0.097], [0.03, 0.022, 0.028], F);
    blob(std(0x0a3433, { roughness: 0.5 }), [0, -0.018, 0.123], [0.0095, 0.0065, 0.007], F);
    // yellow-green eyes with slit pupils
    M.eye.color.setHex(0xc9e24a);
    M.eye.emissive?.setHex(0x3d5608);
    M.iris.color.setHex(0x080808);
    for (const e of ch.eyes) {
      e.eye.scale.set(0.0135, 0.0105, 0.0118);
      e.eye.rotation.z = -e.side * 0.28;
      e.iris.scale.set(0.0022, 0.009, 0.002);
      e.brow.visible = false;
    }
    // a long thin tail, pointed
    const { mesh } = taperedTail([V(0, -0.02, -0.09), V(0, -0.1, -0.2), V(0, -0.18, -0.3), V(0.02, -0.2, -0.42), V(0.06, -0.14, -0.52)], 0.017, 0.004, M.skin);
    swayTail(ch, mesh, []);
  }
}

// ---------- Scratch Cat: orange, a white muzzle and belly, big white eyes, a wide grin ----------
function scratchCat(ch) {
  const F = ch.face, M = ch.mat, C = ch.chest, B = ch.shape.B;
  const white = std(0xfff9f0, { roughness: 0.8 });
  const ink = std(0x2a1a0c, { roughness: 0.5 });
  const kf = Math.pow(B, 0.8), kx = Math.pow(B, 0.55);
  // a big, wide head
  ch.head.scale.multiply(V(1.18, 1.08, 1.08));
  // ears: tall triangles, a paler orange inside
  const inner = std(0xffd08a, { roughness: 0.75 });
  for (const s of [1, -1]) {
    const ear = part(new THREE.ConeGeometry(0.038, 0.085, 4), M.skin, F, [s * 0.052, 0.112, -0.012], [-0.05, Math.PI / 4, -s * 0.3]);
    ear.scale.z = 0.5;
    const ein = part(new THREE.ConeGeometry(0.024, 0.058, 4), inner, F, [s * 0.051, 0.106, -0.004], [-0.05, Math.PI / 4, -s * 0.3]);
    ein.scale.z = 0.35;
  }
  // the muzzle and cheeks, white; a small dark nose
  blob(white, [0, -0.042, 0.09], [0.056, 0.034, 0.035], F);
  for (const s of [1, -1]) blob(white, [s * 0.034, -0.036, 0.086], [0.03, 0.026, 0.028], F);
  blob(ink, [0, -0.017, 0.125], [0.009, 0.0065, 0.006], F);
  // the grin: wide open, a row of white teeth along the top
  const mouthG = new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const mouth = part(mouthG, std(0x3a0f0a, { roughness: 0.6 }), F, [0, -0.037, 0.117], [0.35, 0, 0]);
  mouth.scale.set(0.044, 0.028, 0.012);
  const teeth = part(mouthG, std(0xffffff, { roughness: 0.4 }), F, [0, -0.0375, 0.1205], [0.35, 0, 0]);
  teeth.scale.set(0.038, 0.01, 0.011);
  ch.tinyFace.push(teeth);
  // whiskers: dark, three a side
  const wg = new THREE.CylinderGeometry(0.0011, 0.0006, 0.075, 5);
  const whiskers = [];
  for (const s of [1, -1]) for (const [dy, a] of [[0.006, 0.14], [-0.003, 0], [-0.012, -0.14]]) {
    whiskers.push(part(wg, ink, F, [s * 0.078, -0.028 + dy, 0.09], [0, -s * 0.3, Math.PI / 2 + s * a]));
  }
  ch.detail.push(...whiskers);
  // eyes: big white ovals side by side, a black pupil in each looking ahead, no brows
  M.eye.color.setHex(0xffffff);
  M.iris.color.setHex(0x080808);
  for (const e of ch.eyes) {
    e.eye.scale.set(0.024, 0.031, 0.014);
    e.eye.position.set(e.side * 0.025, 0.026, 0.092);
    e.iris.scale.set(0.009, 0.01, 0.003);
    e.iris.position.set(e.side * 0.021, 0.024, 0.1055);
    e.brow.visible = false;
  }
  // the white belly
  const yb = 0.28;
  blob(white, [0, Y0(yb), prof(FRONT, yb) * kf - 0.032], [0.1 * kx, 0.14, 0.05], C);
  // the tail: thick, orange, curling up behind, a little stripe near the tip
  const { mesh, curve } = taperedTail([V(0, -0.02, -0.09), V(0, -0.08, -0.22), V(0.02, 0.0, -0.33), V(0.04, 0.14, -0.35), V(0.03, 0.24, -0.3)], 0.03, 0.022, M.skin);
  const st = curve.getPointAt(0.82);
  swayTail(ch, mesh, [blob(std(0xd97a0a, { roughness: 0.8 }), [st.x, st.y, st.z], [0.028, 0.012, 0.028], mesh)]);
}
const Y0 = (yh) => yh - 0.3;

// ---------- the slugcat (Saint, Rain World) ----------
function slugcat(ch) {
  const F = ch.face, M = ch.mat;
  // lit a little from inside, like the rest of the glow in the picture
  for (const k of ['skin', 'top', 'shorts']) M[k].emissive?.copy(M[k].color).multiplyScalar(0.22);
  M.shoe.emissive?.setHex(0x6a2a00);
  // a rounder, bigger head; eyes all white and lit (no pupils, no brows)
  ch.head.scale.multiplyScalar(1.12);
  blob(M.skin, [0, 0.035, -0.01], [0.086, 0.078, 0.084], F);
  M.eye.color.setHex(0xffffff);
  M.eye.emissive?.setHex(0xffffff);
  M.eye.emissiveIntensity = 1.4;
  for (const e of ch.eyes) {
    e.eye.scale.set(0.017, 0.019, 0.012);
    e.eye.position.set(e.side * 0.032, 0.014, 0.088);
    e.iris.visible = false;
    e.brow.visible = false;
  }
  // little round ears up on top
  for (const s of [1, -1]) {
    const ear = blob(M.skin, [s * 0.052, 0.1, -0.012], [0.02, 0.034, 0.014], F, [0, 0, -s * 0.5]);
    ear.castShadow = true;
  }
  // fluff: tufts round the cheeks and crown, and at the shoulders
  const tuft = new THREE.ConeGeometry(0.014, 0.05, 6);
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) part(tuft, M.skin, F, [s * (0.078 + i * 0.002), -0.035 + i * 0.022, 0.02 - i * 0.012], [0, 0, -s * (1.4 + i * 0.2)]);
    for (let i = 0; i < 3; i++) part(tuft, M.skin, ch.chest, [s * (0.09 + i * 0.03), 0.23 - i * 0.012, -0.01], [0, 0, -s * (0.5 + i * 0.35)]);
  }
  for (let i = 0; i < 3; i++) part(tuft, M.skin, F, [(i - 1) * 0.022, 0.118, 0.01 - Math.abs(i - 1) * 0.01], [0.3, 0, (1 - i) * 0.35]);
  // the tongue: out of the mouth, up and round in a big loop, trailing down past the body.
  // it hangs off a pivot at the mouth and sways (it's a slugcat's grapple, never still)
  const tongueMat = std(0xe0606e, { roughness: 0.35, emissive: 0x4a1018 });
  const piv = new THREE.Group();
  piv.position.set(0, -0.045, 0.1);
  F.add(piv);
  const { mesh: tongue } = taperedTail([
    V(0, 0, 0), V(0.04, 0.02, 0.06), V(0.13, 0.05, 0.08), V(0.24, 0.0, 0.03), V(0.28, -0.14, -0.02),
    V(0.2, -0.3, 0.06), V(0.02, -0.4, 0.14), V(-0.16, -0.52, 0.12), V(-0.26, -0.7, 0.04), V(-0.2, -0.9, -0.02), V(-0.06, -1.02, 0.02),
  ], 0.016, 0.009, tongueMat);
  piv.add(tongue);
  // (a round tip)
  blob(tongueMat, [-0.06, -1.02, 0.02], [0.011, 0.011, 0.011], tongue);
  // the tail: thick at the root, tapering, warming to orange at the end like the feet
  const { mesh: tail, curve } = taperedTail([V(0, -0.02, -0.09), V(0, -0.12, -0.17), V(0.02, -0.26, -0.24), V(0.05, -0.4, -0.26), V(0.08, -0.52, -0.2)], 0.05, 0.012, M.skin);
  const tip = curve.getPointAt(1);
  blob(M.shoe, [tip.x, tip.y, tip.z], [0.016, 0.02, 0.016], tail);
  swayTail(ch, tail, []);
  const tailTick = ch.costumeTick;
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    tailTick(dt);
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    t += dt * (1.3 + sp * 2.5);
    // lolling: swings side to side, and trails back when running
    piv.rotation.z = Math.sin(t) * 0.12;
    piv.rotation.y = Math.sin(t * 0.7 + 1) * 0.18;
    piv.rotation.x = Math.sin(t * 1.3) * 0.05 - sp * 0.35;
  };
}

/** The tail hangs off the hips and swishes, slow when still, quicker on the move. */
export function swayTail(ch, mesh, extras) {
  const pivot = new THREE.Group();
  pivot.position.set(0, -0.02, -0.09);
  mesh.position.set(0, 0.02, 0.09);
  pivot.add(mesh);
  ch.hips.add(pivot);
  let t = Math.random() * 10;
  ch.costumeTick = (dt) => {
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    t += dt * (1.6 + sp * 3);
    pivot.rotation.y = Math.sin(t) * (0.25 + sp * 0.15);
    pivot.rotation.x = Math.sin(t * 0.5) * 0.06 - sp * 0.2;
  };
  return extras;
}

// ---------- toon outline: a black shell just outside every surface (inverted hull) ----------
const OUTLINE = new Map();
function outlineMat(color = 0x050505) {
  if (OUTLINE.has(color)) return OUTLINE.get(color);
  const O = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  OUTLINE.set(color, O);
  O.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_SKINNING
        vec3 olN = objectNormal;
      #else
        vec3 olN = normal;
      #endif
      // pushed out a fixed distance in view space, whatever the mesh's own scale
      mvPosition.xyz += normalize(normalMatrix * olN) * 0.0065;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  O.customProgramCacheKey = () => 'toon-outline';
  return O;
}
function outline(ch, color) {
  const mat = outlineMat(color);
  const tiny = new Set(ch.tinyFace);
  const roots = [ch.root, ...ch.legs.flatMap((l) => [l.thigh, l.shin, l.foot]), ...ch.arms.flatMap((a) => [a.upper, a.fore])];
  const list = [];
  for (const r of roots) r.traverse((m) => { if (m.isMesh && !m.userData.decal && !tiny.has(m)) list.push(m); });
  for (const m of list) {
    if (m.isSkinnedMesh) {
      // (the torso: a skinned twin on the same skeleton, beside it on the root)
      const o = new THREE.SkinnedMesh(m.geometry, mat);
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      o.frustumCulled = false;
      o.userData.decal = true;
      m.parent.add(o);
      o.bind(m.skeleton, m.bindMatrix);
    } else {
      // (a child: shown, hidden and cut up along with what it outlines)
      const o = new THREE.Mesh(m.geometry, mat);
      o.userData.decal = true;
      m.add(o);
    }
  }
}
