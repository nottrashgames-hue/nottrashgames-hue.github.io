import { settings } from './settings.js';
import * as THREE from 'three';
import { poseArm } from './gun.js';
import { sweep } from './strike.js';
import { bodyFrame, curl } from './melee.js';
import { buildDodgeball, buildBanana, buildTimeBomb, buildFlare } from './nademodels.js';

/*
  Things you throw: a choking-gas canister, a molotov and a frag grenade.

    gas     - bounces, pops after a short fuse and hisses out a spreading cloud. Anyone in it
              coughs, runs, staggers, blacks out, and slowly suffocates if left in there.
    molotov - bursts on the first thing it hits into a pool of fire. Anyone who walks through
              it catches: they run screaming, burn down, and it spreads to whoever they touch.
              Going down (ragdoll, G) rolls it out faster.
    frag    - bounces, goes off after its fuse: a blast that throws people, tears limbs off at
              the joints close in, and sprays fragments (real rounds) at whoever's around.
    dodgeball - bouncy: a hard hit knocks whoever it meets off their feet; once it stops it's
              lying there for anyone to pick up again.
    banana  - lands and stays: the first person to walk or run over it slips, feet up.
    timebomb - sticks where it lands, beeps faster and faster, then a blast twice a frag's.
    airstrike - a red smoke flare: a jet screams over and a line of bombs walks across where it
              landed. One call a minute (strikeCd).

  Multiplayer: the thrower's copy flies the thing and decides where it goes off; everyone gets
  the throw (to see it fly) and the burst (same cloud / fire, same place). Every copy runs the
  effects, but each one only hurts the people it simulates (you, and the host's street).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const UP = V(0, 1, 0);
const G = 9.81;

// ---------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------
let M = null;
const mats = () => (M ||= {
  glass: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8 }),
  fuel: new THREE.MeshStandardMaterial({ color: 0xb07a20, roughness: 0.3, transparent: true, opacity: 0.85 }),
  rag: new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 1 }),
  can: new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.55, metalness: 0.4 }),
  band: new THREE.MeshStandardMaterial({ color: 0xc9b637, roughness: 0.5 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.35, metalness: 0.8 }),
  frag: new THREE.MeshStandardMaterial({ color: 0x3f4a2c, roughness: 0.7, metalness: 0.3 }),
});

// ---- scorch marks: the soot decal, with world-space noise breaking it up ----
const SCORCH_GEO = new THREE.PlaneGeometry(2, 2);
let SCORCH_TEX = null;
function scorchTex() {
  if (SCORCH_TEX) return SCORCH_TEX;
  SCORCH_TEX = new THREE.TextureLoader().load(new URL('./tex/scorch.png', import.meta.url).href);
  SCORCH_TEX.colorSpace = THREE.SRGBColorSpace;
  SCORCH_TEX.anisotropy = 4;
  return SCORCH_TEX;
}
const SCORCH_NOISE = /* glsl */ `
  varying vec3 vScW;
  float scH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float scN(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(scH(i), scH(i + vec2(1, 0)), f.x), mix(scH(i + vec2(0, 1)), scH(i + vec2(1, 1)), f.x), f.y);
  }
  float scF(vec2 p) { return 0.5 * scN(p) + 0.3 * scN(p * 2.3 + 17.0) + 0.2 * scN(p * 5.1 - 9.0); }
`;
/** A scorch's own material (its own opacity, to fade it); every one shares the one program. */
function scorchMat() {
  const m = new THREE.MeshStandardMaterial({ map: scorchTex(), transparent: true, depthWrite: false, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vScW;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vScW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = SCORCH_NOISE + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 w = vScW.xz;
        // patchy: the soot thicker here, thinner there, a few bare holes
        float n = scF(w * 1.4), m = scF(w * 4.2 + 31.0);
        diffuseColor.a *= clamp(mix(0.45, 1.25, n) * mix(0.8, 1.1, m), 0.0, 1.0);
        // blacker where it's thick, a burnt brown in patches, flecks of grey ash
        diffuseColor.rgb *= mix(0.65, 1.15, m);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 0.95, 0.7), smoothstep(0.55, 0.8, scF(w * 2.1 - 5.0)) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.3), smoothstep(0.82, 0.95, scH(floor(w * 38.0))) * 0.5 * diffuseColor.a);
      }`);
  };
  m.customProgramCacheKey = () => 'scorch';
  return m;
}

function buildMolotov() {
  const m = mats(), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 12), m.glass);
  body.position.y = 0.085;
  const fuel = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.11, 12), m.fuel);
  fuel.position.y = 0.06;
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.036, 0.04, 12), m.glass);
  sh.position.y = 0.19;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.06, 10), m.glass);
  neck.position.y = 0.24;
  const rag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), m.rag);
  rag.position.set(0.004, 0.285, 0);
  rag.rotation.z = 0.35;
  g.add(body, fuel, sh, neck, rag);
  for (const c of g.children) c.castShadow = true;
  g.userData.wick = V(0.01, 0.31, 0);
  g.userData.len = 0.3;
  return g;
}
function buildGas() {
  const m = mats(), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.13, 14), m.can);
  body.position.y = 0.065;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0325, 0.0325, 0.018, 14), m.band);
  band.position.y = 0.09;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.02, 12), m.metal);
  top.position.y = 0.14;
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.006), m.metal);
  spoon.position.set(0.035, 0.1, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 12), m.metal);
  ring.position.set(-0.02, 0.155, 0);
  g.add(body, band, top, spoon, ring);
  for (const c of g.children) c.castShadow = true;
  g.userData.nozzle = V(0, 0.15, 0);
  g.userData.len = 0.16;
  return g;
}

function buildFrag() {
  const m = mats(), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), m.frag);
  body.scale.set(1, 1.2, 1);
  body.position.y = 0.045;
  // the segmented shell
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.0335 * Math.cos((i - 1) * 0.55), 0.0035, 5, 16), m.frag);
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.045 + (i - 1) * 0.022;
    g.add(r);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.022, 10), m.metal);
  top.position.y = 0.092;
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.07, 0.005), m.metal);
  spoon.position.set(0.03, 0.07, 0);
  spoon.rotation.z = -0.25;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 12), m.metal);
  ring.position.set(-0.018, 0.1, 0);
  g.add(body, top, spoon, ring);
  for (const c of g.children) c.castShadow = true;
  g.userData.len = 0.11;
  return g;
}

// ---- launched (the launchers in gun.js): pointed along +Y, they fly nose first ----
function buildRocket() {
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 10), olive);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 10), olive);
  nose.position.y = 0.2;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), dark);
  tail.position.y = -0.2;
  g.add(body, nose, tail);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.07, 0.035), dark);
    fin.position.set(Math.cos(i * Math.PI / 2) * 0.025, -0.24, Math.sin(i * Math.PI / 2) * 0.025);
    fin.rotation.y = -i * Math.PI / 2;
    g.add(fin);
  }
  g.userData.len = 0.54;
  return g;
}
function buildShell40() {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a6b3e, roughness: 0.6 }));
  head.scale.y = 1.2;
  head.position.y = 0.02;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.35, metalness: 0.9 }));
  base.position.y = -0.005;
  g.add(head, base);
  g.userData.len = 0.06;
  return g;
}
// (fly: speed m/s, gravity 0..1, how long before it goes off by itself; blast: frag = 1)
export const PROJECTILES = {
  rocket: { build: buildRocket, speed: 38, grav: 0.04, fuse: 5, blast: 1.35 },
  grenade40: { build: buildShell40, speed: 26, grav: 1, fuse: 4, blast: 0.85 },
};

export const THROWABLES = {
  gas: { name: 'Gas Grenade', build: buildGas },
  molotov: { name: 'Molotov', build: buildMolotov },
  frag: { name: 'Frag Grenade', build: buildFrag },
  dodgeball: { name: 'Dodgeball', build: buildDodgeball, noPin: true },
  banana: { name: 'Banana Peel', build: buildBanana, noPin: true },
  timebomb: { name: 'Time Bomb', build: buildTimeBomb },
  airstrike: { name: 'Airstrike', build: buildFlare },
};
// how long after the throw each goes off by itself (molotov: on impact, never by time)
const FUSE = { gas: 1.6, frag: 3.2, timebomb: 8, airstrike: 2.2, dodgeball: 8, banana: 6 };
const STRIKE_CD = 60; // s between airstrikes
const STRIKE_N = 7, STRIKE_LEN = 26; // bombs along the run, m of it

// ---------------------------------------------------------------------------------------
// Soft particles (one additive pool for flame, one plain for smoke and gas)
// ---------------------------------------------------------------------------------------
const VERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale; varying float vA; varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
  vA = aAlpha; vC = aColor;
}`;
const FRAG = `
varying float vA; varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vC, vA * a * a);
}`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.list = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.geo = geo;
    scene.add(this.points);
  }
  /** o: { p, v, life, s0, s1, c0: [r,g,b], c1, a0, a1, drag, rise } */
  emit(o) {
    if (this.list.length >= this.max) return;
    o.t = 0;
    this.list.push(o);
  }
  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    const L = this.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const o = L[i];
      o.t += dt;
      if (o.t >= o.life) continue;
      o.v.multiplyScalar(Math.exp(-(o.drag ?? 1) * dt));
      o.v.y += (o.rise ?? 0) * dt;
      o.p.addScaledVector(o.v, dt);
      const u = o.t / o.life;
      this.pos[n * 3] = o.p.x; this.pos[n * 3 + 1] = o.p.y; this.pos[n * 3 + 2] = o.p.z;
      for (let k = 0; k < 3; k++) this.col[n * 3 + k] = lerp(o.c0[k], o.c1[k], u);
      this.size[n] = lerp(o.s0, o.s1, u);
      this.alpha[n] = lerp(o.a0, o.a1, u) * Math.min(1, u * 8);
      L[n++] = o;
    }
    L.length = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) this.geo.attributes[k].needsUpdate = true;
  }
  clear() { this.list.length = 0; this.geo.setDrawRange(0, 0); }
}

const FLAME0 = [1, 0.78, 0.35], FLAME1 = [0.85, 0.18, 0.02];
const SMOKE0 = [0.09, 0.08, 0.07], SMOKE1 = [0.28, 0.27, 0.26];
const GAS0 = [0.78, 0.82, 0.62], GAS1 = [0.86, 0.88, 0.8];

// ---------------------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------------------
/**
 * ctx: { scene, camera, renderer, actors, sfx, fireLoop, castSeg(a, b), hero,
 *        net: { id(): string, send(m) } | null, onHurt?(actor, kind) }
 */
export class Throwables {
  constructor(ctx) {
    this.ctx = ctx;
    this.fire = new Particles(ctx.scene, 2400, true);
    this.smoke = new Particles(ctx.scene, 1600, false);
    this.flying = [];   // in the air (or lying there, not gone off yet)
    this.clouds = [];
    this.fires = [];
    this.scorches = [];
    this.pickups = [];  // lying about: walk over them to take them
    this.seq = 0;
    this.pocket = Object.fromEntries(Object.keys(THROWABLES).map((k) => [k, 0]));
    this.peels = [];    // banana peels lying in wait
    this.strikes = [];  // airstrikes on their way in
    this.strikeCd = 0;  // s before our next airstrike can be called
    // the blast's flash (always in the scene, dark: adding a light later recompiles everything)
    this.flash = new THREE.PointLight(0xffb060, 0, 18, 1.6);
    this.flash.castShadow = false;
    ctx.scene.add(this.flash);
    this.flashT = 0;
    this.nukes = [];
    this.nukeFlash = 0;
    this.sel = 'molotov';
    this.onPocket = null;
  }

  // ---------- your pocket ----------
  give(kind, n = 1) {
    if (!THROWABLES[kind]) return;
    this.pocket[kind] += n;
    this.sel = kind;
    this.onPocket?.();
  }
  /** Next kind you have (V). */
  cycle() {
    const ks = Object.keys(THROWABLES).filter((k) => this.pocket[k] > 0);
    if (!ks.length) return;
    this.sel = ks[(ks.indexOf(this.sel) + 1) % ks.length];
    this.onPocket?.();
  }
  get ready() { return this.pocket[this.sel] > 0 ? this.sel : Object.keys(THROWABLES).find((k) => this.pocket[k] > 0) || null; }
  take(kind) {
    if (!(this.pocket[kind] > 0)) return false;
    this.pocket[kind]--;
    if (!this.pocket[kind]) { const k = this.ready; if (k) this.sel = k; }
    this.onPocket?.();
    return true;
  }

  /** `n` of them lying on the ground at `at` (on its side), for whoever walks over them. */
  lay(kind, n, at) {
    for (let i = 0; i < n; i++) {
      const mesh = THROWABLES[kind].build();
      const len = mesh.userData.len;
      const yaw = Math.random() * Math.PI * 2;
      mesh.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, yaw, 'YXZ'));
      mesh.position.set(at.x + (i - (n - 1) / 2) * 0.12, at.y + 0.035, at.z).addScaledVector(V(0, 1, 0).applyQuaternion(mesh.quaternion), -len / 2);
      this.ctx.scene.add(mesh);
      this.pickups.push({ kind, mesh, p: V(at.x + (i - (n - 1) / 2) * 0.12, at.y, at.z) });
    }
  }
  collect() {
    const A = this.ctx.hero;
    if (!A || A.brain.dead || A.mode !== 'anim') return;
    const hp = A.hero.pos;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (Math.hypot(k.p.x - hp.x, k.p.z - hp.z) > 0.75 || Math.abs(k.p.y - hp.y) > 1.2) continue;
      this.ctx.scene.remove(k.mesh);
      this.pickups.splice(i, 1);
      this.give(k.kind, 1);
      this.ctx.sfx('pickup', 0.6, { gap: 0.06 });
    }
  }

  // ---------- throwing ----------
  /** Our own throw: it's ours to fly and set off. */
  launch(kind, by, p, v) {
    if (kind === 'airstrike') { this.strikeCd = STRIKE_CD; this.onPocket?.(); }
    const id = (this.ctx.net?.id() || 'l') + ':' + ++this.seq;
    this.spawn(kind, id, by, p, v, false);
    this.ctx.net?.send({ a: 't', id, ty: kind, p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] });
  }
  spawn(kind, id, by, p, v, remote) {
    const mesh = (THROWABLES[kind] || PROJECTILES[kind]).build();
    mesh.position.copy(p);
    mesh.quaternion.setFromUnitVectors(UP, v.clone().normalize());
    this.ctx.scene.add(mesh);
    const spin = V(rnd(-1, 1), rnd(-0.3, 0.3), rnd(-1, 1)).normalize();
    this.flying.push({ kind, id, by, p: p.clone(), v: v.clone(), mesh, spin, w: rnd(9, 14), t: 0, rest: false, remote, lastClank: 0 });
  }

  /** A message from someone else's copy. */
  onNet(m, byActor) {
    if (m.a === 't') {
      if (this.flying.some((f) => f.id === m.id)) return;
      this.spawn(m.ty, m.id, byActor, V(...m.p), V(...m.v), true);
      // (someone else's launcher: the shot's heard with it)
      if (PROJECTILES[m.ty]) this.ctx.sfx(m.ty === 'rocket' ? 'rocket' : 'launch', this.vol(V(...m.p), 1));
    } else if (m.a === 'n') {
      this.nuke(V(...m.p), byActor, false);
    } else if (m.a === 'x') {
      this.dropPeel(m.id);
    } else if (m.a === 'b') {
      const i = this.flying.findIndex((f) => f.id === m.id);
      let can = null;
      if (i >= 0) { const f = this.flying[i]; this.flying.splice(i, 1); can = f.mesh; }
      this.effect(m.ty, V(...m.p), can, byActor, false, m.id);
    }
  }

  /** Ours went off at `p`: tell everyone, start it here. */
  burst(f, p) {
    const i = this.flying.indexOf(f);
    if (i >= 0) this.flying.splice(i, 1);
    this.ctx.net?.send({ a: 'b', id: f.id, ty: f.kind, p: [p.x, p.y, p.z] });
    this.effect(f.kind, p, f.mesh, f.by, true, f.id);
  }

  effect(kind, p, mesh, by, mine, id) {
    const { sfx } = this.ctx;
    if (kind === 'dodgeball') {
      // stopped: lying there for whoever wants it
      if (mesh) this.ctx.scene.remove(mesh);
      this.lay('dodgeball', 1, this.floorAt(p));
    } else if (kind === 'banana') {
      if (!mesh) { mesh = THROWABLES.banana.build(); this.ctx.scene.add(mesh); }
      const at = this.floorAt(p);
      mesh.position.copy(at);
      mesh.quaternion.setFromAxisAngle(UP, rnd(0, Math.PI * 2));
      this.peels.push({ id, p: at, mesh, t: 0 });
    } else if (kind === 'timebomb') {
      if (mesh) this.ctx.scene.remove(mesh);
      this.explode(p, by, mine, 2.2);
    } else if (kind === 'airstrike') {
      if (!mesh) { mesh = THROWABLES.airstrike.build(); this.ctx.scene.add(mesh); }
      const at = this.floorAt(p);
      mesh.position.copy(at);
      mesh.quaternion.setFromAxisAngle(V(1, 0, 0), Math.PI / 2);
      // (the run's heading from where it landed: every copy works out the same line)
      const yaw = ((Math.sin(at.x * 12.9898 + at.z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
      this.strikes.push({ c: at, dir: V(Math.cos(yaw), 0, Math.sin(yaw)), t: 0, by, mine, flare: mesh, n: 0, jet: false });
    } else if (PROJECTILES[kind]) {
      if (mesh) this.ctx.scene.remove(mesh);
      this.explode(p, by, mine, PROJECTILES[kind].blast);
    } else if (kind === 'frag') {
      if (mesh) this.ctx.scene.remove(mesh);
      this.explode(p, by, mine);
    } else if (kind === 'molotov') {
      if (mesh) this.ctx.scene.remove(mesh);
      // the fire lands on whatever's under the splash
      const floor = this.ctx.castSeg(V(p.x, p.y + 0.15, p.z), V(p.x, p.y - 8, p.z));
      const at = floor ? floor.point : p.clone();
      sfx('molotov', this.vol(p, 1.3), { vary: 0.08 });
      for (let k = 0; k < 60; k++) {
        const d = V(rnd(-1, 1), rnd(0.2, 1.4), rnd(-1, 1)).normalize().multiplyScalar(rnd(1.5, 5));
        this.fire.emit({ p: p.clone(), v: d, life: rnd(0.35, 0.8), s0: rnd(0.3, 0.6), s1: 0.1, c0: FLAME0, c1: FLAME1, a0: 1, a1: 0, drag: 3, rise: 3 });
      }
      const r = rnd(1.5, 1.9);
      this.scorch(at, r * 1.1);
      this.fires.push({ p: at, r, t: 0, dur: rnd(11, 13), seed: Math.random() * 10 });
    } else {
      if (!mesh) { mesh = THROWABLES.gas.build(); mesh.position.copy(p); this.ctx.scene.add(mesh); }
      sfx('gas', this.vol(p, 1));
      this.clouds.push({ p: p.clone(), c: p.clone(), r: 0.4, t: 0, dur: 20, can: mesh });
    }
  }

  /**
   * A frag goes off at `p`. Every copy: the flash, fireball, smoke, the bang, and the blast
   * on the people it simulates. The thrower's copy (mine) also decides what the fragments hit
   * and which limbs come off - for everyone, puppets included (their owners get the cuts).
   */
  /** A launched round in flight: straight (a rocket, smoking) or arcing; it goes off on whatever it meets. */
  flyShot(f, PJ, dt, i) {
    const { castSeg, actors } = this.ctx;
    if (!f.remote && f.t > PJ.fuse) { this.burst(f, f.p.clone()); return; }
    if (f.rest) return;
    if (f.kind === 'rocket' && settings.fx) {
      const tail = f.p.clone().addScaledVector(f.v, -0.3 / Math.max(1, f.v.length()));
      this.fire.emit({ p: tail, v: V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), life: rnd(0.05, 0.12), s0: 0.22, s1: 0.05, c0: [1, 0.9, 0.6], c1: FLAME1, a0: 1, a1: 0, drag: 2 });
      this.smoke.emit({ p: tail, v: V(rnd(-0.3, 0.3), rnd(0, 0.4), rnd(-0.3, 0.3)), life: rnd(0.9, 1.6), s0: 0.18, s1: 0.8, c0: [0.5, 0.5, 0.5], c1: [0.7, 0.7, 0.7], a0: 0.5, a1: 0, drag: 1.5, rise: 0.3 });
    }
    const n = Math.max(1, Math.ceil(f.v.length() * dt / 0.3));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      f.v.y -= G * PJ.grav * h;
      const nx = f.p.clone().addScaledVector(f.v, h);
      const hit = castSeg(f.p, nx);
      const who = sweep(f.p, f.p, nx, nx, 0.08, actors, f.t < 0.3 ? f.by : null, null);
      const at = who && (!hit || who.k <= hit.f) ? who.point : hit ? hit.point : null;
      if (at) {
        // (back off the surface a touch: the blast is on this side of the wall)
        const back = f.v.clone().normalize().multiplyScalar(-0.15);
        if (!f.remote) this.burst(f, at.clone().add(back));
        else { f.rest = true; f.p.copy(at).add(back); f.mesh.position.copy(f.p); }
        return;
      }
      f.p.copy(nx);
    }
    f.mesh.position.copy(f.p);
    f.mesh.quaternion.setFromUnitVectors(UP, _v.copy(f.v).normalize());
  }

  /** The look and sound of a blast at c (flash, fireball, sparks, smoke, a scorch on the floor): no harm done. */
  boom(c, floor) {
    const { sfx } = this.ctx;
    sfx('explosion', this.vol(c, 1.6), { vary: 0.06 });
    this.flash.position.copy(c).y += 0.5;
    this.flashT = 0.25;
    if (settings.fx) {
      for (let k = 0; k < 70; k++) {
        const d = V(rnd(-1, 1), rnd(-0.1, 1), rnd(-1, 1)).normalize();
        this.fire.emit({ p: c.clone(), v: d.multiplyScalar(rnd(4, 13)), life: rnd(0.12, 0.35), s0: rnd(0.5, 1.1), s1: 0.2, c0: [1, 0.95, 0.75], c1: FLAME1, a0: 1, a1: 0, drag: 7, rise: 2 });
      }
      // sparks and grit
      for (let k = 0; k < 40; k++) {
        const d = V(rnd(-1, 1), rnd(0.1, 1), rnd(-1, 1)).normalize();
        this.fire.emit({ p: c.clone(), v: d.multiplyScalar(rnd(8, 20)), life: rnd(0.3, 0.7), s0: 0.05, s1: 0.02, c0: [1, 0.85, 0.5], c1: [1, 0.4, 0.1], a0: 1, a1: 0, drag: 1.5, rise: -9 });
      }
      for (let k = 0; k < 45; k++) {
        const d = V(rnd(-1, 1), rnd(0, 1.2), rnd(-1, 1)).normalize();
        this.smoke.emit({ p: c.clone().addScaledVector(d, 0.3), v: d.multiplyScalar(rnd(1.5, 5)), life: rnd(2, 4.5), s0: rnd(0.6, 1), s1: rnd(2.2, 3.4), c0: SMOKE0, c1: SMOKE1, a0: 0.75, a1: 0, drag: 2.2, rise: 0.5 });
      }
    }
    if (floor) {
      this.scorch(floor.point, rnd(1.2, 1.6));
    }
  }

  /**
   * A body that blows up when it dies (look.deathFx 'explode'): every copy sees and hears the
   * blast at its bomb (or chest); it hurts nobody else and throws nothing else about. The copy
   * that simulates the body throws it apart and tears its limbs off (the owners' cuts reach
   * everyone else as usual).
   */
  selfBlast(A) {
    const h = A.hero, bomb = h.fatBomb;
    const chest = A.mode === 'ragdoll' && A.rd?.active ? A.rd.pos('chest', V()) : h.chest.getWorldPosition(V());
    const c = bomb?.userData.core ? bomb.userData.core.getWorldPosition(V()) : chest.clone();
    h.setBomb?.(false);
    if (!(c.x === c.x)) return;
    const floor = this.ctx.castSeg(V(c.x, c.y + 0.2, c.z), V(c.x, c.y - 3, c.z));
    this.boom(c, floor);
    this.ctx.onBlast?.(c, A, true);
    if (A.remote) return;
    if (A.mode !== 'ragdoll') A.goRagdoll('collapse');
    A.blastQ = { c: chest.clone().add(V(rnd(-0.1, 0.1), 0.35, rnd(-0.1, 0.1))), f: 0.9, t: 0 };
    const sever = this.ctx.sever;
    if (!sever || !settings.dismember || !A.rd) return;
    const ODDS = { head: 0.95, upperL: 0.8, upperR: 0.8, thighL: 0.55, thighR: 0.55, foreL: 0.3, foreR: 0.3, shinL: 0.25, shinR: 0.25 };
    let cuts = 0;
    for (const part of Object.keys(ODDS).sort(() => Math.random() - 0.5)) {
      if (cuts >= 5 || Math.random() > ODDS[part]) continue;
      const g = A.groups?.[part];
      if (!g || A.rd.parts[part]?.gone) continue;
      g.updateWorldMatrix(true, false);
      const j = g.getWorldPosition(V());
      const axis = V(0, 1, 0).transformDirection(g.matrixWorld).add(V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3))).normalize();
      const away = j.clone().sub(chest); away.y = Math.max(away.y, 0.1);
      const vel = away.normalize().multiplyScalar(rnd(9, 15)).add(V(0, rnd(4, 7), 0));
      if (sever(A, part, j, axis, vel)) cuts++;
    }
  }

  /**
   * A nuke (admin.js) at `p`: every copy sees the flash, the fireball and the mushroom cloud and
   * hears it; the blast is a frag's, far bigger (people it simulates thrown, burnt, torn apart).
   * mine: ours - tell everyone, and ours decides the fragments and the cuts.
   */
  nuke(p, by, mine = true) {
    const { castSeg, sfx, camera } = this.ctx;
    if (mine) this.ctx.net?.send({ a: 'n', p: [p.x, p.y, p.z] });
    const floor = castSeg(V(p.x, p.y + 0.5, p.z), V(p.x, p.y - 6, p.z));
    const c = p.clone(); c.y = (floor ? floor.point.y : p.y) + 0.12;
    const d = camera.position.distanceTo(c);
    sfx('nuke', Math.max(0.35, 2.2 / (1 + (d / 80) ** 2)), { vary: 0.02 });
    this.explode(c, by, mine, 40);
    // (the frag's own light is too small for this: a flash out to a long way off)
    this.nukeFlash = 2.5;
    this.flash.distance = 220;
    this.flash.position.copy(c).y += 12;
    // everyone close in catches fire
    const R = 7.5 * Math.sqrt(40) * 0.55;
    for (const A of this.ctx.actors) {
      if (A.remote || A.god) continue;
      const at = A.mode === 'ragdoll' && A.rd.active ? A.rd.pos('chest', V()) : A.hero.pos;
      if (at.distanceTo(c) < R) A.burnT = Math.max(A.burnT || 0, 9);
    }
    this.scorch(c, 15);
    this.nukes.push({ c, t: 0 });
    this.ctx.onNuke?.(c);
  }
  /**
   * A scorch mark on the floor at p, about r across the middle: the soot texture (tex/scorch.png),
   * turned any which way, stretched a little, its darkness broken up by noise in world space
   * (so no two look alike), laid on in a random order so overlapping ones don't flicker.
   */
  scorch(p, r) {
    const sc = new THREE.Mesh(SCORCH_GEO, scorchMat());
    sc.rotation.set(-Math.PI / 2, 0, rnd(0, Math.PI * 2));
    const k = r * 1.3, st = rnd(0.85, 1.15);
    sc.scale.set(k * st, k / st, 1);
    sc.position.copy(p).y += 0.012 + Math.random() * 0.004;
    sc.renderOrder = 1 + (this.scorchN = ((this.scorchN || 0) + 1) % 1000) * 1e-3;
    const o = rnd(0.82, 1);
    sc.material.opacity = o;
    this.ctx.scene.add(sc);
    this.scorches.push({ mesh: sc, t: 0, o });
    // (too many about: the oldest goes)
    if (this.scorches.length > 60) { const s = this.scorches.shift(); this.ctx.scene.remove(s.mesh); s.mesh.material.dispose(); }
  }
  /** Each nuke's fireball and mushroom cloud, rising and spreading over its first seconds. */
  runNukes(dt) {
    if (this.nukeFlash > 0) {
      this.nukeFlash = Math.max(0, this.nukeFlash - dt);
      if (!this.nukeFlash) this.flash.distance = 18;
    }
    for (let i = this.nukes.length - 1; i >= 0; i--) {
      const N = this.nukes[i], c = N.c;
      N.t += dt;
      if (N.t > 6) { this.nukes.splice(i, 1); continue; }
      if (!settings.fx) continue;
      const t = N.t, h = Math.min(34, 4 + t * 11);
      // a ring of dust racing out along the ground
      if (t < 0.8) for (let k = 0; k < 10; k++) {
        const a = rnd(0, Math.PI * 2);
        const d = V(Math.cos(a), 0.05, Math.sin(a));
        this.smoke.emit({ p: c.clone().addScaledVector(d, rnd(1, 3)), v: d.multiplyScalar(rnd(18, 34)), life: rnd(2.5, 4), s0: rnd(2, 3), s1: rnd(6, 9), c0: [0.35, 0.3, 0.24], c1: [0.55, 0.52, 0.48], a0: 0.7, a1: 0, drag: 1.4, rise: 0.4 });
      }
      if (t > 4.5) continue;
      // the stem: fire and smoke boiling up
      for (let k = 0; k < 5; k++) {
        const o = c.clone().add(V(rnd(-1.8, 1.8), rnd(0, h * 0.8), rnd(-1.8, 1.8)));
        this.fire.emit({ p: o, v: V(rnd(-1, 1), rnd(8, 14), rnd(-1, 1)), life: rnd(0.5, 1.1), s0: rnd(2, 3.5), s1: 0.8, c0: [1, 0.85, 0.5], c1: FLAME1, a0: 1, a1: 0, drag: 1.2, rise: 1 });
      }
      for (let k = 0; k < 2; k++) {
        const o = c.clone().add(V(rnd(-2, 2), rnd(0, h * 0.7), rnd(-2, 2)));
        this.smoke.emit({ p: o, v: V(rnd(-0.5, 0.5), rnd(6, 10), rnd(-0.5, 0.5)), life: rnd(4, 6), s0: rnd(2.5, 4), s1: rnd(5, 7), c0: [0.3, 0.16, 0.08], c1: SMOKE1, a0: 0.8, a1: 0, drag: 0.6, rise: 0.3 });
      }
      // the cap: a rolling ball of fire going to smoke, spreading out at the top
      const top = c.clone().setY(c.y + h);
      for (let k = 0; k < 6; k++) {
        const a = rnd(0, Math.PI * 2), r = rnd(0, 5 + t * 2.5);
        const o = top.clone().add(V(Math.cos(a) * r, rnd(-2.5, 2.5), Math.sin(a) * r));
        const out = V(Math.cos(a), rnd(-0.3, 0.5), Math.sin(a)).multiplyScalar(rnd(1, 4));
        this.fire.emit({ p: o, v: out, life: rnd(0.6, 1.3), s0: rnd(3, 5), s1: 1.5, c0: [1, 0.9, 0.6], c1: [0.9, 0.3, 0.05], a0: 1, a1: 0, drag: 0.8, rise: 1.5 });
      }
      for (let k = 0; k < 3; k++) {
        const a = rnd(0, Math.PI * 2), r = rnd(0, 6 + t * 3);
        const o = top.clone().add(V(Math.cos(a) * r, rnd(-2, 3), Math.sin(a) * r));
        this.smoke.emit({ p: o, v: V(Math.cos(a) * rnd(1, 3), rnd(0.5, 2), Math.sin(a) * rnd(1, 3)), life: rnd(7, 10), s0: rnd(4, 6), s1: rnd(9, 13), c0: [0.36, 0.2, 0.1], c1: [0.32, 0.3, 0.29], a0: 0.85, a1: 0, drag: 0.5, rise: 0.25 });
      }
    }
  }

  /** The floor under p (or p). */
  floorAt(p) {
    const hit = this.ctx.castSeg(V(p.x, p.y + 0.3, p.z), V(p.x, p.y - 6, p.z));
    return hit ? hit.point.clone() : p.clone();
  }
  dropPeel(id) {
    const i = this.peels.findIndex((q) => q.id === id);
    if (i < 0) return;
    this.ctx.scene.remove(this.peels[i].mesh);
    this.peels.splice(i, 1);
  }
  /** Peels: anyone we simulate stepping on one at a walk or more goes feet over head. */
  runPeels(dt) {
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const q = this.peels[i];
      q.t += dt;
      if (q.t > 120) { this.dropPeel(q.id); continue; }
      for (const A of this.ctx.actors) {
        if (A.remote || A.seat || A.mode !== 'anim' || A.brain.dead) continue;
        const hp = A.hero.pos, v = A.hero.vel;
        if (Math.abs(hp.y - q.p.y) > 0.6 || Math.hypot(hp.x - q.p.x, hp.z - q.p.z) > 0.38) continue;
        const sp = Math.hypot(v.x, v.z);
        if (sp < 0.9) continue;
        this.slip(A, V(v.x, 0, v.z).divideScalar(sp), sp);
        this.ctx.net?.send({ a: 'x', id: q.id });
        this.dropPeel(q.id);
        break;
      }
    }
  }
  slip(A, fwd, sp) {
    this.ctx.sfx('slip', this.vol(A.hero.pos, 1), { vary: 0.1 });
    if (A.god && A.noRagdoll) return;
    A.goRagdoll('collapse');
    A.slipQ = { fwd: fwd.clone(), k: clamp(sp / 4, 0.7, 1.6), t: 0 };
  }
  /** Airstrikes: red smoke off the flare, the jet coming in, then the bombs walking along the line. */
  runStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const S = this.strikes[i];
      S.t += dt;
      if (S.t < 6 && settings.fx) {
        const nz = S.flare.localToWorld(S.flare.userData.nozzle.clone());
        for (let k = Math.floor(30 * dt + Math.random()); k > 0; k--) {
          this.smoke.emit({ p: nz.clone(), v: V(rnd(-0.4, 0.4), rnd(1.2, 2.4), rnd(-0.4, 0.4)), life: rnd(3, 5), s0: 0.25, s1: rnd(1.8, 2.8), c0: [0.9, 0.12, 0.08], c1: [0.75, 0.3, 0.28], a0: 0.55, a1: 0, drag: 0.7, rise: 0.15 });
        }
      }
      if (!S.jet && S.t > 1.6) { S.jet = true; this.ctx.sfx('jet', Math.max(0.35, this.vol(S.c, 6))); }
      // the bombs, one after another from one end of the line to the other
      const T0 = 3, GAP = 0.16;
      while (S.n < STRIKE_N && S.t > T0 + S.n * GAP) {
        const u = S.n / (STRIKE_N - 1) - 0.5;
        const pt = S.c.clone().addScaledVector(S.dir, u * STRIKE_LEN).add(V(rnd(-1, 1), 0, rnd(-1, 1)));
        this.explode(this.floorAt(pt.setY(S.c.y + 3)), S.by, S.mine, 1.4);
        S.n++;
      }
      if (S.t > 9) { this.ctx.scene.remove(S.flare); this.strikes.splice(i, 1); }
    }
  }

  explode(p, by, mine, big = 1) {
    const { castSeg, actors } = this.ctx;
    const floor = castSeg(V(p.x, p.y + 0.2, p.z), V(p.x, p.y - 3, p.z));
    const c = p.clone(); c.y = (floor ? floor.point.y : p.y) + 0.12;
    this.boom(c, floor);
    this.ctx.onBlast?.(c, by);
    const R = 7.5 * Math.sqrt(big);
    for (const A of actors) {
      const h = A.hero;
      const chest = A.mode === 'ragdoll' && A.rd.active ? A.rd.pos('chest', V()) : h.chest.getWorldPosition(V());
      const d = chest.distanceTo(c);
      if (d > R) continue;
      // (a wall or a car between takes most of it)
      const wall = castSeg(c, chest);
      const cover = wall && wall.point.distanceTo(chest) > 0.35 ? 0.25 : 1;
      const f = (1 - d / R) ** 1.5 * cover;
      if (!A.remote) this.blastHit(A, c, f, d);
      if (mine) this.shred(A, c, by, f, cover);
    }
    // fragments flying everywhere else (real rounds: holes in walls, whoever's in the way)
    if (mine && this.ctx.fragment) for (let k = 0; k < 14; k++) {
      const d = V(rnd(-1, 1), rnd(-0.05, 0.5), rnd(-1, 1)).normalize();
      this.ctx.fragment(c.clone().addScaledVector(d, 0.05), d, by);
    }
  }

  /** Blasted people, once their ragdoll is live: every part thrown out from the blast. */
  fling(dt) {
    for (const A of this.ctx.actors) {
      const Q = A.slipQ;
      if (Q) {
        Q.t += dt;
        if (Q.t > 0.6 || A.remote) A.slipQ = null;
        else if (A.mode === 'ragdoll' && A.rd.active) {
          A.slipQ = null;
          // feet shoot out forward and up, the top goes over backwards
          for (const P of A.rd.list) {
            if (P.gone || !P.body) continue;
            const legs = /shin|foot|thigh/.test(P.name);
            const d = legs ? Q.fwd.clone().multiplyScalar(4.5).setY(4) : Q.fwd.clone().multiplyScalar(-1.6).setY(0.6);
            A.rd.impulseAt(P.name, d.multiplyScalar(Q.k * P.mass), A.rd.pos(P.name, V()));
          }
        }
      }
      const B = A.blastQ;
      if (!B) continue;
      B.t += dt;
      if (B.t > 0.6 || A.remote) { A.blastQ = null; continue; }
      if (A.mode !== 'ragdoll' || !A.rd.active) continue;
      A.blastQ = null;
      for (const P of A.rd.list) {
        if (P.gone || !P.body) continue;
        const at = A.rd.pos(P.name, V());
        const dir = at.clone().sub(B.c);
        const dist = Math.max(0.3, dir.length());
        dir.normalize().y += 0.45;
        // (closer parts get more: the body tumbles, it doesn't just slide)
        const dv = B.f * 11 * Math.min(1.6, 1.4 / dist + 0.4);
        A.rd.impulseAt(P.name, dir.normalize().multiplyScalar(dv * P.mass), at);
      }
    }
  }

  /** The blast itself, on someone this copy simulates: thrown, hurt, deafened. */
  blastHit(A, c, f, d) {
    if (f < 0.04 || A.god) return;
    const O = A.organs, npc = A.npc;
    if (npc) { npc.fearT = Math.max(npc.fearT || 0, 8); npc.fleeFrom = c.clone(); }
    if (f < 0.12) return;
    if (A.mode !== 'ragdoll') A.goRagdoll('collapse');
    // (flung next frame, once the bodies are live)
    A.blastQ = { c: c.clone(), f, t: 0 };
    if (O && !A.brain.dead) {
      // the shock wave: bleeding inside, knocked out, the eardrums and lungs gone close in
      O.blood -= f * f * 0.35;
      O.internal += f * 0.02;
      O.state.pain = 1;
      if (f > 0.45) O.state.lung = Math.min(2, O.state.lung + 1);
      if (f > 0.8 || d < 0.9) O.die();
      else if (f > 0.35) O.faint(rnd(3, 5) + f * 8);
      O.apply?.();
    }
  }

  /** Thrower's copy: the fragments that find this person, and the limbs torn off close in. */
  shred(A, c, by, f, cover) {
    if (A.god) return;
    const frag = this.ctx.fragment, sever = this.ctx.sever;
    if (frag && f > 0.02) {
      const n = Math.round(clamp(f * 7 + (Math.random() < f * 3 ? 1 : 0), 0, 7));
      const parts = Object.keys(A.groups);
      for (let k = 0; k < n; k++) {
        const g = A.groups[parts[(Math.random() * parts.length) | 0]];
        const at = g.getWorldPosition(V()).add(V(rnd(-0.08, 0.08), rnd(-0.12, 0.05), rnd(-0.08, 0.08)));
        const dir = at.sub(c).normalize();
        frag(c.clone().addScaledVector(dir, 0.05), dir, by);
      }
    }
    if (!sever || cover < 1 || !settings.dismember) return;
    // at the joints: whatever's closest to the blast is what goes
    const JOINTS = ['head', 'upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR', 'spine'];
    const near = [];
    for (const part of JOINTS) {
      const g = A.groups[part];
      if (!g || A.rd.parts[part]?.gone) continue;
      g.updateWorldMatrix(true, false);
      const j = g.getWorldPosition(V());
      const dj = j.distanceTo(c);
      const reach = part === 'spine' ? 0.7 : part === 'head' ? 1.3 : 2.1;
      const pr = clamp(1 - dj / reach, 0, 1) ** 1.2 * 0.95;
      if (Math.random() < pr) near.push({ part, j, dj, g });
    }
    near.sort((a, b) => a.dj - b.dj);
    let cuts = 0;
    for (const { part, j, g } of near) {
      if (cuts >= 4) break;
      if (A.rd.parts[part]?.gone) continue;
      const axis = V(0, 1, 0).transformDirection(g.matrixWorld);
      axis.add(V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3))).normalize();
      const away = j.clone().sub(c).normalize();
      const vel = away.multiplyScalar(14 * (0.5 + f)).add(V(0, 4, 0));
      if (sever(A, part, j, axis, vel)) cuts++;
    }
  }

  vol(p, v) {
    const d = this.ctx.camera.position.distanceTo(p);
    return v / (1 + (d / 9) ** 2);
  }

  // ---------- per frame ----------
  update(dt) {
    if (!(dt > 0)) return;
    const { renderer, camera } = this.ctx;
    const hgt = renderer.getDrawingBufferSize(_v2).y;
    const scale = hgt * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    this.collect();
    this.fly(dt);
    this.runFires(dt);
    this.runClouds(dt);
    this.people(dt);
    this.fling(dt);
    this.runNukes(dt);
    this.runPeels(dt);
    this.runStrikes(dt);
    if (this.strikeCd > 0) {
      const was = Math.ceil(this.strikeCd);
      this.strikeCd = Math.max(0, this.strikeCd - dt);
      if (Math.ceil(this.strikeCd) !== was) this.onPocket?.();
    }
    // (worked out fresh every frame: once both flashes are spent the light is off, whatever it was)
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = settings.fullbright ? 0 : Math.max(900 * (this.flashT / 0.25) ** 2, 60000 * (this.nukeFlash / 2.5) ** 3);
    this.fire.update(dt, scale);
    this.smoke.update(dt, scale);
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i];
      s.t += dt;
      // (a scorch fades out after a little while: gone half a minute after the blast)
      if (s.t > 20) s.mesh.material.opacity = s.o * Math.max(0, 1 - (s.t - 20) / 10);
      if (s.t > 30) { this.ctx.scene.remove(s.mesh); s.mesh.material.dispose(); this.scorches.splice(i, 1); }
    }
    // one crackle for all the fire near you
    let loud = 0;
    for (const f of this.fires) loud = Math.max(loud, this.vol(f.p, 0.9) * Math.min(1, f.t * 3, (f.dur - f.t) / 2));
    for (const A of this.ctx.actors) if (A.burnT > 0 || (A.remote && A.burnVis)) loud = Math.max(loud, this.vol(A.hero.pos, 0.6));
    loud = Math.max(loud, this.carLoud || 0); // (burning cars: carfire.js)
    this.ctx.fireLoop?.set(loud, 1);
  }

  fly(dt) {
    const { castSeg, actors, sfx } = this.ctx;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      // the lit rag
      if (f.kind === 'molotov') {
        const w = f.mesh.localToWorld(f.mesh.userData.wick.clone());
        this.fire.emit({ p: w, v: V(rnd(-0.2, 0.2), 0.5, rnd(-0.2, 0.2)), life: rnd(0.15, 0.3), s0: 0.12, s1: 0.03, c0: FLAME0, c1: FLAME1, a0: 1, a1: 0, drag: 2, rise: 2 });
      }
      if (f.remote && f.t > 10) { this.ctx.scene.remove(f.mesh); this.flying.splice(i, 1); continue; }
      const PJ = PROJECTILES[f.kind];
      if (PJ) { this.flyShot(f, PJ, dt, i); continue; }
      // the time bomb: its light blinks and it beeps, faster and faster
      if (f.kind === 'timebomb') {
        const u = clamp(f.t / FUSE.timebomb, 0, 1), gap = lerp(0.9, 0.08, u * u);
        f.beepT = (f.beepT || 0) + dt;
        if (f.beepT > gap) { f.beepT = 0; this.ctx.sfx('beep', this.vol(f.p, 0.9), { gap: 0.04 }); }
        f.mesh.userData.led.visible = f.beepT < Math.min(0.06, gap / 2);
        f.mesh.userData.hand.rotation.y = -u * Math.PI * 2;
      }
      if (!f.remote && FUSE[f.kind] && f.t > FUSE[f.kind]) { this.burst(f, f.p.clone()); continue; }
      if (f.rest) {
        // stopped: a ball's picked up again from here, a peel waits for a foot
        if (!f.remote && (f.kind === 'dodgeball' || f.kind === 'banana')) { this.burst(f, f.p.clone()); continue; }
        // a canister lies on its side; a peel or a bomb flat, the right way up
        const flat = f.mesh.userData.flat;
        if (f.kind !== 'molotov' && f.kind !== 'dodgeball') f.mesh.quaternion.slerp(flat ? _q.identity() : _q.setFromAxisAngle(V(1, 0, 0), Math.PI / 2), Math.min(1, dt * 10));
        continue;
      }
      const n = Math.max(1, Math.ceil(f.v.length() * dt / 0.2));
      const h = dt / n;
      let gone = false;
      for (let s = 0; s < n && !gone; s++) {
        f.v.y -= G * h;
        const nx = f.p.clone().addScaledVector(f.v, h);
        const hit = castSeg(f.p, nx);
        // (a person in the way: not the thrower in the first instant)
        const who = sweep(f.p, f.p, nx, nx, 0.06, actors, f.t < 0.25 ? f.by : null, null);
        if (who && (!hit || who.k <= hit.f)) {
          if (f.kind === 'molotov') {
            if (!f.remote) { this.burst(f, who.point.clone()); gone = true; }
            else { f.rest = true; f.p.copy(who.point); }
            break;
          }
          if (f.kind === 'dodgeball') {
            // a hard enough hit takes them off their feet (whoever this copy simulates)
            const sp = f.v.length(), A = who.actor;
            if (sp > 5 && A && !A.remote && !A.god && !A.seat) {
              A.goRagdoll('stumble', { balance: 0.4, decay: 0.35 });
              A.pending = { imp: f.v.clone().setY(0).normalize().multiplyScalar(40 + sp * 9).setY(6 + sp), local: V(0, 0.1, 0) };
            }
            sfx('ball', this.vol(f.p, clamp(sp / 10, 0.2, 1)), { vary: 0.12 });
            f.v.multiplyScalar(-0.35).y += 1.5;
            f.p.copy(who.point).addScaledVector(f.v.clone().normalize(), 0.15);
            continue;
          }
          f.v.multiplyScalar(-0.2).y += 1;
          sfx('clank', this.vol(f.p, 0.3), { vary: 0.15 });
          continue;
        }
        if (hit) {
          if (f.kind === 'molotov') {
            if (!f.remote) { this.burst(f, hit.point.clone()); gone = true; }
            else { f.rest = true; f.p.copy(hit.point); }
            break;
          }
          // the time bomb: stuck where it lands
          if (f.kind === 'timebomb') {
            f.p.copy(hit.point).addScaledVector(hit.normal, 0.03);
            f.v.set(0, 0, 0);
            f.rest = true;
            sfx('clank', this.vol(f.p, 0.5), { vary: 0.15, rate: 0.7 });
            break;
          }
          // canister: bounce and roll (a ball: bounces far more, a peel: barely)
          const ball = f.kind === 'dodgeball', peel = f.kind === 'banana';
          const nn = hit.normal, vn = f.v.dot(nn);
          const sp = -vn;
          f.v.addScaledVector(nn, -(ball ? 1.72 : peel ? 1.08 : 1.35) * vn);
          const tang = f.v.clone().addScaledVector(nn, -f.v.dot(nn));
          f.v.addScaledVector(tang, ball ? -0.12 : peel ? -0.8 : -0.3);
          f.p.copy(hit.point).addScaledVector(nn, ball ? 0.11 : 0.035);
          f.w *= 0.6;
          if (sp > 1.2 && f.t - f.lastClank > 0.08) { f.lastClank = f.t; sfx(ball ? 'ball' : peel ? 'paper' : 'clank', this.vol(f.p, clamp(sp / 8, 0.1, 0.8)), { vary: 0.15 }); }
          if (nn.y > 0.6 && f.v.length() < 0.5) { f.rest = true; f.v.set(0, 0, 0); break; }
          continue;
        }
        f.p.copy(nx);
      }
      if (gone) continue;
      f.mesh.position.copy(f.p);
      if (!f.rest) f.mesh.rotateOnWorldAxis(f.spin, f.w * dt);
    }
  }

  runFires(dt) {
    const F = this.fires;
    for (let i = F.length - 1; i >= 0; i--) {
      const f = F[i];
      f.t += dt;
      const life = Math.min(1, f.t * 4) * clamp((f.dur - f.t) / 3, 0, 1);
      if (f.t >= f.dur) { F.splice(i, 1); continue; }
      // (no real light: a glow over the pool, cheap)
      if (Math.random() < 0.5) this.fire.emit({ p: f.p.clone().setY(f.p.y + 0.4), v: V(), life: 0.25, s0: f.r * 2.6, s1: f.r * 2.4, c0: [0.5, 0.2, 0.05], c1: [0.4, 0.12, 0.02], a0: 0.14 * life, a1: 0.1 * life, drag: 0 });
      const rate = 90 * life * (f.r / 1.6) ** 2;
      for (let k = Math.floor(rate * dt + Math.random()); k > 0; k--) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * f.r;
        const p = V(f.p.x + Math.cos(a) * d, f.p.y + 0.03, f.p.z + Math.sin(a) * d);
        const edge = 1 - d / f.r;
        this.fire.emit({ p, v: V(rnd(-0.3, 0.3), rnd(0.5, 1.5), rnd(-0.3, 0.3)), life: rnd(0.4, 0.9) * (0.6 + edge * 0.6), s0: rnd(0.35, 0.6), s1: 0.08, c0: FLAME0, c1: FLAME1, a0: 0.85, a1: 0, drag: 1.5, rise: 2.5 });
        if (Math.random() < 0.18) this.smoke.emit({ p: p.clone().setY(p.y + 0.8), v: V(rnd(-0.2, 0.2), 1, rnd(-0.2, 0.2)), life: rnd(2, 3.5), s0: 0.4, s1: 1.8, c0: SMOKE0, c1: SMOKE1, a0: 0.45, a1: 0, drag: 0.6, rise: 0.4 });
      }
    }
  }

  runClouds(dt) {
    const C = this.clouds;
    for (let i = C.length - 1; i >= 0; i--) {
      const c = C[i];
      c.t += dt;
      if (c.t >= c.dur) { this.ctx.scene.remove(c.can); C.splice(i, 1); continue; }
      // it spreads, and drifts a little with the air
      c.r = lerp(0.4, 4.2, smooth(c.t / 5));
      c.c.x += dt * 0.06; c.c.z += dt * 0.03;
      const hiss = clamp(1 - (c.t - 9) / 5, 0, 1);
      const nz = c.can.localToWorld(c.can.userData.nozzle.clone());
      for (let k = Math.floor(28 * hiss * dt + Math.random()); k > 0; k--) {
        const d = V(rnd(-1, 1), rnd(0.2, 0.9), rnd(-1, 1)).normalize().multiplyScalar(rnd(1, 3));
        this.smoke.emit({ p: nz.clone(), v: d, life: rnd(3.5, 6), s0: 0.3, s1: rnd(2, 2.8), c0: GAS0, c1: GAS1, a0: 0.3, a1: 0, drag: 0.8, rise: 0.05 });
      }
      // the body of the cloud, filled in where it has spread
      const fade = clamp((c.dur - c.t) / 5, 0, 1);
      for (let k = Math.floor(14 * fade * dt * (c.r / 2) + Math.random()); k > 0; k--) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r * 0.9;
        this.smoke.emit({ p: V(c.c.x + Math.cos(a) * d, c.p.y + rnd(0.2, 1.6), c.c.z + Math.sin(a) * d), v: V(rnd(-0.2, 0.2), rnd(0, 0.1), rnd(-0.2, 0.2)), life: rnd(3, 5), s0: 1, s1: 2.6, c0: GAS0, c1: GAS1, a0: 0.2 * fade, a1: 0, drag: 0.5, rise: 0.02 });
      }
    }
  }

  /** How thick the gas is at `p`, 0..1. */
  gasAt(p) {
    let d = 0;
    for (const c of this.clouds) {
      const dy = p.y - c.p.y;
      if (dy < -0.8 || dy > 2.6) continue;
      const r = Math.hypot(p.x - c.c.x, p.z - c.c.z);
      if (r > c.r) continue;
      d = Math.max(d, (1 - 0.6 * r / c.r) * clamp((c.dur - c.t) / 5, 0, 1) * Math.min(1, c.t * 2));
    }
    return d;
  }
  fireAt(p) {
    for (const f of this.fires) {
      if (f.t < 0.1 || f.dur - f.t < 1.5) continue;
      const dy = p.y - f.p.y;
      if (dy < -0.6 || dy > 1.4) continue;
      if (Math.hypot(p.x - f.p.x, p.z - f.p.z) < f.r) return true;
    }
    return false;
  }

  people(dt) {
    const { actors, sfx } = this.ctx;
    for (const A of actors) {
      const dead = A.brain.dead;
      const at = A.mode === 'ragdoll' ? A.rd.pos('pelvis', _c) : _c.copy(A.hero.pos).setY(A.hero.pos.y + 0.3);
      const npc = A.npc;
      // ---- gas ----
      const g = dead ? 0 : this.gasAt(at);
      if (!A.remote && A.organs) {
        A.gasE = Math.max(0, (A.gasE || 0) + (g > 0 ? g * 1.1 : -0.4) * dt);
        const e = A.gasE;
        if (e > 0.05 && !dead) {
          const S = A.organs.state;
          S.pain = Math.max(S.pain, Math.min(0.8, e * 0.25));
          if (npc && g > 0) {
            const c = this.nearestCloud(at);
            npc.fearT = Math.max(npc.fearT, 3);
            if (c) npc.fleeFrom = c.c.clone();
            if (!A.gasSaid && e > 0.5) { A.gasSaid = true; npc.street?.say?.('scared', null, 'scared', true); }
          }
          if (e > 2.5 && A.mode === 'anim' && A.hero.grounded && !A.hero.action && Math.random() < dt * 0.5) A.goRagdoll('stumble', { balance: 0.5, decay: 0.55 });
          // (it burns the airways: the lungs bleed, the coughs bring blood up)
          if (e > 1.2) S.gasLung = Math.min(2, (S.gasLung || 0) + dt * 0.03 * Math.min(e, 5));
          if (S.gasLung > 0.4) S.lung = Math.max(S.lung, Math.min(2, S.gasLung));
          if (S.gasLung) A.organs.blood -= dt * 0.0025 * S.gasLung;
          if (e > 5) A.organs.faint(3);
          if (e > 8) A.organs.blood -= dt * 0.012;
          // a lungful too many: it's in them now, and it doesn't wear off
          if (e > 1.5) A.gassed = true;
        }
        // poisoned: out of the cloud or not, they reel about, fall, get up, and slowly go
        if (A.gassed && !dead) {
          const S = A.organs.state;
          S.pain = Math.max(S.pain, 0.4);
          S.lung = Math.max(S.lung, 0.6);
          A.organs.blood -= dt * 0.005;
          if (A.mode === 'anim' && A.hero.grounded && !A.hero.action && !A.seat && Math.random() < dt * 0.22) A.goRagdoll('stumble', { balance: 0.6, decay: 0.45 });
          if (npc && Math.random() < dt * 0.3) { npc.fearT = Math.max(npc.fearT, 2); npc.fleeFrom = at.clone().add(V(rnd(-2, 2), 0, rnd(-2, 2))); }
        }
        if (e <= 0.05) A.gasSaid = false;
      }
      // coughing, heard on every copy
      // (time in it, kept on every copy: how raw the lungs are, and so whether blood comes up)
      A.gasIn = Math.max(0, (A.gasIn || 0) + (g > 0.05 ? g * dt : -dt * 0.05));
      if ((g > 0.05 || A.gassed) && !dead) {
        A.coughT = (A.coughT ?? rnd(0.3, 1)) - dt;
        if (A.coughT <= 0) {
          A.coughT = rnd(1.2, 2.6);
          sfx('cough', this.vol(at, 0.7), { vary: 0.12, voices: 4, gap: 0.05, rate: A.hero.S ? 1 / A.hero.S : 1 });
          if (A.gasIn > 1.8 && Math.random() < Math.min(0.9, A.gasIn / 6)) A.organs?.cough();
          else if (A.mode === 'ragdoll' && !A.remote) A.pending ||= { imp: V(0, 3, 0), part: 'chest', point: A.rd.point('chest', V(0, 0.1, 0.08)) };
        }
      }
      // ---- fire ----
      if (!A.remote && A.organs) {
        const hot = this.fireAt(at);
        if (hot) A.burnT = Math.max(A.burnT || 0, 7);
        if (A.burnT > 0) {
          // down on the ground it rolls out faster
          A.burnT -= dt * (A.mode === 'ragdoll' && !dead ? 2.4 : 1);
          if (!dead) {
            A.organs.blood -= dt * (0.024 + (hot ? 0.02 : 0));
            A.organs.state.pain = 1;
            if (npc) {
              // running blind, anywhere
              A.panicT = (A.panicT || 0) - dt;
              if (A.panicT <= 0) {
                A.panicT = rnd(0.6, 1.2);
                npc.fearT = Math.max(npc.fearT, 2.5);
                npc.fleeFrom = A.hero.pos.clone().add(V(rnd(-1, 1), 0, rnd(-1, 1)));
                if (Math.random() < 0.5) npc.street?.say?.('scared', null, 'scared', true);
              }
            }
            this.ctx.onHurt?.(A, 'fire');
          }
          // it catches whoever's close
          for (const B of actors) {
            if (B === A || B.remote || B.burnT > 0) continue;
            const bp = B.mode === 'ragdoll' ? B.rd.pos('pelvis', _b) : _b.copy(B.hero.pos).setY(B.hero.pos.y + 0.3);
            if (bp.distanceToSquared(at) < 0.8 * 0.8 && Math.random() < dt * 1.5) B.burnT = 6;
          }
          if (A.burnT <= 0) A.burnT = 0;
        }
      }
      const burning = A.burnT > 0 || (A.remote && A.burnVis);
      if (burning) this.flames(A, dt);
      this.react(A, burning, dt);
    }
  }
  /**
   * On fire: arms thrown about and beating at the flames, the body twisting, a scream now and
   * then; the street's people drop and roll (or just go down), and down there they writhe.
   * The char creeps over them the longer it lasts. (Poses go out in snapshots, so a copy of
   * someone burning flails because they do; the scream and the char happen on every copy.)
   */
  react(A, burning, dt) {
    const dead = A.brain.dead, h = A.hero;
    // ---- screams (every copy) ----
    if (burning && !dead && settings.screams) {
      A.screamT = (A.screamT ?? rnd(0, 0.4)) - dt;
      if (A.screamT <= 0) {
        A.screamT = rnd(1.4, 3);
        this.ctx.sfx('scream', this.vol(h.pos, 1.1), { vary: 0.12, voices: 3, gap: 0.1, rate: (A.look?.female ? 1.25 : 1) / (h.S || 1) });
      }
    } else A.screamT = undefined;
    // ---- the char (every copy) ----
    if (dead !== A._wasDead) { if (!dead && A._wasDead) this.uncharr(A); A._wasDead = dead; }
    if (!settings.charring) { if (A.charK) this.uncharr(A); }
    else {
      if (burning) A.charK = Math.min(0.85, (A.charK || 0) + dt * 0.06);
      if (A.charK > 0) this.char(A);
    }
    if (A.remote) return;
    // ---- flailing (ours) ----
    const hero = A === this.ctx.hero;
    const flail = burning && !dead && A.mode === 'anim' && !A.seat && !(hero && (A.gunHeld || A.meleeHeld));
    if (flail) {
      if (!hero) { A.gunHeld?.drop(); A.meleeHeldL?.drop(true); A.meleeHeld?.drop(); }
      if (!A._flail || h.armHook !== A._flail.hook) flailOn(A);
      // (the street's people: sooner or later they throw themselves down and roll)
      A.burnRunT = (A.burnRunT || 0) + dt;
      if (A.npc && A.burnRunT > 1.5 && h.grounded && !h.action && Math.random() < dt * 0.35) {
        A.goRagdoll('collapse');
        A.burnRunT = -rnd(1, 3);
      }
    } else if (A._flail) flailOff(A);
    // ---- writhing on the ground (ours) ----
    if (burning && !dead && A.mode === 'ragdoll' && A.rd) {
      A.writheT = (A.writheT || 0) - dt;
      if (A.writheT <= 0 && !A.pending) {
        A.writheT = rnd(0.12, 0.35);
        const part = WRITHE[(Math.random() * WRITHE.length) | 0];
        const k = part.startsWith('chest') || part === 'pelvis' ? rnd(8, 14) : rnd(2.5, 6);
        A.pending = { imp: V(rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(k), part, point: A.rd.point(part, V()) };
      }
    }
  }
  /** Darken every material of theirs toward charcoal, by A.charK (remembering the real colours). */
  char(A) {
    const M = A.hero.mat;
    if (!M) return;
    const base = (A._charBase ||= new Map());
    for (const k in M) {
      const m = M[k];
      if (!m?.color || k === 'eye') continue;
      if (!base.has(m)) base.set(m, m.color.clone());
      m.color.copy(base.get(m)).lerp(CHAR, A.charK * (k === 'iris' ? 0 : 1));
      if (k === 'skin') m.roughness = 0.62 + A.charK * 0.35;
    }
  }
  uncharr(A) {
    if (A._charBase) for (const [m, c] of A._charBase) m.color.copy(c);
    if (A.hero.mat?.skin) A.hero.mat.skin.roughness = 0.62;
    A._charBase = null;
    A.charK = 0;
  }

  nearestCloud(p) {
    let best = null, bd = 1e9;
    for (const c of this.clouds) { const d = c.c.distanceToSquared(p); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /** Flames all over someone. */
  flames(A, dt) {
    const parts = Object.values(A.groups);
    for (let k = Math.floor(55 * dt + Math.random()); k > 0; k--) {
      const g = parts[(Math.random() * parts.length) | 0];
      if (!g.visible && g.parent) continue;
      const p = g.getWorldPosition(_p).add(V(rnd(-0.07, 0.07), rnd(-0.05, 0.1), rnd(-0.07, 0.07)));
      this.fire.emit({ p: p.clone(), v: V(rnd(-0.2, 0.2), rnd(0.4, 1), rnd(-0.2, 0.2)), life: rnd(0.25, 0.5), s0: rnd(0.2, 0.35), s1: 0.05, c0: FLAME0, c1: FLAME1, a0: 0.9, a1: 0, drag: 1.5, rise: 2.5 });
      if (Math.random() < 0.12) this.smoke.emit({ p: p.clone().setY(p.y + 0.4), v: V(0, 0.8, 0), life: rnd(1.5, 2.5), s0: 0.25, s1: 1.2, c0: SMOKE0, c1: SMOKE1, a0: 0.35, a1: 0, drag: 0.6, rise: 0.3 });
    }
  }

  /** Everything gone (level reset). */
  clear() {
    for (const f of this.flying) this.ctx.scene.remove(f.mesh);
    for (const k of this.pickups) this.ctx.scene.remove(k.mesh);
    this.pickups.length = 0;
    for (const c of this.clouds) this.ctx.scene.remove(c.can);
    for (const s of this.scorches) { this.ctx.scene.remove(s.mesh); s.mesh.material.dispose(); }
    this.flying.length = this.clouds.length = this.fires.length = this.scorches.length = 0;
    this.fire.clear();
    this.smoke.clear();
    for (const A of this.ctx.actors) { A.burnT = 0; A.gasE = 0; A.gasIn = 0; A.gassed = false; A.blastQ = null; if (A._flail) flailOff(A); if (A.charK) this.uncharr(A); }
  }
}
const _v2 = new THREE.Vector2(), _q = new THREE.Quaternion(), _c = V(), _b = V(), _p = V(), _v = V();
const CHAR = new THREE.Color(0x17100b);
const WRITHE = ['foreL', 'foreR', 'upperL', 'upperR', 'shinL', 'shinR', 'thighL', 'thighR', 'chest', 'pelvis'];

// ---------------------------------------------------------------------------------------
// Flailing: both arms thrown up round the head, beating at the body, the torso wrenching
// ---------------------------------------------------------------------------------------
function flailOn(A) {
  const h = A.hero;
  const F = { t: rnd(0, 10), prev: h.armHook, ph: [rnd(0, 6), rnd(0, 6), rnd(0, 6), rnd(0, 6)], w: rnd(9, 13) };
  F.hook = (hh, dt) => {
    // (whatever else the arms were doing runs underneath)
    if (F.prev) { F.prev(hh, dt); if (hh.armHook !== F.hook) { F.prev = hh.armHook; hh.armHook = F.hook; } }
    flailPose(hh, F, dt);
  };
  A._flail = F;
  h.armHook = F.hook;
}
function flailOff(A) {
  const F = A._flail, h = A.hero;
  if (h.armHook === F.hook) h.armHook = F.prev;
  h.twist = h.bend = 0;
  A._flail = null;
}
const _fo = V(), _fq = new THREE.Quaternion(), _fw = V(), _fwq = new THREE.Quaternion(), _fs = V(), _fp = V();
function flailPose(h, F, dt) {
  F.t += dt;
  const t = F.t, w = F.w;
  bodyFrame(h, _fo, _fq);
  // the torso wrenches about
  h.twist = 0.4 * Math.sin(t * 6.3 + F.ph[0]) + 0.15 * Math.sin(t * 15);
  h.bend = 0.12 + 0.1 * Math.sin(t * 4.7 + F.ph[1]);
  const f = h.forward(V());
  // every so often: a few beats of slapping at the chest instead of waving
  const pat = Math.sin(t * 0.9 + F.ph[3]) > 0.55;
  for (const a of h.arms) {
    const side = a.side, ph = F.ph[a === h.arms[0] ? 1 : 2];
    let p;
    if (pat) {
      const k = Math.abs(Math.sin(t * w * 0.8 + ph));
      p = V(side * lerp(0.05, 0.2, k), lerp(-0.05, 0.12, Math.sin(t * 3 + ph) * 0.5 + 0.5), lerp(0.14, 0.34, k));
    } else {
      // wild loops round the head and out to the sides
      p = V(side * (0.28 + 0.14 * Math.sin(t * w + ph)), 0.3 + 0.2 * Math.sin(t * w * 1.37 + ph * 2), 0.12 + 0.2 * Math.cos(t * w * 0.83 + ph));
    }
    a.hand.updateWorldMatrix(true, false);
    a.hand.matrixWorld.decompose(_fw, _fwq, _fs);
    const wp = p.applyQuaternion(_fq).add(_fo);
    const outSide = V(f.z, 0, -f.x).multiplyScalar(side);
    _fp.copy(outSide).multiplyScalar(0.8).addScaledVector(UP, -0.5).addScaledVector(f, -0.2).normalize();
    poseArm(h, a, wp, _fwq, _fp);
    curl(a, 0.15 + 0.5 * (Math.sin(t * 13 + ph) * 0.5 + 0.5));
  }
}

// ---------------------------------------------------------------------------------------
// Your arm: hold to wind up over the shoulder (the arc shows where it'll land), let go to throw
// ---------------------------------------------------------------------------------------
export class Thrower {
  /** ctx: { sys: Throwables, scene, aimDir(): Vector3, sfx } */
  constructor(actor, ctx) {
    this.actor = actor;
    this.ctx = ctx;
    this.p = null;
    this.hook = (h, dt) => this.pose(h, dt);
    const N = 40;
    this.arcPts = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.arcPts, 3));
    this.arc = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.6, depthTest: false }));
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 5;
    this.arc.visible = false;
    ctx.scene.add(this.arc);
  }
  get busy() { return !!this.p; }

  press() {
    const A = this.actor, h = A.hero, kind = this.ctx.sys.ready;
    if (!kind || this.p || A.mode !== 'anim' || A.seat) return false;
    // (an airstrike on its cooldown: not yet)
    if (kind === 'airstrike' && this.ctx.sys.strikeCd > 0) { this.ctx.sfx('dry', 0.5); return false; }
    // (something in the right hand already: it stays there, the left one throws)
    const arm = A.gunHeld || A.meleeHeld ? 0 : 1;
    if (!A.organs.canHold(arm)) return false;
    const mesh = THROWABLES[kind].build();
    this.ctx.scene.add(mesh);
    this.p = { t: 0, kind, mesh, held: true, relT: -1, prevHook: h.armHook, thrown: false, arm };
    h.armHook = this.hook;
    if (kind !== 'molotov' && !THROWABLES[kind].noPin) this.ctx.sfx('pin', 0.5, { vary: 0.1 });
    return true;
  }
  release() { if (this.p && this.p.held) { this.p.held = false; this.p.relT = this.p.t; } }
  cancel() {
    const P = this.p;
    if (!P) return;
    const h = this.actor.hero;
    if (h.armHook === this.hook) h.armHook = P.prevHook;
    if (!P.prevHook) h.twist = 0;
    if (!P.thrown) this.ctx.scene.remove(P.mesh);
    this.arc.visible = false;
    this.p = null;
  }
  update() {
    const A = this.actor;
    if (this.p && (A.mode !== 'anim' || A.seat || A.hero.armHook !== this.hook)) this.cancel();
  }

  /** How hard: builds while held. */
  power(P) { return 0.45 + 0.55 * smooth(Math.min(P.relT >= 0 ? P.relT : P.t, 0.7) / 0.7); }
  velocity(P) {
    const d = this.ctx.aimDir().clone();
    d.y += 0.22;
    d.normalize();
    return d.multiplyScalar(lerp(7, 17, (this.power(P) - 0.45) / 0.55)).add(this.actor.hero.vel || V());
  }

  pose(h, dt) {
    const P = this.p;
    if (!P) return;
    // (a gun or blade in the other hand keeps being held underneath)
    if (P.prevHook) {
      P.prevHook(h, dt);
      if (h.armHook !== this.hook) { P.prevHook = h.armHook; h.armHook = this.hook; }
    }
    P.t += dt;
    const a = h.arms[P.arm], side = a.side;
    const O = V(), yq = new THREE.Quaternion();
    bodyFrame(h, O, yq);
    const iq = yq.clone().invert();
    a.hand.updateWorldMatrix(true, false);
    const lw = V(), lwq = new THREE.Quaternion();
    a.hand.matrixWorld.decompose(lw, lwq, _s);
    const loco = lw.clone().sub(O).applyQuaternion(iq), locoQ = iq.clone().multiply(lwq);
    const back = V(side * 0.24, 0.2, -0.22), fwd = V(side * 0.08, 0.16, 0.5), after = V(side * -0.08, -0.25, 0.35);
    // wind up (while held) -> whip over -> follow through -> back
    const TW = 0.22, TT = 0.1, TF = 0.35;
    let p, tw;
    if (P.held || P.t < TW) { const u = smooth(P.t / TW); p = loco.clone().lerp(back, u); tw = -0.45 * u; }
    else {
      const s = P.t - Math.max(P.relT, TW);
      if (s < TT) { const u = smooth(s / TT); p = back.clone().lerp(fwd, u); tw = lerp(-0.45, 0.5, u); if (u > 0.55 && !P.thrown) this.letFly(P); }
      else if (s < TT + TF) { const u = smooth((s - TT) / TF); p = fwd.clone().lerp(after, u); tw = 0.5 * (1 - u * 0.4); if (!P.thrown) this.letFly(P); }
      else {
        const u = smooth((s - TT - TF) / 0.3);
        p = after.clone().lerp(loco, u); tw = 0.3 * (1 - u);
        if (u >= 1) { this.cancel(); return; }
      }
    }
    h.twist = P.arm === 1 ? tw : -tw;
    const wp = p.applyQuaternion(yq).add(O);
    const f = h.forward(V());
    const outSide = V(f.z, 0, -f.x).multiplyScalar(side);
    _pole.copy(outSide).multiplyScalar(0.8).addScaledVector(UP, -0.6).addScaledVector(f, -0.3).normalize();
    poseArm(h, a, wp, lwq, _pole);
    curl(a, P.thrown ? 0.2 : 0.9);
    if (!P.thrown) {
      a.hand.updateWorldMatrix(true, false);
      a.hand.matrixWorld.decompose(_hp, _hq, _s);
      P.mesh.position.copy(_hp).add(V(0, -0.06, 0).applyQuaternion(_hq));
      P.mesh.quaternion.copy(_hq);
      if (P.kind === 'molotov') {
        const w = P.mesh.localToWorld(P.mesh.userData.wick.clone());
        this.ctx.sys.fire.emit({ p: w, v: V(0, 0.4, 0), life: rnd(0.15, 0.3), s0: 0.1, s1: 0.03, c0: FLAME0, c1: FLAME1, a0: 1, a1: 0, drag: 2, rise: 2 });
      }
      this.drawArc(P);
    }
  }

  letFly(P) {
    P.thrown = true;
    this.arc.visible = false;
    this.ctx.scene.remove(P.mesh);
    if (!this.ctx.sys.take(P.kind)) return;
    const from = P.mesh.position.clone();
    this.ctx.sys.launch(P.kind, this.actor, from, this.velocity(P));
    this.ctx.sfx('whoosh', 0.45, { rate: 0.85, vary: 0.1 });
  }

  drawArc(P) {
    const cast = this.ctx.sys.ctx.castSeg;
    const p = P.mesh.position.clone(), v = this.velocity(P);
    const N = this.arcPts.length / 3;
    let n = 0;
    for (; n < N; n++) {
      this.arcPts[n * 3] = p.x; this.arcPts[n * 3 + 1] = p.y; this.arcPts[n * 3 + 2] = p.z;
      const h = 0.05;
      v.y -= G * h;
      const nx = p.clone().addScaledVector(v, h);
      const hit = n > 1 && cast(p, nx);
      if (hit) { n++; this.arcPts[n * 3] = hit.point.x; this.arcPts[n * 3 + 1] = hit.point.y; this.arcPts[n * 3 + 2] = hit.point.z; n++; break; }
      p.copy(nx);
    }
    n = Math.min(n, N);
    const geo = this.arc.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, n);
    geo.computeBoundingSphere();
    this.arc.computeLineDistances();
    this.arc.visible = true;
  }
}
const _s = V(), _pole = V(), _hp = V(), _hq = new THREE.Quaternion();
