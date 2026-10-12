import { settings, bloodCount } from './settings.js';
import * as THREE from 'three';
import { BloodSurfaces } from './bloodsurf.js';
import { Wounds } from './wounds.js';
import { Organs } from './organs.js';
import { dropHitsCar } from './carstain.js';
import { INKS, inkOf, shade, noInk, isVomit, RAINBOW, PRISM, GALAXY, prismHue, prismRGB, setPrismHue } from './inks.js';
import { Arteries } from './artery.js';
import { capsuleOf } from './strike.js';

/*
  Blood + injury system. Owns:
    - droplets in flight (instanced, stretched along velocity, gravity + drag)
    - the floor surface they land on (BloodFloor: splats, smears, footprints)
    - per-character Wounds (bruises, scratches, cuts, drips, wet parts)
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const MAX = 1400;
const G = 9.81;
const rnd = (a, b) => a + Math.random() * (b - a);

const _a = V(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V(), _d = V();
const _lo = V(), _hi = V(), _mid = V(), _ab = V(), _ap = V();
/** Squared distance from p to segment a-b. */
function segDist2(a, b, p) {
  _ab.subVectors(b, a); _ap.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / (_ab.lengthSq() || 1)));
  return _ap.addScaledVector(_ab, -t).lengthSq();
}
const UPY = V(0, 1, 0);
// a drop's colour in each ink (inks.js)
const DROP = INKS.map((_, i) => new THREE.Color().setRGB(...shade(i, 0x7a / 255, 0x05 / 255, 0x08 / 255), THREE.SRGBColorSpace));

// rainbow blood (inks.js): every drop its own bright colour
const rainbowDrop = () => new THREE.Color().setHSL(Math.random(), 0.95, 0.45);
// prism blood: the colour of the injury it came out of
const prismDrop = (h) => new THREE.Color().setRGB(...prismRGB(h, 0.85), THREE.SRGBColorSpace);
// galaxy blood: deep purples and blues, now and then a pink one
const GALAXY_DROPS = [0x4a1a8c, 0x2a1570, 0x1d3a9a, 0x6a1f9e, 0xb0307a].map((h) => new THREE.Color(h));
const galaxyDrop = () => GALAXY_DROPS[(Math.random() * GALAXY_DROPS.length) | 0].clone();
const dropCol = (ink) => (ink === RAINBOW ? rainbowDrop() : ink === PRISM ? prismDrop(prismHue()) : ink === GALAXY ? galaxyDrop() : null);


/** The airborne drops: a Points cloud of round sprites, sized in metres (each drop its own). */
function dropSprites() {
  const g = new THREE.BufferGeometry();
  const mk = (k) => new THREE.BufferAttribute(new Float32Array(MAX * k), k).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', mk(3));
  g.setAttribute('color', mk(3));
  g.setAttribute('size', mk(1));
  g.setDrawRange(0, 0);
  const uni = { uScale: { value: 500 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni,
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      uniform float uScale;
      varying vec3 vCol;
      void main() {
        vCol = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // metres -> pixels at this distance (never under ~1.5 px: far drops still read)
        gl_PointSize = max(1.5, size * projectionMatrix[1][1] * uScale / -mv.z);
      }`,
    fragmentShader: `
      varying vec3 vCol;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float d = dot(q, q);
        if (d > 1.0) discard;
        // darker at the rim, a small glint up and to the left
        vec3 c = vCol * (1.0 - 0.35 * d);
        c += vec3(0.5) * smoothstep(0.12, 0.0, dot(q - vec2(-0.35, -0.35), q - vec2(-0.35, -0.35)));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  // half the viewport's height in pixels (per eye in a headset): what turns metres into point size
  const vp = new THREE.Vector4();
  pts.onBeforeRender = (renderer) => { renderer.getCurrentViewport(vp); uni.uScale.value = vp.w / 2; };
  return pts;
}

export class BloodSystem {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.floor = new BloodSurfaces(scene, colliders);
    this.arteries = new Arteries(this);
    this.people = [];
    // drops in the air: flat 2D sprites (one point each, a round drop with a glint) - no geometry,
    // no lighting, one draw for all of them
    this.mesh = dropSprites();
    // Which blood the next spray / drip is: an ink index, 0 red (see inked). Read once, then red again.
    this.ink = 0;
    scene.add(this.mesh);
    this.p = []; // { pos, vel, r, age }
    this.cars = null; // set by main: every car, for drops landing on them
    // set by main: the sound player and where the ears are (the camera)
    this.sfx = null;
    this.listener = null;
    this.landW = 0; this.landAt = new THREE.Vector3(); this.landD = Infinity; this.splatT = 0;
  }

  /** A drop hit something solid: gathered up into one splash sound a little later. */
  landed(p, at) {
    const d = this.listener ? this.listener.distanceToSquared(at) : 0;
    if (d > 900) return; // (30 m: out of earshot)
    const k = p.r / 0.006;
    this.landW += p.heavy ? k * k * 0.15 : k * k;
    if (d < this.landD) { this.landD = d; this.landAt.copy(at); }
  }
  /**
   * The splash: at most one every ~0.1-0.18 s, however many drops came down; louder, longer
   * and lower for a real gush than for a few drops; always a slightly different pitch; quieter
   * with distance, and never more than three at once.
   */
  splatSound(dt) {
    this.splatT -= dt;
    // (quiet for a moment: the backoff wears off)
    if (this.splatT < -0.4) this.splatRun = 0;
    // (a stray drop or two now and then never adds up to a splash)
    this.landW *= Math.exp(-3 * dt);
    if (this.landW < 0.05) this.landD = Infinity;
    if (!this.sfx || this.splatT > 0 || this.landW < 2) return;
    const amt = Math.min(1, this.landW / 30);
    const att = 1 / (1 + this.landD / 25);
    this.sfx('splat', (0.07 + 0.3 * amt) * att, {
      rate: 1.3 - 0.4 * amt, vary: 0.12, voices: 3, gap: 0.08, len: 0.3 + 1.2 * amt * amt,
    });
    // blood that keeps on coming (a stump pumping, a piece bleeding as it rolls) backs off:
    // each splash straight after another waits longer before the next
    this.splatRun = Math.min(6, (this.splatRun || 0) + 1);
    this.splatT = (0.1 + Math.random() * 0.08 + amt * 0.08) * (1 + this.splatRun * 0.8);
    this.landW = 0; this.landD = Infinity;
  }

  addActor(actor) {
    const w = new Wounds(actor, this);
    actor.wounds = w;
    // organs go in after the wounds have collected the body surface meshes
    actor.organs = new Organs(actor, this);
    this.people.push(w);
    return w;
  }

  /** Someone gone from the world (a map switch): no more bleeding, dripping, coughing or throwing up. */
  removeActor(actor) {
    const i = this.people.findIndex((w) => w.actor === actor);
    if (i >= 0) this.people.splice(i, 1);
    const W = actor.wounds;
    if (W) { try { W.heal(); } catch (e) { /* half-built */ } }
    try { actor.organs?.heal?.(); } catch (e) { /* (nothing to heal) */ }
    if (this.caps) this.caps = this.caps.filter((B) => B.A !== actor);
  }

  /** The next spray / drip (only that one) is this actor's blood colour. */
  inked(who) {
    this.ink = inkOf(who);
    this.src = who && who.hero ? who : null;
    return this;
  }
  takeInk() { const b = this.ink; this.ink = 0; this.srcNow = this.src; this.src = null; return b; }

  /** Fling n droplets from `at` along `dir` (unit) at ~speed, in a cone of `spread` radians. */
  spray(at, dir, speed, n, spread = 0.5, size = 1, baseVel = null) {
    const ink = this.takeInk();
    if (!settings.blood || !settings.bloodSpray || noInk(ink)) return;
    n = bloodCount(n);
    for (let i = 0; i < n; i++) {
      if (this.p.length >= MAX) this.p.shift();
      const d = dir.clone();
      d.x += rnd(-spread, spread); d.y += rnd(-spread, spread) * 0.7; d.z += rnd(-spread, spread);
      d.normalize().multiplyScalar(speed * rnd(0.35, 1.15));
      if (baseVel) d.add(baseVel);
      this.p.push({ pos: at.clone(), vel: d, r: rnd(0.0035, 0.0105) * size, age: 0, ink, col: dropCol(ink), hue: ink === PRISM ? prismHue() : null, src: this.srcNow, vomit: isVomit(ink) });
    }
  }
  /** One heavy falling drop (from a drip or a soaked part). */
  drip(at, vel, r = 0.006) {
    const ink = this.takeInk();
    if (!settings.blood || !settings.bloodSpray || !(settings.bloodAmount > 0) || noInk(ink)) return;
    if (this.p.length >= MAX) this.p.shift();
    this.p.push({ pos: at.clone(), vel: vel.clone(), r, age: 0, heavy: true, src: this.srcNow, ink, col: dropCol(ink), hue: ink === PRISM ? prismHue() : null });
  }

  /**
   * This frame's bodies near any drop in the air, as world capsules (each part's), for drops to
   * land on. Only people within reach of the spray are looked at.
   */
  bodyCaps(P) {
    this.caps = [];
    if (!P.length || !settings.blood) return;
    // the box round the drops in the air
    const lo = _lo.set(Infinity, Infinity, Infinity), hi = _hi.set(-Infinity, -Infinity, -Infinity);
    for (const p of P) { lo.min(p.pos); hi.max(p.pos); }
    lo.subScalar(1.3); hi.addScalar(1.3);
    for (const w of this.people) {
      const A = w.actor, h = A.hero;
      if (!h.root.parent || !A.rd || A.seat) continue;
      const c = h.pos;
      if (c.x < lo.x || c.x > hi.x || c.z < lo.z || c.z > hi.z || c.y + 2 < lo.y || c.y - 1 > hi.y) continue;
      const rag = A.mode === 'ragdoll' && !A.remote;
      const B = { A, c: (rag ? A.rd.pos('pelvis', V()) : c.clone().setY(c.y + 0.9)), parts: [] };
      this.caps.push(B);
      for (const name of Object.keys(A.groups)) {
        if (A.rd.parts[name]?.gone) continue;
        const cap = capsuleOf(A, name);
        if (!cap) continue;
        let a, b;
        if (rag) { A.rd.quat(name, _q); A.rd.pos(name, _s); a = cap.a.clone().applyQuaternion(_q).add(_s); b = cap.b.clone().applyQuaternion(_q).add(_s); }
        else { const g = A.groups[name]; g.updateWorldMatrix(true, false); a = cap.a.clone().applyMatrix4(g.matrixWorld); b = cap.b.clone().applyMatrix4(g.matrixWorld); }
        B.parts.push({ A, name, a, b, r: cap.r + 0.01 });
      }
    }
  }
  /** The body part a drop went into this step (not its own body, just after it came out). */
  hitBody(p, prev) {
    for (const B of this.caps) {
      if ((B.A === p.src && p.age < 0.25) || B.c.distanceToSquared(p.pos) > 1.44) continue;
      for (const C of B.parts) if (segDist2(C.a, C.b, p.pos) < C.r * C.r || segDist2(C.a, C.b, _mid.addVectors(prev, p.pos).multiplyScalar(0.5)) < C.r * C.r) return C;
    }
    return null;
  }

  /** Airborne drops and every stain in the world gone. */
  clear() {
    this.p.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
    this.floor.clear();
    this.arteries.clear();
  }

  update(dt) {
    const budget = { n: 6 }; // stain texture uploads this frame
    for (const w of this.people) w.update(dt, budget);
    for (const w of this.people) w.actor.organs.update(dt);
    this.arteries.update(dt);
    const P = this.p, cols = this.colliders, cars = this.cars;
    this.bodyCaps(P);
    let paint = 10; // (people splashed this frame: a stain paint each)
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.age += dt;
      const k = Math.exp(-(p.heavy ? 0.2 : 0.9) * dt); // small droplets feel the air
      p.vel.multiplyScalar(k);
      p.vel.y -= G * dt;
      const prev = _a.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      const size = p.r * (1.7 + Math.min(2.2, p.vel.length() * 0.22));
      // cars: painted into the car itself
      let onCar = false;
      if (cars) for (let c = 0; c < cars.length && !onCar; c++) onCar = dropHitsCar(cars[c], prev, p.pos, p.vel, size, p.heavy ? 0.9 : 0.6);
      if (onCar) continue;
      // people: it lands on whoever's in the way (their skin, their clothes)
      if (this.caps.length && !p.heavy) {
        const on = this.hitBody(p, prev);
        if (on) {
          if (paint-- > 0) {
            const W = on.A.wounds;
            _d.copy(p.vel).normalize().negate();
            const sz = Math.min(0.05, size * 1.6);
            // (its own blood: into its own blood stains; anyone else's - or vomit - in its colour)
            if (p.ink === inkOf(on.A) && !isVomit(p.ink)) W?.stamp(on.name, p.pos, _d, p.vel, 'splash', sz, sz * rnd(0.6, 1), 0.8);
            else W?.splashForeign(on.name, p.pos, _d, p.vel, p.ink, sz * (p.vomit ? 1.5 : 1), p.vomit ? 0.9 : 0.8);
            if (W?.parts[on.name] && !isVomit(p.ink)) W.wetPart(W.parts[on.name], 0.03, p.ink);
            // (our own people's blood: every other copy of that body gets the same stain, mp.js)
            if (this.onStain && p.src && !p.src.remote) this.onStain(on.A, on.name, p.pos, _d, p.vel, p.ink, sz * (p.vomit ? 1.5 : 1), !!p.vomit);
          }
          continue;
        }
      }
      // props: tops and sides of boxes
      const hit = this.floor.hitBox(prev, p.pos);
      if (hit) {
        this.landed(p, hit.point);
        this.floor.ink = p.ink; this.floor.by(p.src);
        if (p.hue != null) setPrismHue(p.hue);
        if (p.heavy && p.r < 0.006) this.floor.drop(hit.surf, hit.point, p.vel, p.r);
        else this.floor.splat(hit.surf, hit.point, p.vel, size, p.heavy ? 0.9 : 0.6);
        continue;
      }
      if (p.pos.y <= 0.002) {
        p.pos.y = 0;
        this.landed(p, p.pos);
        const S = this.floor.floorTile(p.pos.x, p.pos.z);
        this.floor.ink = p.ink; this.floor.by(p.src);
        if (p.hue != null) setPrismHue(p.hue);
        if (p.heavy && p.r < 0.006) this.floor.drop(S, p.pos, p.vel, p.r);
        else this.floor.splat(S, p.pos, p.vel, size, p.heavy ? 0.9 : 0.6);
        continue; // landed
      }
      if (p.age > 4) continue;
      P[n++] = p;
    }
    P.length = n;
    this.splatSound(dt);

    // draw: one sprite per drop, a little bigger the faster it's going (motion blur, cheaply)
    const M = this.mesh, pos = M.geometry.attributes.position, col = M.geometry.attributes.color, sz = M.geometry.attributes.size;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      const c = p.col || DROP[p.ink] || DROP[0];
      col.setXYZ(i, c.r, c.g, c.b);
      sz.setX(i, p.r * (2 + Math.min(2.5, p.vel.length() * 0.12)));
    }
    if (n) { // only the live drops go to the GPU; nothing in the air: nothing to upload
      for (const [a, k] of [[pos, 3], [col, 3], [sz, 1]]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * k); a.needsUpdate = true; }
    }
    M.geometry.setDrawRange(0, n);
    M.visible = n > 0;
    this.floor.update(dt);
  }
}
