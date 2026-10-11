import * as THREE from 'three';
import { dress } from './costumes.js';
import { tube, headGeo } from './shapes.js';
import { orient, solveTwoBone } from './ik.js';
import { STEP } from './world.js';
import { Traverse } from './traverse.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _fq = new THREE.Quaternion(), _fe = new THREE.Euler();
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// ---------- geometry helpers ----------
const sphereGeo = new THREE.SphereGeometry(1, 24, 16);

function blob(mat, pos, scale, parent, rot) {
  const m = new THREE.Mesh(sphereGeo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}

function mesh(geo, mat, parent, pos = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  parent.add(m);
  return m;
}



// ---------- dimensions (meters) ----------
const THIGH = 0.44, SHIN = 0.43, ANKLE_H = 0.075;
const UPPER_ARM = 0.29, FOREARM = 0.26;
const HIP_Y = 0.97;
// what a body is built as (set once, at construction: restyle leaves these alone)
export const SHAPE_KEYS = ['sex', 'height', 'build', 'limb', 'armLen', 'legLen', 'headSize', 'handSize', 'footSize', 'neckLen', 'eyeSize'];
export const BEARDS = ['short', 'full', 'mustache', 'goatee'];
export const HAIR_STYLES = ['short', 'buzz', 'long', 'bob', 'ponytail', 'bun', 'afro', 'mohawk', 'spiky', 'mullet', 'pigtails', 'curly', 'bald'];
const WALK = 1.7, RUN = 4.8;
const _fr = new THREE.Vector3();
export const DIM = { THIGH, SHIN, ANKLE_H, UPPER_ARM, FOREARM, HIP_Y };

// ---------- the gold skin (look.gold) ----------
let GOLD_ENV = null, EYE_GLOW = null, TOON_RAMP = null;
/** Three hard light bands (look.toon). */
function toonRamp() {
  if (TOON_RAMP) return TOON_RAMP;
  TOON_RAMP = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1);
  TOON_RAMP.minFilter = TOON_RAMP.magFilter = THREE.NearestFilter;
  TOON_RAMP.needsUpdate = true;
  return TOON_RAMP;
}
/** A soft studio-ish sky for the gold to reflect (metal with nothing to mirror reads black). */
function goldEnv() {
  if (GOLD_ENV) return GOLD_ENV;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, '#cfdcea'); gr.addColorStop(0.5, '#8a8f96');
  gr.addColorStop(0.56, '#3a3834'); gr.addColorStop(1, '#1a1917');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  // a couple of bright windows for highlights to slide across
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(40, 22, 30, 20); g.fillRect(150, 30, 50, 14);
  GOLD_ENV = new THREE.CanvasTexture(c);
  GOLD_ENV.mapping = THREE.EquirectangularReflectionMapping;
  GOLD_ENV.colorSpace = THREE.SRGBColorSpace;
  return GOLD_ENV;
}
// (white: a soft pale-green glow instead of the gold body's blue)
const WHITE_GLOW = [[0, 'rgba(255,255,250,1)'], [0.18, 'rgba(225,255,200,0.75)'], [0.5, 'rgba(170,255,120,0.22)'], [1, 'rgba(120,255,80,0)']];
let WHITE_EYE_GLOW = null, YELLOW_EYE_GLOW = null;
function eyeGlow(white = false) {
  if (white === 'yellow') {
    if (YELLOW_EYE_GLOW) return YELLOW_EYE_GLOW;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,238,1)');
    gr.addColorStop(0.16, 'rgba(255,248,153,0.98)');
    gr.addColorStop(0.42, 'rgba(255,196,0,0.58)');
    gr.addColorStop(0.72, 'rgba(255,142,0,0.18)');
    gr.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    YELLOW_EYE_GLOW = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
    return YELLOW_EYE_GLOW;
  }
  if (white) {
    if (WHITE_EYE_GLOW) return WHITE_EYE_GLOW;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [k, col] of WHITE_GLOW) gr.addColorStop(k, col);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return (WHITE_EYE_GLOW = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true }));
  }
  if (EYE_GLOW) return EYE_GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(200,240,255,1)'); gr.addColorStop(0.18, 'rgba(90,180,255,0.8)');
  gr.addColorStop(0.5, 'rgba(40,110,255,0.25)'); gr.addColorStop(1, 'rgba(20,60,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  EYE_GLOW = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
  return EYE_GLOW;
}

export class Character {
  constructor(scene, look = {}) {
    this.scene = scene;
    this.pos = V();
    this.vel = V();
    this.vy = 0;
    this.grounded = true;
    this.yaw = 0;
    this.turnRate = 0;
    this.phase = 0;
    this.runF = 0;

    this.squash = 0;
    this.squashV = 0;
    this.accelF = 0;
    this.time = 0;
    this.lookYaw = 0;

    // body: sex ('m'/'f'), build (width, ~0.85 slim .. 1.4 heavy), skin, hair colour + style,
    // beard, long/short legs and sleeves. Bone lengths are shared with the physics body.
    this.look = look;
    const B = look.build ?? 1, F = look.sex === 'f';
    // height: the whole skeleton scales (the ragdoll and every IK solve use this.D)
    const S = this.S = look.height ?? 1;
    // (the FUN menu) arm / leg length, limb thickness, head size
    const kA = this.kA = look.armLen ?? 1, kL = this.kL = look.legLen ?? 1, LW = look.limb ?? 1;
    this.D = {
      THIGH: THIGH * S * kL, SHIN: SHIN * S * kL, ANKLE_H: ANKLE_H * S, UPPER_ARM: UPPER_ARM * S * kA, FOREARM: FOREARM * S * kA,
      HIP_Y: (HIP_Y + (THIGH + SHIN) * (kL - 1)) * S,
    };
    this.hipY = this.D.HIP_Y;
    this.shape = {
      B, F, LW,
      arm: Math.pow(B, 0.6) * (F ? 0.9 : 1) * LW,
      leg: Math.pow(B, 0.65) * (F ? 0.97 : 1) * LW,
    };
    this.mat = {
      skin: new THREE.MeshStandardMaterial({ color: look.skin ?? 0xd49a78, roughness: 0.62, metalness: 0 }),
      shorts: new THREE.MeshStandardMaterial({ color: look.shorts ?? 0x2c3442, roughness: 0.9 }),
      top: new THREE.MeshStandardMaterial({ color: look.top ?? 0xe8e4dc, roughness: 0.85 }),
      hair: new THREE.MeshStandardMaterial({ color: look.hair ?? 0x3a2618, roughness: 0.8 }),
      eye: new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.25 }),
      iris: new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.2 }),
      shoe: new THREE.MeshStandardMaterial({ color: look.shoe ?? 0x40454d, roughness: 0.75 }),
    };
    if (look.toon) {
      // cel-shaded: every surface in hard light/shadow bands (outlined in costumes.js)
      for (const k of Object.keys(this.mat)) {
        const m = this.mat[k];
        this.mat[k] = new THREE.MeshToonMaterial({ color: m.color, gradientMap: toonRamp() });
      }
      this.mat.iris.color.setHex(0x111111);
    }
    if (look.gold) {
      // solid gold skin, and eyes lit from inside, blue
      this.mat.skin = new THREE.MeshStandardMaterial({ color: 0xffc64a, roughness: 0.22, metalness: 1, envMap: goldEnv(), envMapIntensity: 1.25 });
      this.mat.eye = new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x3a9dff, emissiveIntensity: 1.6, roughness: 0.2 });
      this.mat.iris = new THREE.MeshStandardMaterial({ color: 0xe8f8ff, emissive: 0x8fe0ff, emissiveIntensity: 3, roughness: 0.2 });
    }
    if (look.goldSuit) {
      // a suit of shining gold cloth: jacket and trousers catch the light like metal
      for (const k of ['top', 'shorts']) this.mat[k] = new THREE.MeshStandardMaterial({ color: 0xf2c23c, roughness: 0.3, metalness: 0.85, envMap: goldEnv(), envMapIntensity: 1.2 });
    }
    if (look.silver) {
      // polished silver skin (the eyes stay their own)
      this.mat.skin = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.2, metalness: 1, envMap: goldEnv(), envMapIntensity: 1.3 });
    }

    this.buildBody();
    this.legs = [1, -1].map((side, i) => this.buildLeg(side, i * 0.5));
    this.arms = [1, -1].map((side) => this.buildArm(side));

    if (S !== 1 || kA !== 1 || kL !== 1) {
      // (the torso's skeleton is bound at unit scale, so its skin follows the scaled bones;
      // long/short limbs stretch along the bone, the hand and foot keep their size)
      this.hips.scale.setScalar(S);
      for (const l of this.legs) {
        for (const g of [l.thigh, l.shin]) g.scale.set(S, S * kL, S);
        l.foot.scale.setScalar(S);
      }
      for (const a of this.arms) {
        for (const g of [a.upper, a.fore]) g.scale.set(S, S * kA, S);
        a.hand.scale.y = 1 / kA;
      }
    }
    if (look.headSize && look.headSize !== 1) this.head.scale.setScalar(look.headSize);
    // (the FUN menu) hands, feet (longer and wider: the sole stays on the ground), neck, eyes
    const kH = look.handSize ?? 1, kF = look.footSize ?? 1, kN = look.neckLen ?? 1, kE = look.eyeSize ?? 1;
    if (kH !== 1) for (const a of this.arms) a.hand.scale.multiplyScalar(kH);
    if (kF !== 1) for (const l of this.legs) { l.foot.scale.x *= kF; l.foot.scale.z *= kF; }
    if (kN !== 1) {
      this.neckMesh.scale.y = kN;
      this.head.position.y = 0.09 + 0.12 * (kN - 1);
    }
    // costumes and special bodies (special.js): extra parts, outlines
    dress(this);
    // (after the costume: it may have moved or reshaped the eyes)
    if (kE !== 1) for (const e of this.eyes) {
      e.eye.scale.multiplyScalar(kE);
      e.iris.scale.x *= kE; e.iris.scale.y *= kE;
      e.iris.position.z = e.eye.position.z + (e.iris.position.z - e.eye.position.z) * kE;
      e.eye.position.x = e.side * (Math.abs(e.eye.position.x) + 0.004 * (kE - 1));
      e.iris.position.x = e.side * (Math.abs(e.iris.position.x) + 0.004 * (kE - 1));
    }
    const all = [this.root, ...this.legs.flatMap((l) => [l.thigh, l.shin, l.foot]), ...this.arms.flatMap((a) => [a.upper, a.fore])];
    for (const o of all) o.traverse((m) => { if (m.isMesh && !m.userData.decal) { m.castShadow = true; m.receiveShadow = true; } });
    // eyes and brows are smaller than a shadow-map texel: their shadows never show
    for (const m of this.tinyFace) m.castShadow = false;
    this.detailOn = true;
    // the meshes never move inside their bone groups (only the groups animate): skip
    // recomposing their local matrices every frame
    for (const o of all) o.traverse((m) => { if (m.isMesh) { m.updateMatrix(); m.matrixAutoUpdate = false; } });
    if (look.wardrobe) this.restyle({});

    this.update(0.016, { move: V(), run: false, jump: false, camYaw: Math.PI });
    for (const l of this.legs) { this.restPos(l, l.contact); l.footYaw = this.yaw; }
  }

  // ---------- model ----------
  buildBody() {
    const M = this.mat;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Torso joints: hips -> spine -> chest. The torso surface is ONE skinned mesh
    // (shorts + shirt share the skeleton) so it bends and twists smoothly.
    this.hips = new THREE.Group();
    this.hips.rotation.order = 'YXZ';
    this.hips.position.y = HIP_Y;
    this.root.add(this.hips);
    this.spine = new THREE.Group();
    this.spine.rotation.order = 'YXZ';
    this.spine.position.set(0, 0.1, 0);
    this.hips.add(this.spine);
    this.chest = new THREE.Group();
    this.chest.rotation.order = 'YXZ';
    this.chest.position.set(0, 0.2, 0);
    this.spine.add(this.chest);
    this.ribcage = new THREE.Group();
    this.chest.add(this.ribcage);
    this.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([this.hips, this.spine, this.chest]);

    // y is in hips space. Blend hips->spine over the lower belly, spine->chest over the upper belly.
    const weights = (y) => {
      const a = smooth(clamp((y - 0.0) / 0.2, 0, 1));
      const b = smooth(clamp((y - 0.2) / 0.2, 0, 1));
      return [1 - a, a * (1 - b), a * b];
    };
    const skinned = (geo, mat) => {
      const p = geo.attributes.position;
      const idx = [], wts = [];
      for (let i = 0; i < p.count; i++) {
        const w = weights(p.getY(i));
        idx.push(0, 1, 2, 0);
        wts.push(w[0], w[1], w[2], 0);
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
      const m = new THREE.SkinnedMesh(geo, mat);
      m.position.y = HIP_Y;
      m.frustumCulled = false;
      this.root.add(m);
      m.updateMatrixWorld(true);
      m.bind(skeleton, m.matrixWorld);
      return m;
    };

    const { B, F } = this.shape;
    const belly = Math.max(0, B - 1.05);
    const bump = (y, c, w) => Math.exp(-(((y - c) / w) ** 2));
    // widen/narrow a torso profile: hips wider for women, shoulders broader for men, a belly on
    // heavier people
    const body = (rows) => rows.map(([y, rx, rf, rb]) => {
      let kx = Math.pow(B, y < 0.45 ? 0.8 : 0.55);
      if (F) kx *= y > 0.45 ? 0.9 : y > 0.15 ? 0.92 - 0.04 * bump(y, 0.24, 0.07) : 1.08;
      // (women: a bust worked into the shirt's front profile)
      const kf = Math.pow(B, 0.8) + belly * 1.1 * bump(y, 0.2, 0.13) + (F ? 0.3 * bump(y, 0.405, 0.065) : 0);
      const kb = Math.pow(B, 0.7) * (F && y < 0.1 ? 1.1 : 1);
      return [y, rx * kx, rf * kf, rb * kb];
    });
    // shorts (pelvis, glutes via fuller back profile)
    skinned(tube(body([
      [0.185, 0.146, 0.094, 0.09],
      [0.16, 0.146, 0.092, 0.09],
      [0.1, 0.146, 0.088, 0.09],
      [0.03, 0.158, 0.088, 0.1],
      [-0.03, 0.166, 0.09, 0.114],
      [-0.08, 0.152, 0.082, 0.108],
      [-0.115, 0.11, 0.06, 0.07],
      [-0.135, 0.05, 0.04, 0.04],
    ]), { n: 2.3, capScale: 0.12, sub: 6 }), M.shorts);

    // shirt: belly -> broad flat chest -> trapezius slope to neck
    skinned(tube(body([
      [0.605, 0.055, 0.05, 0.055],
      [0.585, 0.1, 0.06, 0.068],
      [0.56, 0.15, 0.072, 0.078],
      [0.525, 0.178, 0.086, 0.088],
      [0.47, 0.176, 0.1, 0.096],
      [0.4, 0.168, 0.104, 0.1],
      [0.33, 0.156, 0.098, 0.094],
      [0.26, 0.146, 0.092, 0.088],
      [0.19, 0.134, 0.086, 0.08],
      [0.11, 0.128, 0.08, 0.076],
      [0.04, 0.122, 0.074, 0.072],
    ]), { n: 2.5, capScale: 0.3, sub: 6 }), M.top);

    // shoulder joints (fill the socket where the IK arm meets the torso)
    for (const s of [1, -1]) {
      const k = Math.pow(B, 0.5) * (F ? 0.9 : 1) * this.shape.LW;
      blob(M.top, [s * 0.162, 0.192, -0.012], [0.05 * k, 0.05 * k, 0.052 * k], this.ribcage);
    }

    // Neck
    this.neck = new THREE.Group();
    this.neck.rotation.order = 'YXZ';
    this.neck.position.set(0, 0.255, -0.005);
    this.chest.add(this.neck);
    const nk = Math.pow(B, 0.5) * (F ? 0.9 : 1);
    this.neckMesh = mesh(tube([
      [0.13, 0.043, 0.045, 0.042],
      [0.07, 0.045, 0.047, 0.046],
      [0.01, 0.05, 0.05, 0.052],
      [-0.03, 0.062, 0.056, 0.062],
    ].map(([y, a, b, c]) => [y, a * nk, b * nk, c * nk]), { caps: [false, true] }), M.skin, this.neck);

    // Head — one sculpted surface
    this.head = new THREE.Group();
    this.head.rotation.order = 'YXZ';
    this.head.position.set(0, 0.09, 0.005);
    this.neck.add(this.head);
    const face = new THREE.Group();
    face.position.set(0, 0.08, 0.012);
    this.head.add(face);
    this.face = face;
    this.eyes = [];
    mesh(headGeo(), M.skin, face);
    // small parts only worth drawing up close (see setDetail)
    this.detail = [];
    this.tinyFace = [];
    for (const s of [1, -1]) {
      const eye = blob(M.eye, [s * 0.029, 0.01, 0.083], [0.0118, 0.0118, 0.0118], face);
      const iris = blob(M.iris, [s * 0.029, 0.01, 0.0938], [0.0062, 0.0062, 0.002], face);
      const brow = blob(M.hair, [s * 0.03, 0.027, 0.097], [0.016, 0.0032, 0.005], face, [0.2, 0, s * -0.1]);
      if (this.look.ears !== false) blob(M.skin, [s * 0.077, -0.002, -0.006], [0.009, 0.025, 0.016], face, [0, s * 0.25, 0]);
      this.tinyFace.push(eye, iris, brow);
      this.detail.push(eye, iris, brow);
      this.eyes.push({ eye, iris, brow, side: s });
      if (this.look.gold || this.look.glowEyes) {
        // the glow round each eye (drawn at any distance: that's the point)
        const glow = new THREE.Sprite(eyeGlow(this.look.glowEyes === 'yellow' ? 'yellow' : this.look.glowEyes === 'neon' ? false : !this.look.gold));
        glow.position.set(s * 0.029, 0.01, 0.1);
        glow.scale.setScalar(this.look.glowEyes === 'yellow' ? 0.105 : 0.065);
        face.add(glow);
      }
    }
    this.buildHair(face);
  }

  buildHair(face) {
    const L = this.look;
    // (the hair all in one group on the head: the FUN menu's hair size scales it)
    // (scaled about the middle of the scalp, so bigger hair stays on the head)
    const pivot = (this.hairGroup = new THREE.Group()), g = new THREE.Group();
    pivot.position.set(0, 0.004, -0.004);
    g.position.set(0, -0.004, 0.004);
    pivot.add(g);
    face.add(pivot);
    if (L.hairSize && L.hairSize !== 1) pivot.scale.setScalar(L.hairSize);
    if (!L.wardrobe) {
      this.hairStyleMeshes(g, L.hairStyle || 'short');
      if (L.beard) this.beardMeshes(face, L.beard);
      return;
    }
    // the player: every style built up front, only the one worn shown (restyle)
    this.hairSets = {};
    for (const s of HAIR_STYLES) {
      const before = g.children.length;
      this.hairStyleMeshes(g, s);
      this.hairSets[s] = g.children.slice(before);
    }
    this.beardSets = {};
    for (const b of BEARDS) this.beardSets[b] = this.beardMeshes(face, b);
    for (const m of [...Object.values(this.hairSets).flat(), ...Object.values(this.beardSets).flat()]) m.userData.wardrobe = true;
  }

  /** Facial hair: 'short' stubble, a 'full' beard, a 'mustache', a 'goatee'. */
  beardMeshes(face, kind) {
    const H = this.mat.hair;
    if (kind === 'full' || kind === 'short') {
      const b = blob(H, [0, -0.052, 0.036], [0.066, 0.052, 0.066], face);
      if (kind === 'short') b.scale.multiplyScalar(0.94);
      return [b];
    }
    const out = [];
    if (kind === 'mustache' || kind === 'goatee') {
      for (const s of [1, -1]) out.push(blob(H, [s * 0.013, -0.03, 0.096], [0.019, 0.0075, 0.011], face, [0, s * 0.35, s * 0.25]));
    }
    if (kind === 'goatee') out.push(blob(H, [0, -0.078, 0.068], [0.014, 0.017, 0.012], face, [0.3, 0, 0]));
    return out;
  }

  hairStyleMeshes(face, style) {
    const M = this.mat;
    const cap = (sx = 1, sy = 1, sz = 1) => {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, 1.5), M.hair);
      hair.scale.set(0.084 * sx, 0.114 * sy, 0.104 * sz);
      hair.position.set(0, 0.004, -0.004);
      hair.rotation.x = -0.62;
      face.add(hair);
      return hair;
    };
    if (style === 'short') cap();
    else if (style === 'buzz') cap(0.995, 0.985, 0.995);
    else if (style === 'long') {
      cap(1.03, 1.02, 1.03);
      // falls behind the ears down to the shoulders
      blob(M.hair, [0, -0.05, -0.045], [0.088, 0.12, 0.062], face, [0.12, 0, 0]);
    } else if (style === 'bob') {
      cap(1.04, 1.02, 1.04);
      blob(M.hair, [0, -0.02, -0.03], [0.09, 0.075, 0.075], face);
    } else if (style === 'ponytail') {
      cap(1.01, 1.0, 1.01);
      blob(M.hair, [0, 0.02, -0.1], [0.03, 0.03, 0.03], face);
      blob(M.hair, [0, -0.05, -0.115], [0.026, 0.075, 0.026], face, [0.25, 0, 0]);
    } else if (style === 'bun') {
      cap(1.01, 1.0, 1.01);
      blob(M.hair, [0, 0.085, -0.07], [0.042, 0.04, 0.042], face);
    } else if (style === 'afro') {
      blob(M.hair, [0, 0.055, -0.035], [0.108, 0.1, 0.108], face);
    } else if (style === 'mohawk') {
      // shaved sides, a crest from the brow over to the back of the head
      cap(0.99, 0.98, 0.99);
      for (let i = 0; i < 7; i++) {
        const a = -0.35 + i * 0.36;
        blob(M.hair, [0, 0.004 + 0.1 * Math.cos(a), -0.004 - 0.1 * Math.sin(a)], [0.012, 0.048 - i * 0.003, 0.028], face, [-a, 0, 0]);
      }
    } else if (style === 'spiky') {
      cap(1.01, 1.0, 1.01);
      const cone = new THREE.ConeGeometry(0.018, 0.06, 7);
      for (let i = 0; i < 13; i++) {
        // spread over the crown, pointing out from the middle of the head
        const u = (i * 0.618) % 1, t = 0.15 + 0.85 * ((i + 0.5) / 13);
        const az = u * Math.PI * 2, el = t * 1.1;
        const dir = V(Math.sin(el) * Math.sin(az) * 0.85, Math.cos(el), -0.25 + Math.sin(el) * Math.cos(az) * 0.9).normalize();
        const m = new THREE.Mesh(cone, M.hair);
        m.position.set(dir.x * 0.085, 0.01 + dir.y * 0.1, -0.02 + dir.z * 0.095);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
        face.add(m);
      }
    } else if (style === 'mullet') {
      cap(1.01, 1.0, 1.01);
      blob(M.hair, [0, -0.07, -0.06], [0.068, 0.1, 0.05], face, [0.18, 0, 0]);
    } else if (style === 'pigtails') {
      cap(1.03, 1.02, 1.03);
      for (const s of [1, -1]) {
        blob(M.hair, [s * 0.088, 0.01, -0.045], [0.022, 0.022, 0.022], face);
        blob(M.hair, [s * 0.102, -0.055, -0.05], [0.024, 0.065, 0.024], face, [0.1, 0, s * -0.2]);
      }
    } else if (style === 'curly') {
      // a mop of little curls over the crown
      cap(1.02, 1.0, 1.02);
      for (let i = 0; i < 22; i++) {
        const u = (i * 0.618) % 1, t = (i + 0.5) / 22;
        const az = u * Math.PI * 2, el = t * 1.35;
        const x = Math.sin(el) * Math.sin(az), y = Math.cos(el), z = Math.sin(el) * Math.cos(az);
        if (z > 0.55 && y < 0.6) continue; // (not over the face)
        blob(M.hair, [x * 0.086, 0.01 + y * 0.11, -0.015 + z * 0.1], [0.026, 0.026, 0.026], face);
      }
    }
    // bald: nothing but the brows
  }

  /**
   * Change what the player is wearing, live: colours (top, bottoms, shoes, hair, skin) and,
   * for a wardrobe body, sleeves, trouser length, hairstyle and beard.
   */
  restyle(look) {
    // (what a special body is made of - special.js - never changes)
    const fixed = this.look.fixed;
    look = Object.fromEntries(Object.entries(look).filter(([k]) => !SHAPE_KEYS.includes(k) && !fixed?.includes(k)));
    const L = Object.assign(this.look, look), M = this.mat;
    for (const k of ['top', 'shorts', 'shoe', 'hair', 'skin']) if (L[k] != null && !(k === 'skin' && (L.gold || L.silver))) M[k].color.setHex(L[k]);
    // eye colour and hair size (not on a special body: its eyes and hair are its own)
    if (!fixed) {
      if (L.eyeColor != null && !L.gold && !L.toon) M.iris.color.setHex(L.eyeColor);
      if (this.hairGroup) this.hairGroup.scale.setScalar(L.hairSize || 1);
    }
    if (!L.wardrobe) return;
    const show = (list, on) => { for (const m of list) m.visible = on; };
    for (const [s, list] of Object.entries(this.hairSets)) show(list, s === (L.hairStyle || 'short'));
    for (const [b, list] of Object.entries(this.beardSets)) show(list, b === L.beard);
    // (a tank top: no sleeves at all)
    for (const [k, list] of Object.entries(this.sleeveSets)) show(list, L.sleeves !== 'tank' && k === (L.sleeves === 'long' ? 'long' : 'short'));
    for (const [k, list] of Object.entries(this.legSets)) show(list, k === (L.legs === 'long' ? 'long' : 'short'));
  }

  buildFingerSet(hand) {
    const M = this.mat;
    const fingers = [];
    const fingerGeo = (len, r) => tube([[0, r, r, r], [-len * 0.5, r * 0.95, r * 0.92, r * 0.95], [-len, r * 0.86, r * 0.8, r * 0.86]], { seg: 12, sub: 2 });
    const defs = [[0.027, 1.0, 0.0092], [0.009, 1.08, 0.0095], [-0.009, 1.02, 0.009], [-0.026, 0.82, 0.0082]];
    for (const [z, s, r] of defs) {
      const f1 = new THREE.Group();
      f1.position.set(0, -0.09, z);
      hand.add(f1);
      this.detail.push(mesh(fingerGeo(0.044 * s, r), M.skin, f1));
      const f2 = new THREE.Group();
      f2.position.set(0, -0.044 * s, 0);
      f1.add(f2);
      this.detail.push(mesh(fingerGeo(0.038 * s, r * 0.88), M.skin, f2));
      fingers.push([f1, f2]);
    }
    const t1 = new THREE.Group();
    t1.position.set(-0.004, -0.018, 0.028);
    t1.rotation.set(-0.7, 0, -0.35);
    hand.add(t1);
    this.detail.push(mesh(tube([[0.01, 0.013, 0.015, 0.013], [-0.02, 0.013, 0.014, 0.012], [-0.045, 0.011, 0.011, 0.011]], { seg: 12, sub: 2 }), M.skin, t1));
    const t2 = new THREE.Group();
    t2.position.set(0, -0.045, 0);
    t1.add(t2);
    this.detail.push(mesh(fingerGeo(0.032, 0.0105), M.skin, t2));
    return { fingers, thumb: [t1, t2] };
  }

  buildArm(side) {
    const M = this.mat;
    const upper = new THREE.Group();
    const fore = new THREE.Group();
    this.scene.add(upper, fore);

    // deltoid -> biceps/triceps -> elbow, one surface
    const ka = this.shape.arm;
    const W = (rows, k) => rows.map(([y, a, b, c]) => [y, a * k, b * k, c * k]);
    const longSl = this.look.sleeves === 'long';
    const upperRows = W([
      [0.02, 0.05, 0.05, 0.05],
      [-0.04, 0.052, 0.05, 0.052],
      [-0.1, 0.044, 0.046, 0.046],
      [-0.17, 0.04, 0.044, 0.042],
      [-0.24, 0.036, 0.036, 0.036],
      [-UPPER_ARM, 0.034, 0.03, 0.034],
    ], ka);
    mesh(tube(upperRows), M.skin, upper);
    // t-shirt sleeve (or a long one, all the way down); the player's wardrobe builds both
    const wd = !!this.look.wardrobe;
    if (wd) this.sleeveSets ||= { short: [], long: [] };
    const sleeve = (long) => {
      const m = mesh(tube(long ? W(upperRows, 1.1).map((r, i) => (i === 0 ? [0.03, r[1], r[2], r[3]] : r)) : W([
        [0.03, 0.054, 0.054, 0.054],
        [-0.04, 0.056, 0.054, 0.056],
        [-0.1, 0.049, 0.05, 0.05],
        [-0.12, 0.048, 0.049, 0.049],
      ], ka), { caps: [true, false] }), M.top, upper);
      if (wd) { m.userData.wardrobe = true; this.sleeveSets[long ? 'long' : 'short'].push(m); }
    };
    if (wd) { sleeve(false); sleeve(true); } else sleeve(longSl);

    // forearm: bulky near elbow, flat at wrist
    const foreRows = W([
      [0.01, 0.036, 0.032, 0.036],
      [-0.05, 0.04, 0.036, 0.036],
      [-0.12, 0.034, 0.03, 0.03],
      [-0.2, 0.028, 0.022, 0.022],
      [-FOREARM, 0.025, 0.017, 0.017],
    ], ka);
    mesh(tube(foreRows), M.skin, fore);
    if (longSl || wd) {
      const m = mesh(tube(W(foreRows.slice(0, 4), 1.14), { caps: [true, false] }), M.top, fore);
      if (wd) { m.userData.wardrobe = true; this.sleeveSets.long.push(m); }
    }

    const hand = new THREE.Group();
    hand.position.set(0, -FOREARM, 0);
    hand.scale.x = side; // mirror so palm faces the body
    fore.add(hand);
    // palm: x = thickness, z = width (thumb side forward)
    mesh(tube([
      [0.005, 0.017, 0.02, 0.02],
      [-0.025, 0.02, 0.034, 0.032],
      [-0.065, 0.018, 0.04, 0.038],
      [-0.092, 0.013, 0.04, 0.037],
    ], { seg: 20, capScale: 0.5 }), M.skin, hand);
    const f = this.buildFingerSet(hand);

    return { side, upper, fore, hand, ...f, handPos: null, elbow: V(), wrist: V() };
  }

  buildLeg(side, offset) {
    const M = this.mat;
    const thigh = new THREE.Group();
    const shin = new THREE.Group();
    const foot = new THREE.Group();
    foot.rotation.order = 'YXZ';
    this.scene.add(thigh, shin, foot);

    // thigh: quads in front, hamstrings behind, tapering into the knee
    const kl = this.shape.leg;
    const W = (rows, k) => rows.map(([y, a, b, c]) => [y, a * k, b * k, c * k]);
    const longP = this.look.legs === 'long';
    const thighRows = W([
      [0.02, 0.084, 0.084, 0.084],
      [-0.08, 0.08, 0.084, 0.078],
      [-0.2, 0.07, 0.076, 0.066],
      [-0.33, 0.058, 0.06, 0.052],
      [-THIGH, 0.05, 0.05, 0.046],
    ], kl);
    mesh(tube(thighRows), M.skin, thigh);
    const wd = !!this.look.wardrobe;
    if (wd) this.legSets ||= { short: [], long: [] };
    const tag = (m, long) => { if (wd) { m.userData.wardrobe = true; this.legSets[long ? 'long' : 'short'].push(m); } return m; };
    const leg = (long) => tag(mesh(tube(long ? W(thighRows, 1.1).map((r, i) => (i === 0 ? [0.03, r[1], r[2], r[3]] : r)) : W([
      [0.03, 0.092, 0.092, 0.092],
      [-0.08, 0.088, 0.09, 0.086],
      [-0.17, 0.08, 0.084, 0.076],
      [-0.19, 0.079, 0.082, 0.075],
    ], kl), { caps: [true, false] }), M.shorts, thigh), long);
    if (wd) { leg(false); leg(true); } else leg(longP);

    // shin: calf bulge behind, slim ankle
    const shinRows = W([
      [0.015, 0.05, 0.05, 0.048],
      [-0.06, 0.047, 0.042, 0.056],
      [-0.14, 0.044, 0.036, 0.062],
      [-0.24, 0.036, 0.032, 0.042],
      [-0.34, 0.03, 0.028, 0.03],
      [-SHIN, 0.029, 0.027, 0.03],
    ], kl);
    mesh(tube(shinRows), M.skin, shin);
    // trouser leg: loose, down over the top of the shoe
    if (longP || wd) tag(mesh(tube(shinRows.map(([y, a, b, c], i) => [i === 0 ? 0.04 : i === 5 ? -SHIN + 0.035 : y, Math.max(a * 1.18, 0.045), Math.max(b * 1.2, 0.045), Math.max(c * 1.15, 0.045)]), { caps: [true, false] }), M.shorts, shin), true);

    // shoe: origin at ankle, +Z forward, sole at -ANKLE_H
    const shoeRear = mesh(tube([
      [0, 0.034, 0.03, 0.033],
      [-0.03, 0.04, 0.05, 0.033],
      [-0.08, 0.043, 0.052, 0.033],
      [-0.14, 0.047, 0.036, 0.033],
      [-0.2, 0.048, 0.026, 0.033],
    ], { capScale: 0.4 }), M.shoe, foot, [0, -0.042, -0.07]);
    shoeRear.rotation.x = -Math.PI / 2;
    const toe = new THREE.Group();
    toe.position.set(0, -ANKLE_H, 0.12);
    foot.add(toe);
    const shoeFront = mesh(tube([
      [0, 0.048, 0.026, 0.033],
      [-0.05, 0.046, 0.023, 0.033],
      [-0.09, 0.036, 0.017, 0.03],
    ], { capScale: 0.7 }), M.shoe, toe, [0, 0.033, -0.01]);
    shoeFront.rotation.x = -Math.PI / 2;

    return {
      side, offset, thigh, shin, foot, toe,
      contact: V(), from: V(), target: V(), fromYaw: 0, footYaw: 0,
      swinging: false, pitch: 0, knee: V(), ankle: V(),
    };
  }

  /** Restart locomotion from a standstill at pos facing yaw (e.g. after ragdolling). */
  reset(pos, yaw) {
    const { HIP_Y } = this.D;
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.action = null;
    this.kick = null;
    this.cF = 0;
    this.crouchHold = 0;
    const sup = this.support(this.pos.y + 0.1);
    this.grounded = this.pos.y - sup <= 0.05;
    if (this.grounded) this.pos.y = sup;
    this.yaw = yaw;
    this.turnRate = 0;
    this.accelF = 0;
    this.runF = 0;
    this.freq = 0;
    this.settling = false;
    this.stride = V();
    this.hipY = HIP_Y - 0.05;
    this.hipYV = 0;
    this.squash = 0;
    this.squashV = 0;
    for (const l of this.legs) {
      l.swinging = false;
      this.restPos(l, l.contact);
      l.footYaw = yaw;
      l.pitch = 0;
    }
    for (const a of this.arms) a.handPos = null;
  }

  /** Far away: skip drawing the fingers and eyes (a pixel or two by then). They still get hit. */
  setDetail(on) {
    if (on === this.detailOn) return;
    this.detailOn = on;
    for (const m of this.detail) m.visible = on;
  }

  /**
   * The whole body drawn or not. The limbs aren't children of root (each bone group sits in
   * the scene on its own), so hiding root alone leaves arms and legs standing about: this
   * covers the complete set. Only the groups' own flags change - nothing is rebuilt or freed,
   * so a pooled body comes back instantly.
   */
  get visualGroups() {
    return this._visSet ||= [this.root, ...this.arms.flatMap((a) => [a.upper, a.fore]), ...this.legs.flatMap((l) => [l.thigh, l.shin, l.foot])];
  }
  get shown() { return this.root.visible; }
  setVisible(on) {
    on = !!on;
    for (const g of this.visualGroups) g.visible = on;
  }

  // ---------- helpers ----------
  forward(out = V()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  local(x, y, z, out = V()) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return out.set(x * c + z * s, y, -x * s + z * c);
  }
  // lateral distance of a point from the body's midline, positive on the leg's own side
  sideOf(leg, p) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return ((p.x - this.pos.x) * c - (p.z - this.pos.z) * s) * leg.side;
  }
  keepSide(leg, p, min) {
    const d = this.sideOf(leg, p);
    if (d < min) {
      const k = (min - d) * leg.side;
      p.x += Math.cos(this.yaw) * k;
      p.z -= Math.sin(this.yaw) * k;
    }
  }
  restPos(leg, out = V()) {
    // crouched: feet wider, one a little ahead of the other
    const c = this.cF || 0;
    this.local(leg.side * (0.1 + c * 0.06), 0, leg.side * c * 0.09, out);
    out.add(this.pos);
    return out.setY(this.gAt(out.x, out.z));
  }
  /** Surface height for a foot at (x, z): anything up to a step above the body's feet. */
  gAt(x, z, r = 0.05) {
    return this.colliders ? this.colliders.groundAt(x, z, this.pos.y + STEP + 0.02, r) : 0;
  }
  /** Surface the body stands on (a little forgiving at edges). */
  support(fromY = this.pos.y + STEP) {
    return this.colliders ? this.colliders.groundAt(this.pos.x, this.pos.z, fromY, 0.12) : 0;
  }

  // ---------- kicks ----------
  /**
   * Start a kick with leg `leg` (0/1): 'front' (a push kick at the belly), 'low' (at the shins,
   * from a crouch), 'stomp' (straight down on someone lying there). kick.js does the hitting.
   */
  startKick(kind = 'front', leg = 1) {
    if (this.kick || !this.grounded || this.action) return false;
    const l = this.legs[leg];
    const s = l.side, S = this.S;
    // body-frame foot keys [x (side), y, z (forward)], pitch, time
    const K = {
      front: [[s * 0.09, 0.42, 0.2, 0.7, 0.17], [s * 0.05, 0.62, 0.74, -0.25, 0.1], [s * 0.05, 0.6, 0.72, -0.25, 0.07]],
      low: [[s * 0.08, 0.26, 0.12, 0.6, 0.14], [s * 0.05, 0.14, 0.72, 0.2, 0.09], [s * 0.05, 0.14, 0.7, 0.2, 0.06]],
      // (knee pulled right up, then driven straight down through them)
      stomp: [[s * 0.08, 0.64, 0.26, -0.15, 0.22], [s * 0.07, 0.0, 0.45, 0, 0.065], [s * 0.07, -0.02, 0.45, 0, 0.13]],
    }[kind].map(([x, y, z, pitch, dt]) => ({ p: V(x, y * S, z * S), pitch, dt }));
    const back = 0.22;
    const live0 = K[0].dt, live1 = live0 + K[1].dt + K[2].dt;
    // where the foot starts, in the body frame
    const c = this.local(0, 0, 0, V());
    const d = l.contact.clone().sub(this.pos);
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    c.set(d.x * cs - d.z * sn, d.y, d.x * sn + d.z * cs);
    this.kick = { kind, leg, t: 0, keys: [{ p: c, pitch: l.pitch, dt: 0 }, ...K], dur: live1 + back, live0, live1, back };
    l.swinging = false;
    return true;
  }
  /** Live window of the kick (the foot is travelling at them). */
  get kickLive() { const k = this.kick; return !!k && k.t >= k.live0 * 0.8 && k.t <= k.live1; }
  kickLean() {
    const k = this.kick, e = Math.sin(Math.PI * clamp(k.t / (k.live1 + 0.05), 0, 1));
    return k.kind === 'front' ? -0.28 * e : k.kind === 'stomp' ? 0.18 * e : -0.1 * e;
  }
  kickLeg(l, rest, dt) {
    const k = this.kick, keys = k.keys;
    let t = k.t, i = 1;
    const out = V();
    let pitch;
    while (i < keys.length && t > keys[i].dt) { t -= keys[i].dt; i++; }
    if (i < keys.length) {
      // (the strike itself accelerates all the way in: full speed when it lands)
      const a = keys[i - 1], b = keys[i], u = clamp(t / b.dt, 0, 1);
      const e = i === 2 ? (k.kind === 'stomp' ? u * u : u * u * (1.6 - 0.6 * u)) : smooth(u);
      out.lerpVectors(a.p, b.p, e);
      pitch = lerp(a.pitch, b.pitch, e);
      this.local(out.x, 0, out.z, l.contact).add(this.pos);
      l.contact.y = this.pos.y + out.y;
    } else {
      // back down to where it stands
      const e = smooth(clamp(t / k.back, 0, 1)), last = keys[keys.length - 1];
      this.local(last.p.x, 0, last.p.z, out).add(this.pos);
      l.contact.lerpVectors(out.setY(this.pos.y + last.p.y), rest, e);
      l.contact.y += Math.sin(Math.PI * e) * 0.06;
      pitch = lerp(last.pitch, 0, e);
    }
    l.pitch = pitch;
    l.footYaw = this.yaw;
  }

  // ---------- simulation ----------
  update(dt, ctrl, colliders = null) {
    const { THIGH, SHIN, ANKLE_H, UPPER_ARM, FOREARM, HIP_Y } = this.D;
    this.flightHit = false;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.costumeTick?.(dt);
    if (colliders) this.colliders = colliders;

    // --- climbing / vaulting take over the whole body ---
    const spd0 = Math.hypot(this.vel.x, this.vel.z);
    const autoRun = this.grounded && ctrl.run && spd0 > 3 && ctrl.move.lengthSq() > 0.25;
    if (!this.action && colliders && ((ctrl.jump && !ctrl.jumpPower) || !this.grounded || autoRun)) {
      const a = Traverse.try(this, ctrl, colliders, !ctrl.jump && this.grounded);
      if (a) { this.action = a; ctrl = { ...ctrl, jump: false }; }
    }
    if (this.action) {
      if (this.action.update(dt, ctrl)) return;
      this.action = null;
      this.airT = 1;
      ctrl = { ...ctrl, jump: false };
    }

    // --- crouch: eased in / out; held down briefly while picking something up ---
    this.crouchHold = Math.max(0, (this.crouchHold || 0) - dt);
    // (dip: a partial knee bend asked for by the arms - an overhead chop driving into the floor)
    // (a stomp: the body drops its weight down through the foot)
    const sK = this.kick?.kind === 'stomp' ? this.kick : null;
    const sDip = sK ? 0.4 * smooth(clamp((sK.t - sK.live0 * 0.7) / 0.08, 0, 1)) * (1 - smooth(clamp((sK.t - sK.live1) / sK.back, 0, 1))) : 0;
    const wantC = this.grounded ? Math.max(ctrl.crouch || this.crouchHold > 0 ? 1 : 0, this.dip || 0, sDip) : 0;
    this.cF = lerp(this.cF || 0, wantC, damp(wantC ? (sDip > 0.05 ? 24 : 9) : 7, dt));
    const cF = this.cF;
    // --- a kick in progress (kick.js starts them): the standing leg stays planted ---
    const K = this.kick;
    // (hit-stop: a kick that lands stays in them a beat)
    if (K) {
      K.t += dt * (K.stop > 0 ? 0.06 : 1);
      if (K.stop > 0) K.stop -= dt;
      if (K.t >= K.dur || !this.grounded) { this.kick = null; for (const l of this.legs) l.swinging = false; }
    }

    // --- on all fours (a special body's sprint: look.allFours, ctrl.fours): eased in and out ---
    const wantF = ctrl.fours && this.look.allFours && this.grounded && !this.kick && cF < 0.3 ? 1 : 0;
    this.fourF = lerp(this.fourF || 0, wantF, damp(wantF ? 6 : 8, dt));
    const fourF = this.fourF < 0.002 ? 0 : this.fourF;
    // --- locomotion ---
    let wishSpeed = ctrl.run && cF < 0.3 ? RUN : WALK;
    if (fourF) wishSpeed = lerp(wishSpeed, RUN * 2.1, fourF);
    wishSpeed = lerp(wishSpeed, 1.25, clamp(cF * 1.4, 0, 1));
    if (this.look.vampire) wishSpeed *= 1.4; // (a vampire: vampire.js)
    if (this.kick) wishSpeed *= 0.12;
    const pvx = this.vel.x, pvz = this.vel.z;
    const hasIn = ctrl.move.lengthSq() > 0.01;
    if (ctrl.flight) {
      const k = damp(9, dt), speed = ctrl.flightSpeed || 6.2;
      this.vel.x += (ctrl.move.x * speed - this.vel.x) * k;
      this.vel.z += (ctrl.move.z * speed - this.vel.z) * k;
    } else if (this.grounded) {
      const k = damp(8, dt);
      this.vel.x += (ctrl.move.x * wishSpeed - this.vel.x) * k;
      this.vel.z += (ctrl.move.z * wishSpeed - this.vel.z) * k;
    } else if (hasIn) {
      // air control steers but never bleeds off momentum
      const k = damp(2.2, dt);
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.vel.x += (ctrl.move.x * wishSpeed - this.vel.x) * k;
      this.vel.z += (ctrl.move.z * wishSpeed - this.vel.z) * k;
      const sp2 = Math.hypot(this.vel.x, this.vel.z);
      if (sp2 < sp && sp2 > 1e-4) { this.vel.x *= sp / sp2; this.vel.z *= sp / sp2; }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // a step into a punch (asked for by the arms, a frame at a time)
    if (this.lunge) {
      // (look.lungeK: a body that lunges further - the queen bee)
      const lk = this.look.lungeK || 1;
      if (this.grounded) { this.pos.x += this.lunge.x * lk * dt; this.pos.z += this.lunge.z * lk * dt; }
      this.lunge = null;
    }
    // Airborne and wing flight use the same world collision resolution as walking.
    const beforeResolveX = this.pos.x, beforeResolveZ = this.pos.z;
    if (colliders) colliders.resolve(this.pos, ctrl.flight ? 0.46 : 0.28, this.vel, ctrl.flight ? this.pos.y : this.grounded ? this.pos.y : this.pos.y - STEP);
    if (ctrl.flight && (this.pos.x - beforeResolveX) ** 2 + (this.pos.z - beforeResolveZ) ** 2 > 0.0025 && Math.hypot(this.vel.x, this.vel.z) > 2.4) this.flightHit = true;

    if (ctrl.flight) {
      const nextY = this.pos.y + (ctrl.vertical || 0) * (ctrl.flightSpeedY || 5.2) * dt;
      const floor = this.support(nextY + 0.03);
      if ((ctrl.vertical || 0) <= 0 && nextY <= floor + 0.02) {
        this.pos.y = floor;
        this.grounded = true;
        this.jumped = false;
        this.vy = 0;
      } else {
        this.pos.y = Math.max(floor, nextY);
        this.grounded = false;
        this.jumped = true;
        this.vy = 0;
      }
    } else {
      // coyote time: a jump just after running off an edge still counts
      this.airT = this.grounded ? 0 : (this.airT ?? 0) + dt;
      const canJump = this.grounded || (this.airT < 0.13 && !this.jumped);
      if (canJump && ctrl.jump) {
        // running jumps go higher and longer
        this.vy = 4.4 + spd0 * 0.14;
        this.vel.x *= 1.08; this.vel.z *= 1.08;
        // a charged super jump (look.superJump): up to ~12m straight up, a longer carry forward
        if (ctrl.jumpPower) { const k = ctrl.jumpPower; this.vy += 13.5 * k; this.vel.x *= 1 + 0.5 * k; this.vel.z *= 1 + 0.5 * k; }
        this.grounded = false;
        this.jumped = true;
        for (const l of this.legs) l.swinging = false;
      }
      if (this.grounded) {
        this.jumped = false;
        const sup = this.support();
        if (sup < this.pos.y - 0.03) {
          // ran off an edge
          this.grounded = false;
          this.vy = 0;
          for (const l of this.legs) l.swinging = false;
        } else if (sup > this.pos.y) {
          // stepped up onto something low: hips stay put and the spring catches up
          this.hipY -= sup - this.pos.y;
          this.pos.y = sup;
        }
      }
      if (!this.grounded) {
        const fromY = this.pos.y;
        this.vy -= 13 * dt;
        this.pos.y += this.vy * dt;
        const sup = this.vy <= 0 ? this.support(fromY + 0.02) : -Infinity;
        if (this.pos.y <= sup) {
          this.pos.y = sup;
          // big drop with speed: roll out of it and keep the momentum
          if (this.vy < -6.2 && colliders) {
            const r = Traverse.roll(this, colliders, sup);
            if (r) {
              this.action = r;
              this.grounded = true;
              this.vy = 0;
              r.update(dt, ctrl);
              return;
            }
          }
          this.grounded = true;
          this.squashV -= Math.min(2.2, -this.vy * 0.35);
          for (const l of this.legs) {
            l.contact.y = this.gAt(l.contact.x, l.contact.z);
            l.footYaw = this.yaw;
          }
          this.vy = 0;
        }
      }
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fwd = this.forward();
    const fAcc = dt > 0 ? ((this.vel.x - pvx) * fwd.x + (this.vel.z - pvz) * fwd.z) / dt : 0;
    this.accelF = lerp(this.accelF, clamp(fAcc, -8, 8), damp(6, dt));

    // Facing
    let dy = 0;
    if (ctrl.faceYaw !== undefined && !this.action) {
      // aiming: square up to the aim direction, strafing
      dy = wrapAngle(ctrl.faceYaw - this.yaw) * damp(12, dt);
      this.yaw = wrapAngle(this.yaw + dy);
    } else if (speed > 0.15 && ctrl.move.lengthSq() > 0.01) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      dy = wrapAngle(target - this.yaw) * damp(7, dt);
      this.yaw = wrapAngle(this.yaw + dy);
    }
    this.turnRate = lerp(this.turnRate, dt > 0 ? dy / dt : 0, damp(8, dt));

    // Landing squash spring
    // (in short fixed steps: stable however long the frame)
    for (let t = dt; t > 1e-6; t -= 1 / 120) {
      const h = Math.min(t, 1 / 120);
      this.squashV += (-this.squash * 120 - this.squashV * 14) * h;
      this.squash += this.squashV * h;
    }

    // --- gait ---
    this.runF = lerp(this.runF, clamp((speed - WALK) / (RUN - WALK), 0, 1), damp(5, dt));
    const runF = this.runF;
    const cycleLen = lerp(1.25, 2.75, runF);  // ~210 steps/min at full run
    const sf = lerp(0.4, 0.72, runF);        // short ground contact + flight when running
    const swingH = lerp(0.075, 0.13, runF);
    const moveF = clamp(speed / 1.0, 0, 1);

    // Decide whether feet need to reposition. Hysteresis: start stepping at a larger
    // error than the one we stop at, so stepping doesn't flicker on and off.
    const rest = V();
    let anySwing = false, worst = 0;
    for (const l of this.legs) {
      if (l.swinging) anySwing = true;
      this.restPos(l, rest);
      const err = Math.max(
        l.contact.distanceTo(rest) / 0.08,
        Math.abs(wrapAngle(l.footYaw - this.yaw)) / 0.3,
        (0.08 - this.sideOf(l, l.contact)) / 0.03);
      worst = Math.max(worst, err);
    }
    if (worst > 1) this.settling = true;
    else if (worst < 0.5 && !anySwing) this.settling = false;
    const stepping = speed > 0.05 || this.settling || anySwing;

    // how much of the motion is sideways to the facing (strafing, side steps): those steps are
    // quicker and shorter, and each foot may land further out to its own side
    const latSpeed = Math.abs(this.vel.x * fwd.z - this.vel.z * fwd.x);
    const latF = speed > 0.05 ? clamp(latSpeed / speed, 0, 1) * clamp(latSpeed / 0.6, 0, 1) : 0;
    let want = 0;
    if (stepping) {
      const turnStep = clamp(1.25 + Math.abs(this.turnRate) * 0.25, 1.25, 2.0);
      want = Math.max(speed / (cycleLen * lerp(1, 0.72, latF)), lerp(turnStep, 1.15, clamp(speed / 1, 0, 1)));
    }
    // cadence changes smoothly; it may only drop to zero once no foot is in the air
    if (want === 0 && !anySwing) this.freq = 0;
    else this.freq = lerp(this.freq || want, Math.max(want, anySwing ? 0.9 : 0), damp(4, dt));
    const freq = this.freq;
    if (this.grounded) this.phase = (this.phase + freq * dt) % 1;
    const strideWant = freq > 0 ? this.vel.clone().multiplyScalar(1 / freq) : V();
    this.stride = (this.stride || V()).lerp(strideWant, damp(6, dt));
    const stride = this.stride;
    const desired = V();

    const hipJ = V(), tmpV = V();
    for (const l of this.legs) {
      const lp = (this.phase + l.offset) % 1;
      this.restPos(l, rest);
      if (this.kick && this.grounded) {
        if (l === this.legs[this.kick.leg]) this.kickLeg(l, rest, dt);
        else { l.swinging = false; l.pitch = lerp(l.pitch, 0, damp(20, dt)); }
        continue;
      }
      if (!this.grounded) {
        // tuck feet under hips while airborne
        this.local(l.side * 0.11, 0, 0.06 + l.side * 0.05, hipJ).add(this.pos);
        hipJ.y = this.pos.y + lerp(0.2, 0.1, clamp(this.vy / 4, 0, 1)) + (l.side > 0 ? 0.08 : 0);
        l.contact.lerp(hipJ, damp(14, dt));
        l.footYaw = wrapAngle(l.footYaw + wrapAngle(this.yaw - l.footYaw) * damp(10, dt));
        l.pitch = lerp(l.pitch, 0.35, damp(8, dt));
        continue;
      }
      const inSwing = lp < sf && freq > 0;
      const startSwing = inSwing && !l.swinging;
      if (startSwing) {
        l.swinging = true;
        l.from.copy(l.contact).setY(this.gAt(l.contact.x, l.contact.z));
        l.fromYaw = l.footYaw;
        l.fromBody = (l.fromBody || V()).copy(this.pos);
      }
      if (l.swinging) {
        const swingDone = !inSwing;
        const t = swingDone ? 1 : lp / sf;
        desired.copy(rest).addScaledVector(stride, swingDone ? (1 - sf) / 2 : (sf - lp) + (1 - sf) / 2);
        // keep landing within reach and on the foot's own side
        // Clamp in the body frame: forward/back reach grows with speed, sideways stays tight.
        {
          const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
          const dx = desired.x - rest.x, dz = desired.z - rest.z;
          let fwdOff = dx * sn + dz * c;             // along facing
          let sideOff = dx * c - dz * sn;            // along body +X
          const reach = clamp(0.16 + speed * 0.14, 0.16, 0.6);
          fwdOff = clamp(fwdOff, -reach * 0.6, reach);
          const sideReach = lerp(0.1, 0.3, latF);
          sideOff = clamp(sideOff, -sideReach, sideReach);
          desired.set(rest.x + fwdOff * sn + sideOff * c, 0, rest.z + fwdOff * c - sideOff * sn);
        }
        this.keepSide(l, desired, 0.07);
        desired.y = this.gAt(desired.x, desired.z);
        // landing spot glides toward the prediction instead of jumping around
        if (startSwing) l.target.copy(desired);
        else l.target.lerp(desired, damp(14, dt));
        const e = smooth(t);
        // Running: after toe-off the foot is carried along with the body (heel folds up
        // behind the hips) instead of being left behind, then the knee drives it forward.
        const g = lerp(e, smooth(clamp((t - 0.1) / 0.82, 0, 1)), runF);
        tmpV.subVectors(this.pos, l.fromBody).multiplyScalar(runF * 0.9);
        l.contact.copy(l.from).add(tmpV).lerp(l.target, g);
        // swing slightly outward around the stance leg instead of through it
        this.local(l.side * 0.035 * Math.sin(Math.PI * t), 0, 0, tmpV);
        l.contact.add(tmpV);
        const walkY = Math.sin(Math.PI * t) * swingH * Math.max(moveF, 0.45);
        const runY = Math.sin(Math.PI * Math.pow(t, 0.7)) * 0.3; // peaks early: heel kick
        // arc from one surface height to the next, clearing a step up
        const lift = Math.max(0, l.target.y - l.from.y);
        l.contact.y = lerp(l.from.y, l.target.y, smooth(clamp(t * 1.4, 0, 1))) +
          lerp(walkY, runY, runF) + Math.sin(Math.PI * t) * lift * 0.6;
        l.toYaw = startSwing || l.toYaw === undefined ? this.yaw : l.toYaw + wrapAngle(this.yaw - l.toYaw) * damp(14, dt);
        l.footYaw = wrapAngle(l.fromYaw + wrapAngle(l.toYaw - l.fromYaw) * e);
        const walkPitch = lerp(0.55, -0.28, smooth(t)) * moveF;
        // running: toe points down through the heel kick, flattens for a midfoot landing
        const runPitch = t < 0.35 ? lerp(0.6, 1.15, smooth(t / 0.35)) : lerp(1.15, -0.08, smooth(clamp((t - 0.35) / 0.6, 0, 1)));
        l.pitch = lerp(walkPitch, runPitch, runF);
        if (swingDone) {
          l.swinging = false;
          l.contact.copy(l.target);
          l.footYaw = wrapAngle(l.toYaw);
          if (speed > 0.45 && ctrl.move.lengthSq() > 0.01) this.onFootstep?.(runF, l.contact);
        }
      } else {
        const p = clamp((lp - sf) / (1 - sf), 0, 1);
        let pitch = 0;
        if (p < 0.15) pitch = -0.28 * (1 - runF * 0.7) * (1 - p / 0.15);
        else if (p > 0.65) pitch = ((p - 0.65) / 0.35) * 0.55;
        l.pitch = lerp(l.pitch, pitch * moveF, damp(30, dt));
        // planted feet pivot a little on the ball instead of twisting the knee
        // (soft limit: eases back instead of hard-clamping every frame)
        const rel = wrapAngle(l.footYaw - this.yaw);
        const over = Math.abs(rel) - 0.5;
        if (over > 0) l.footYaw = wrapAngle(l.footYaw - Math.sign(rel) * over * damp(10, dt));
        // safety: if dragged too far, snap
        if (l.contact.distanceTo(rest) > 1.1) l.contact.copy(rest);
      }
    }

    // --- body pose ---
    // Hip height: a gentle base pose + small gait bob, softly limited so planted legs
    // never need to over-stretch. Driven through a critically damped spring.
    const midStance = (1 + sf) / 2;
    // running: lowest at mid-stance (knee compresses), highest in the flight phase
    const bobAmp = lerp(0.007, -0.038, runF) * moveF;
    let hy = HIP_Y - runF * 0.065 - moveF * 0.01 + bobAmp * Math.cos(4 * Math.PI * (this.phase - midStance));
    if (!this.grounded) hy = HIP_Y - 0.02;
    if (this.grounded) {
      const L = THIGH + SHIN - 0.02;
      for (const l of this.legs) {
        if (l.swinging || (this.kick && l === this.legs[this.kick.leg])) continue;
        this.local(l.side * 0.088, 0, 0, hipJ).add(this.pos);
        const h = Math.min(L - 0.01, Math.hypot(l.ankle.x - hipJ.x, l.ankle.z - hipJ.z));
        const maxH = l.ankle.y - this.pos.y + Math.sqrt(L * L - h * h) + 0.055; // hips-group height allowed
        // soft minimum: start easing down ~2cm before the limit instead of a hard kink
        const k = 0.02;
        hy = maxH + k < hy ? maxH : hy - Math.max(0, hy - (maxH - k)) ** 2 / (4 * k);
      }
      hy = Math.max(hy, HIP_Y - 0.14 - cF * HIP_Y * 0.5);
    }
    hy -= cF * HIP_Y * 0.42;
    hy -= fourF * HIP_Y * 0.22;
    hy += this.squash * 0.25;
    // critically damped spring, solved exactly: the same motion at any frame rate (a plain
    // Euler step rings - the body bobs - once the step gets long: low fps, throttled far NPCs)
    {
      const w = 16, x0 = this.hipY - hy, v0 = this.hipYV || 0;
      const e = Math.exp(-w * dt), c = v0 + w * x0;
      this.hipY = hy + (x0 + c * dt) * e;
      this.hipYV = (v0 - w * c * dt) * e;
    }

    // foot forwardness relative to body
    const fwdOf = (l) => (l.contact.x - this.pos.x) * fwd.x + (l.contact.z - this.pos.z) * fwd.z;
    const sL = fwdOf(this.legs[0]), sR = fwdOf(this.legs[1]);

    let roll = 0, shift = 0;
    for (const l of this.legs) {
      if (l.swinging) {
        const lp = (this.phase + l.offset) % 1;
        const s = Math.sin(Math.PI * clamp(lp / sf, 0, 1));
        roll += -l.side * 0.045 * s * moveF * (1 - runF * 0.5);
        shift += -l.side * 0.018 * s * moveF * (1 - runF);
      }
    }
    // (leaning into the way it's going: forward speed, not sideways - a side step stays upright)
    const fwdSpeed = this.vel.x * fwd.x + this.vel.z * fwd.z;
    const lean = clamp(0.03 + lerp(speed, Math.max(0, fwdSpeed), latF) * 0.035 + this.accelF * 0.025, -0.2, 0.42);
    const turnLean = clamp(-this.turnRate * speed * 0.035, -0.35, 0.35);
    const footYawAvg = Math.atan2(
      Math.sin(this.legs[0].footYaw) + Math.sin(this.legs[1].footYaw),
      Math.cos(this.legs[0].footYaw) + Math.cos(this.legs[1].footYaw));
    this.pelvisLag = lerp(this.pelvisLag || 0, clamp(wrapAngle(footYawAvg - this.yaw) * 0.6, -0.35, 0.35), damp(10, dt));
    const pelvisYaw = clamp(-(sL - sR) * 0.3, -0.22, 0.22) + this.pelvisLag;
    const breathe = Math.sin(this.time * 1.9);

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.hips.position.set(shift, this.hipY, 0);
    // kicking: lean back into a front kick, over a stamp
    const kl = this.kick ? this.kickLean() : 0;
    // (on all fours: the trunk tipped over level, the head held up to look ahead)
    const fb = fourF * (1 + 0.05 * Math.sin(4 * Math.PI * this.phase));
    this.hips.rotation.set(lean * 0.45 + 0.04 + cF * 0.6 + kl + fb * 0.55, pelvisYaw + (this.kick ? -this.legs[this.kick.leg].side * 0.25 * Math.sin(Math.PI * clamp(this.kick.t / this.kick.dur, 0, 1)) : 0), roll + turnLean);
    // twist/bend: extra trunk rotation asked for by whatever the arms are doing (punches, swings)
    const tw = this.twist || 0, bend = this.bend || 0;
    this.spine.rotation.set(lean * 0.3 + 0.012 * breathe + bend * 0.5 - cF * 0.22 - kl * 0.4 + fb * 0.42, -pelvisYaw * 0.5 + tw * 0.45, -roll * 0.5);
    this.chest.rotation.set(lean * 0.25 - 0.03 - 0.008 * breathe + bend * 0.5 - cF * 0.08 + fb * 0.3, -pelvisYaw * 0.45 + tw * 0.55, -roll * 0.4 - turnLean * 0.4);

    // head looks toward camera direction when it's roughly in front
    const camFacing = ctrl.camYaw + Math.PI;
    let look = wrapAngle(camFacing - this.yaw);
    look = Math.abs(look) < 1.7 ? clamp(look, -1.0, 1.0) : 0;
    this.lookYaw = lerp(this.lookYaw, look, damp(4, dt));
    const bodyYaw = pelvisYaw * (1 - 0.5 - 0.45);
    const totalLean = lean * 1.0 + 0.02;
    this.neck.rotation.set(-totalLean * 0.45 + 0.05 - bend * 0.6 - cF * 0.25 - kl * 0.3 - fourF * 0.75, (this.lookYaw - bodyYaw) * 0.4 - tw * 0.8, turnLean * 0.3);
    this.head.rotation.set(-totalLean * 0.45 - 0.03 * breathe * 0.2 - fourF * 0.45, (this.lookYaw - bodyYaw) * 0.6, turnLean * 0.3);

    this.root.updateMatrixWorld(true);

    // --- legs IK ---
    const pole = V(), end = V(), footFwd = V(), pivot = V(), tmp = V();
    const eul = new THREE.Euler(0, 0, 0, 'YXZ');
    const q = new THREE.Quaternion();
    for (const l of this.legs) {
      this.hips.localToWorld(hipJ.set(l.side * 0.088, -0.055, 0.0));
      footFwd.set(Math.sin(l.footYaw), 0, Math.cos(l.footYaw));
      eul.set(l.pitch, l.footYaw + l.side * 0.08, 0);
      q.setFromEuler(eul);
      // ankle position pivoting around heel or ball of foot
      if (l.pitch >= 0) {
        pivot.copy(l.contact).addScaledVector(footFwd, 0.13);
        tmp.set(0, ANKLE_H, -0.13).applyQuaternion(q);
      } else {
        pivot.copy(l.contact).addScaledVector(footFwd, -0.05);
        tmp.set(0, ANKLE_H, 0.05).applyQuaternion(q);
      }
      l.ankle.copy(pivot).add(tmp);

      tmp.set(0, 0, 1).transformDirection(this.hips.matrixWorld).setY(0).normalize();
      pole.copy(footFwd).multiplyScalar(0.6).addScaledVector(tmp, 0.4);
      if (pole.lengthSq() < 0.01) pole.copy(tmp);
      pole.normalize();
      pole.x += Math.cos(l.footYaw) * l.side * 0.18;   // foot-local outward
      pole.z -= Math.sin(l.footYaw) * l.side * 0.18;
      pole.normalize();
      solveTwoBone(hipJ, l.ankle, THIGH, SHIN, pole, l.knee, end);
      orient(l.thigh, hipJ, l.knee, pole);
      orient(l.shin, l.knee, end, pole);
      l.foot.position.copy(end);
      l.foot.quaternion.copy(q);
      // airborne: the foot hangs off the shin (toes softly pointed) instead of staying world-flat
      l.airW = lerp(l.airW || 0, this.grounded ? 0 : 1, damp(this.grounded ? 18 : 8, dt));
      if (this.kick && l === this.legs[this.kick.leg]) l.airW = 0;
      if (l.airW > 0.001) {
        q.copy(l.shin.quaternion).multiply(_fq.setFromEuler(_fe.set(0.35 + Math.max(0, l.pitch) * 0.4, 0, 0)));
        l.foot.quaternion.slerp(q, l.airW);
      }
      // toe only hinges while the ball of the foot is on the ground
      const onGround = clamp(1 - (l.contact.y - this.pos.y) / 0.05, 0, 1);
      l.toe.rotation.x = l.pitch > 0 ? -Math.min(l.pitch, 0.6) * 0.9 * onGround : 0;
    }

    // --- arms IK ---
    const shoulder = V(), target = V();
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i];
      // walking follows the feet; running uses a smooth pendulum locked to the gait phase
      const lp = (this.phase + this.legs[i].offset) % 1;
      const sPhase = 0.4 * Math.cos(2 * Math.PI * (lp - (sf - 0.12)));
      const s = lerp(i === 0 ? sL : sR, sPhase, runF);
      this.chest.localToWorld(shoulder.set(a.side * 0.185, 0.2, -0.015));
      let lx, ly, lz;
      if (this.grounded) {
        const swing = -s * lerp(0.75, 1.05, runF) * clamp(speed / 1.2, 0, 1);
        lx = a.side * (0.075 - runF * 0.02);
        // running: elbows bent, the swing centred ahead of the hip (the trunk leans into it) and
        // the hand coming up toward the chest on the way forward, down past the hip going back
        ly = -(UPPER_ARM + FOREARM) * lerp(lerp(0.95, 0.64, runF), 0.72, cF) + Math.max(0, swing) * lerp(0.2, 0.42, runF);
        lz = swing * lerp(0.55, 0.5, runF) + runF * 0.15 + 0.02 + cF * 0.2 + runF * lean * 0.25;
        lx += a.side * breathe * 0.004;
      } else {
        lx = a.side * 0.28; ly = -0.3 + clamp(this.vy * 0.04, -0.1, 0.15); lz = 0.1;
      }
      this.local(lx, ly, lz, target).add(shoulder);
      // on all fours: the hands are front feet - down on the ground under the shoulders, each in
      // step with the opposite leg (a trot), reaching forward in the air and pushing back planted
      if (fourF) {
        const fp = (this.phase + this.legs[1 - i].offset) % 1;
        const inAir = fp < sf;
        const u = inAir ? fp / sf : (fp - sf) / (1 - sf);
        const reach = clamp(0.1 + speed * 0.05, 0.1, 0.45);
        const along = inAir ? lerp(-reach, reach, smooth(u)) : lerp(reach, -reach, u);
        const gx = shoulder.x + fwd.x * (0.12 + along), gz = shoulder.z + fwd.z * (0.12 + along);
        const side = a.side * 0.06;
        _fr.set(gx + fwd.z * side, 0, gz - fwd.x * side);
        _fr.y = this.gAt(_fr.x, _fr.z) + 0.035 + (inAir ? Math.sin(Math.PI * u) * 0.14 : 0);
        // (never further than the arm reaches)
        const d = _fr.distanceTo(shoulder), maxR = (UPPER_ARM + FOREARM) * 0.98;
        if (d > maxR) _fr.sub(shoulder).multiplyScalar(maxR / d).add(shoulder);
        target.lerp(_fr, fourF);
      }
      // (smoothed where it is from the shoulder, not where it is in the world: at a run the
      // world-space lag alone left the hands ~0.3 m behind the body)
      // (a posture or climb that just let go put the hand somewhere itself: carry on from there)
      if (!a.handPos) a.handPos = target.clone();
      if (!a.handRel || !a._handSet || !a._handSet.equals(a.handPos)) a.handRel = (a.handRel || V()).subVectors(a.handPos, shoulder);
      a.handRel.lerp(tmp.subVectors(target, shoulder), damp(fourF ? 30 : 16, dt));
      a.handPos.copy(shoulder).add(a.handRel);
      (a._handSet ||= V()).copy(a.handPos);

      this.local(a.side * 0.35, -0.25, -1, pole).normalize();
      solveTwoBone(shoulder, a.handPos, UPPER_ARM, FOREARM, pole, a.elbow, end);
      // (the roll: forward, and for a forearm brought up in front - a sprint's swing - thumb up;
      // a hanging arm is unchanged, the up part runs along it)
      orient(a.upper, shoulder, a.elbow, fwd, true);
      orient(a.fore, a.elbow, end, tmp.set(fwd.x, 0.7, fwd.z), true);
      // wrist and finger curl
      a.hand.rotation.set(0.1 + runF * 0.2 + fourF * 1.1, 0, -0.08);
      const curl = lerp(lerp(0.22, 1.1, runF) + (this.grounded ? 0 : -0.15), 0.45, fourF);
      a.fingers.forEach(([f1, f2], j) => {
        f1.rotation.z = -(curl + j * 0.06);
        f2.rotation.z = -(curl * 1.15 + j * 0.05);
      });
      a.thumb[1].rotation.z = -curl * 0.6;
    }
    // held items (the gun) re-pose the arms on top of locomotion
    this.armHook?.(this, dt);
    // body language (life.js Gestures) on top of everything
    this.lifeHook?.(this, dt, null);
  }
}
