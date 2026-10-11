import * as THREE from 'three';

/*
  costume 'spider' (special.js): a black widow. Glossy black chitin all over, eight lit red eyes
  and a pair of fangs, a bulbous abdomen with the red hourglass hanging off the small of the back
  - and four long spider legs out of the shoulder blades, which walk on their own.

  The legs are a layer on top of the humanoid animation, not part of it: whatever the body does
  (walking, running, climbing, ragdolling, a puppet posed over the network, the FUN menu's doll),
  they read where it is and keep up with it by themselves:
    - standing / walking: each foot stays planted where it is on the ground until the body has
      moved or turned too far from it, then steps (an arcing lift ahead of where the body is going),
      in two diagonal pairs taking turns, like a real spider; quicker, longer, higher steps the
      faster it goes. Stood still, one leg now and then lifts and taps, or feels about in front.
    - in the air: they let go and reach down and out for the landing.
    - knocked down: they scramble, clawing at the ground round the body.
    - dead: a last few twitches, then they curl in underneath, the way a dead spider's do.
    - in a seat: folded tight against the back.
  Each leg is four segments (coxa, femur, tibia, tarsus) solved to its foot every frame: the coxa
  swings out towards it, the femur and tibia bend with the knee high above (two-bone IK), the
  tarsus comes down onto the point. All of it in the chest's frame, no allocations per frame.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const rnd = (a, b) => a + Math.random() * (b - a);

// segment lengths (chest frame)
const LEN = [0.3, 0.6, 1.65, 0.32];
// where each leg comes out of the back (chest frame: +x left, +z front) and where its foot rests
// on the ground (the body's frame: from under the hips, +x left, +z forward)
const LEGS = [
  { mount: V(0.07, 0.2, -0.1), rest: V(0.95, 0, 0.7), grp: 0 },   // front left
  { mount: V(-0.07, 0.2, -0.1), rest: V(-0.95, 0, 0.7), grp: 1 }, // front right
  { mount: V(0.075, 0.11, -0.1), rest: V(1.0, 0, -0.62), grp: 1 }, // back left
  { mount: V(-0.075, 0.11, -0.1), rest: V(-1.0, 0, -0.62), grp: 0 }, // back right
];

let MATS = null;
function mats() {
  return (MATS ||= {
    // oil-slick black chitin
    chitin: new THREE.MeshPhysicalMaterial({
      color: 0x0a090c, roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.18,
      iridescence: 0.55, iridescenceIOR: 1.4, iridescenceThicknessRange: [180, 520],
    }),
    joint: new THREE.MeshStandardMaterial({ color: 0x19141a, roughness: 0.55, metalness: 0.1 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc0101a, emissive: 0x6a0006, emissiveIntensity: 0.8, roughness: 0.35 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x3a0006, emissive: 0xff1a22, emissiveIntensity: 1.1, roughness: 0.08, metalness: 0.2 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x050405, roughness: 0.8 }),
    fang: new THREE.MeshStandardMaterial({ color: 0x1a0c0c, roughness: 0.25, metalness: 0.3 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffd0d0 }),
  });
}

/** A tapered, bulging segment along +Y from 0 to len (radius r0 at the root, r1 at the tip). */
function segGeo(len, r0, r1, bulge = 1.25, bow = 0) {
  const pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = (r0 + (r1 - r0) * t) * (1 + (bulge - 1) * Math.sin(Math.PI * Math.pow(t, 0.8)));
    pts.push(new THREE.Vector2(Math.max(0.0008, r), t * len));
  }
  pts.unshift(new THREE.Vector2(0.0005, 0));
  pts.push(new THREE.Vector2(0.0005, len));
  const g = new THREE.LatheGeometry(pts, 10);
  // (bowed out along +Z, its back: a leg arcs, it isn't a rod)
  if (bow) {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) P.setZ(i, P.getZ(i) + bow * Math.sin(Math.PI * clamp(P.getY(i) / len, 0, 1)));
    g.computeVertexNormals();
  }
  return g;
}
const SPH = new THREE.SphereGeometry(1, 12, 9);
const SPINE = new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0);
const mesh = (geo, mat, parent, pos, scale, rot) => {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.copy(pos);
  if (scale) typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.copy(scale);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
};

export function spider(ch) {
  const M = mats();
  // ---- the body: everything glossy black ----
  for (const k of ['skin', 'top', 'shorts', 'shoe', 'hair']) {
    const m = ch.mat[k];
    if (m) { m.roughness = 0.32; m.metalness = 0.18; }
  }
  head(ch, M);
  abdomen(ch, M);
  legs(ch, M);
}

// ---------- eight eyes and a pair of fangs ----------
function head(ch, M) {
  const F = ch.face;
  for (const e of ch.eyes) { e.eye.visible = false; e.iris.visible = false; e.brow.visible = false; }
  // (on the face's surface: roughly an ellipsoid, x ±0.08, y ±0.11, z 0.1 at the front)
  const on = (x, y, r) => V(x, y, 0.1 * Math.sqrt(Math.max(0.05, 1 - (x / 0.085) ** 2 - (y / 0.115) ** 2)) - r * 0.3);
  const eyes = [];
  for (const s of [1, -1]) {
    for (const [x, y, r] of [[0.022, 0.018, 0.015], [0.052, 0.03, 0.01], [0.012, 0.052, 0.0085], [0.066, 0.008, 0.009]]) {
      const e = mesh(SPH, M.eye, F, on(s * x, y, r), r);
      // (a glint in each)
      mesh(SPH, M.glint, e, V(-0.3, 0.35, 0.8), 0.18).castShadow = false;
      eyes.push(e);
    }
  }
  ch.tinyFace.push(...eyes);
  // chelicerae: two stout bases under the eyes, each with a curved fang hooking in
  const fangs = [];
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.02, -0.045, 0.092);
    F.add(piv);
    mesh(SPH, M.chitin, piv, V(0, -0.005, 0), V(0.017, 0.024, 0.016));
    const f = new THREE.Group();
    f.position.set(0, -0.025, 0.006);
    piv.add(f);
    for (let i = 0; i < 4; i++) {
      // (a fang: a few cones, each narrower and turned further in)
      const c = mesh(new THREE.ConeGeometry(0.006 - i * 0.0012, 0.013, 6).translate(0, -0.0065, 0), M.fang, f,
        V(-s * i * 0.0028, -i * 0.011, 0.002 * i), null, [0.2 * i, 0, -s * (0.25 + i * 0.28)]);
      c.castShadow = false;
    }
    fangs.push({ piv, s });
  }
  let t = Math.random() * 10, twitch = 0;
  const prev = ch.costumeTick;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    t += dt;
    // the fangs work now and then, the eyes smoulder
    twitch -= dt;
    const k = twitch > 0 ? Math.sin(twitch * 40) * 0.25 : 0;
    if (twitch < -rnd(1.5, 5)) twitch = rnd(0.25, 0.5);
    for (const { piv, s } of fangs) piv.rotation.z = s * (0.05 + k);
    M.eye.emissiveIntensity = 1 + 0.25 * Math.sin(t * 1.7);
  };
}

// ---------- the abdomen: off the small of the back, the red hourglass on top ----------
function abdomen(ch, M) {
  const piv = new THREE.Group();
  piv.position.set(0, 0.1, -0.1);
  piv.rotation.x = -0.55;
  ch.hips.add(piv);
  const body = mesh(SPH, M.chitin, piv, V(0, 0.02, -0.14), V(0.12, 0.13, 0.16));
  mesh(SPH, M.joint, piv, V(0, 0.0, -0.03), V(0.045, 0.045, 0.05)); // (the waist)
  // the hourglass: two red triangles tip to tip, just proud of the top of it
  const hg = new THREE.Group();
  hg.position.set(0, 0.148, -0.14);
  hg.rotation.x = -Math.PI / 2;
  piv.add(hg);
  for (const s of [1, -1]) {
    const c = mesh(new THREE.ConeGeometry(0.034, 0.05, 3), M.red, hg, V(0, s * 0.025, 0), V(1, 1, 0.12), [0, 0, s > 0 ? Math.PI : 0]);
    c.castShadow = false;
  }
  // spinnerets at the tip
  for (const s of [1, -1]) mesh(new THREE.ConeGeometry(0.012, 0.03, 6), M.joint, piv, V(s * 0.012, -0.02, -0.29), null, [-Math.PI / 2 - 0.3, 0, s * 0.3]);
  // it breathes, and sways a little behind the walk
  let t = Math.random() * 10;
  const prev = ch.costumeTick;
  ch.costumeTick = (dt) => {
    prev?.(dt);
    const sp = Math.min(1, ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) / 4 : 0);
    t += dt * (1 + sp * 4);
    const b = 1 + Math.sin(t * 1.3) * 0.025;
    body.scale.set(0.12 * b, 0.13 * b, 0.16);
    body.updateMatrix();
    piv.rotation.x = -0.55 + sp * 0.25 + Math.sin(t * 2) * 0.03 * (0.3 + sp);
    piv.rotation.z = Math.sin(t) * 0.04 * (0.3 + sp);
  };
}

// ---------- the legs ----------
function legs(ch, M) {
  const chest = ch.chest;
  const rig = new THREE.Group();
  chest.add(rig);
  const RAD = [[0.026, 0.022], [0.024, 0.017], [0.017, 0.009], [0.009, 0.0028]];
  const L = LEGS.map((d, li) => {
    const side = Math.sign(d.mount.x);
    const segs = LEN.map((len, i) => {
      const g = new THREE.Group();
      rig.add(g);
      mesh(segGeo(len, RAD[i][0], RAD[i][1], i === 1 ? 1.3 : i === 2 ? 1.15 : 1.05, i === 1 ? 0.03 : i === 2 ? 0.06 : 0), M.chitin, g);
      // a knuckle at each joint
      if (i > 0) mesh(SPH, M.joint, g, null, RAD[i][0] * 1.15);
      // bristles down the back of the long segments
      if (i === 1 || i === 2) {
        const n = i === 1 ? 7 : 8;
        for (let k = 0; k < n; k++) {
          const u = 0.12 + (k / n) * 0.8, r = RAD[i][0] + (RAD[i][1] - RAD[i][0]) * u;
          const bw = (i === 1 ? 0.03 : 0.06) * Math.sin(Math.PI * u);
          const sp = mesh(SPINE, M.hair, g, V((k % 2 ? 1 : -1) * r * 0.4, u * len, r * 0.85 + bw), V(0.0028, 0.03 + (k % 3) * 0.008, 0.0028), [0.9, 0, (k % 2 ? -1 : 1) * 0.3]);
          sp.castShadow = false;
        }
      }
      // the widow's red: a band round the end of the femur, and at the tibia's knee
      if (i === 1) mesh(new THREE.TorusGeometry(RAD[1][1] * 1.2, 0.004, 5, 14), M.red, g, V(0, len * 0.92, 0), null, [Math.PI / 2, 0, 0]).castShadow = false;
      // a hooked claw at the very end
      if (i === 3) mesh(new THREE.ConeGeometry(0.004, 0.035, 5).translate(0, 0.0175, 0), M.fang, g, V(0, len, 0), null, [0.35, 0, 0]);
      return g;
    });
    return {
      ...d, side, segs, li,
      foot: V(), from: V(), to: V(), stepT: -1, dur: 0.25, lift: 0.12,
      phase: li * 1.7 + Math.random(), seed: Math.random() * 100,
    };
  });
  // every mesh of the rig: the first of them drawn each frame moves the lot
  // (kept out of the stain volumes: they move about in the chest's frame, which the stains don't)
  const all = [];
  rig.traverse((o) => { if (o.isMesh) { all.push(o); o.userData.decal = true; } });

  // ---- scratch ----
  const hp = V(), lastHp = V(), vel = V(), fwd = V(), up = V(), q = new THREE.Quaternion(), qi = new THREE.Quaternion();
  const home = V(), tmp = V(), T = V(), C = V(), A = V(), K = V(), h = V(), pole = V(), d = V(), side = V();
  const X = V(), Y = V(), Z = V(), mat = new THREE.Matrix4(), base = V();
  let inited = false, lastT = 0, yaw = 0, speed = 0, idleT = rnd(2, 4), deadT = 0, mode = 'walk';

  const ground = (x, z, fromY) => {
    const c = ch.colliders;
    if (c) { const g = c.groundAt(x, z, fromY, 0.03); if (Number.isFinite(g)) return g; }
    return base.y;
  };
  // the body's frame on the ground: where a foot of leg l would rest, (world) into out
  const homeOf = (l, out, lead) => {
    const s = Math.sin(yaw), c = Math.cos(yaw), S = ch.S || 1;
    const x = l.rest.x * S, z = l.rest.z * S;
    out.set(base.x + x * c + z * s, base.y, base.z - x * s + z * c);
    return out.addScaledVector(vel, lead).setY(base.y);
  };
  const startStep = (l, to, dur, lift) => {
    l.from.copy(l.foot); l.to.copy(to);
    l.to.y = ground(to.x, to.z, base.y + 0.6);
    l.stepT = 0; l.dur = dur; l.lift = lift;
  };

  function tick(dt) {
    chest.updateWorldMatrix(true, false);
    ch.hips.getWorldPosition(hp);
    chest.getWorldQuaternion(q);
    qi.copy(q).invert();
    fwd.set(0, 0, 1).applyQuaternion(q);
    const upright = up.set(0, 1, 0).applyQuaternion(q).y;
    yaw = Math.atan2(fwd.x, fwd.z);
    // how it's moving (worked out from where it is: the same for a puppet or a doll)
    if (!inited) lastHp.copy(hp);
    tmp.subVectors(hp, lastHp).divideScalar(Math.max(dt, 1e-3)).setY(0);
    if (tmp.lengthSq() > 100) tmp.set(0, 0, 0); // (a teleport, a respawn)
    vel.lerp(tmp, 1 - Math.exp(-dt * 10));
    lastHp.copy(hp);
    speed = Math.hypot(vel.x, vel.z);
    // the ground under it
    const hipY = ch.hipY || 0.97;
    base.set(hp.x, hp.y - hipY, hp.z);
    if (ch.colliders) base.y = ch.colliders.groundAt(hp.x, hp.z, hp.y + 0.1, 0.1);
    const dead = !!ch.actor?.brain?.dead;
    const height = hp.y - base.y;
    const prevMode = mode;
    const out = !!ch.actor?.organs?.state?.out;
    mode = dead ? 'dead' : ch.actor?.seat ? 'fold' : upright < 0.55 ? (out ? 'limp' : 'scramble') : height > hipY + 0.3 ? 'air' : 'walk';
    if (!inited) {
      for (const l of L) homeOf(l, l.foot, 0);
      inited = true;
    }
    if (mode === 'dead') deadT += dt; else deadT = 0;

    if (mode === 'walk') {
      if (prevMode !== 'walk') for (const l of L) { l.stepT = -1; startStep(l, homeOf(l, home, 0.2), 0.22, 0.1); }
      // steps: a leg too far from home goes, if its diagonal partners aren't mid-stride
      const fast = clamp(speed / 5, 0, 1);
      const reach = (0.3 + 0.2 * fast) * (ch.S || 1);
      const busy = [false, false];
      for (const l of L) if (l.stepT >= 0) busy[l.grp] = true;
      let best = null, bestD = 0;
      for (const l of L) {
        if (l.stepT >= 0) continue;
        homeOf(l, home, 0.12);
        const dd = Math.hypot(home.x - l.foot.x, home.z - l.foot.z);
        const urgent = dd > reach * 2.2;
        if ((dd > reach && !busy[1 - l.grp]) || urgent) if (dd > bestD) { best = l; bestD = dd; }
      }
      if (best) {
        const dur = clamp(0.3 - speed * 0.035, 0.11, 0.3);
        // (to ahead of home: it'll still be moving on while the foot's down)
        homeOf(best, home, dur * 0.9 + 0.12);
        startStep(best, home, dur, (0.09 + 0.07 * fast) * (ch.S || 1));
        busy[best.grp] = true;
        idleT = rnd(2, 5);
      }
      // stood still: now and then a leg lifts and taps down again, or feels about in front
      if (speed < 0.15 && !busy[0] && !busy[1]) {
        idleT -= dt;
        if (idleT <= 0) {
          idleT = rnd(1.8, 5);
          const l = L[(Math.random() * (Math.random() < 0.6 ? 2 : 4)) | 0];
          homeOf(l, home, 0);
          home.x += rnd(-0.06, 0.06); home.z += rnd(-0.06, 0.06);
          startStep(l, home, rnd(0.35, 0.55), rnd(0.12, 0.25) * (ch.S || 1));
        }
      }
      for (const l of L) {
        if (l.stepT < 0) continue;
        l.stepT += dt / l.dur;
        const e = smooth(Math.min(1, l.stepT));
        l.foot.lerpVectors(l.from, l.to, e);
        l.foot.y += Math.sin(Math.PI * Math.min(1, l.stepT)) * l.lift;
        if (l.stepT >= 1) { l.foot.copy(l.to); l.stepT = -1; }
      }
    } else {
      // not walking: each foot goes where this state wants it, in the body's own frame
      const t = performance.now() / 1000;
      for (const l of L) {
        l.stepT = -1;
        let rate;
        if (mode === 'air') {
          // reaching down and out for the landing, paddling a little
          tmp.set(l.side * 0.95, -1.15 + Math.sin(t * 5 + l.phase) * 0.08, l.rest.z * 0.9 + Math.cos(t * 5 + l.phase) * 0.07);
          rate = 7;
        } else if (mode === 'scramble') {
          // clawing: each leg round a quick loop of its own, off beat with the others
          const a = t * 9 + l.phase;
          tmp.set(l.side * (0.8 + 0.2 * Math.cos(a)), -0.5 + 0.35 * Math.sin(a), l.rest.z * 0.8 + 0.2 * Math.cos(a * 0.5 + l.seed));
          rate = 14;
        } else if (mode === 'fold') {
          // in a seat: folded up tight against the back, out of the way
          tmp.set(l.side * 0.1, 0.05, -0.2 + (l.rest.z > 0 ? 0.03 : -0.03));
          rate = 8;
        } else if (mode === 'limp') {
          // out cold: sprawled loose round it, the odd faint stir
          tmp.set(l.side * 1.0, -0.6, l.rest.z * 0.8 + Math.sin(t * 0.7 + l.seed) * 0.02);
          rate = 3;
        } else {
          // dead: a few last spasms, then curled in tight underneath
          const tw = deadT < 1.6 ? Math.max(0, Math.sin(deadT * 22 + l.seed)) * (1 - deadT / 1.6) : 0;
          tmp.set(l.side * (0.12 + 0.45 * tw), -0.1 + 0.3 * tw, 0.12 + (l.rest.z > 0 ? 0.04 : -0.02));
          rate = deadT < 1.6 ? 10 : 2.2;
        }
        tmp.add(l.mount).applyMatrix4(chest.matrixWorld);
        // (not through the floor: pushing along it instead)
        if (mode !== 'fold') {
          const g = ground(tmp.x, tmp.z, tmp.y + 0.4);
          if (tmp.y < g + 0.01) tmp.y = g + 0.01;
        }
        l.foot.lerp(tmp, 1 - Math.exp(-dt * rate));
      }
    }
    solve();
  }

  /** Every leg onto its foot (chest frame). */
  function solve() {
    tmp.set(0, 1, 0).applyQuaternion(qi);
    const upL = tmp;
    const [L0, L1, L2, L3] = LEN;
    for (const l of L) {
      T.copy(l.foot);
      chest.worldToLocal(T);
      // outward along the ground, towards the foot
      h.subVectors(T, l.mount).addScaledVector(upL, -d.subVectors(T, l.mount).dot(upL));
      if (h.lengthSq() < 1e-6) h.set(l.side, 0, 0);
      h.normalize();
      // the coxa: up and out of the back, towards it
      C.copy(h).multiplyScalar(0.42).addScaledVector(upL, 0.9).add(side.set(0, 0, -0.22)).normalize();
      C.multiplyScalar(L0).add(l.mount);
      // the ankle: over the foot, a little in from it (the tarsus comes down and out)
      A.copy(T).addScaledVector(upL, L3 * 0.85).addScaledVector(h, -L3 * 0.35);
      // femur + tibia: knee up and a little out
      d.subVectors(A, C);
      let dist = d.length();
      const max = (L1 + L2) * 0.999, min = Math.abs(L1 - L2) + 0.01;
      if (dist > max) { A.copy(C).addScaledVector(d, max / dist); dist = max; }
      if (dist < min) { A.copy(C).addScaledVector(d, min / Math.max(dist, 1e-5)); dist = min; }
      d.subVectors(A, C).divideScalar(dist);
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const kh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      pole.copy(upL).addScaledVector(h, 0.35);
      pole.addScaledVector(d, -pole.dot(d)).normalize();
      K.copy(C).addScaledVector(d, a).addScaledVector(pole, kh);
      place(l.segs[0], l.mount, C, pole);
      place(l.segs[1], C, K, pole);
      place(l.segs[2], K, A, pole);
      // (the tarsus: from the ankle to the foot, or as far towards it as it reaches)
      place(l.segs[3], A, T, pole);
    }
    rig.updateMatrixWorld(true);
  }
  /** Segment g from a to b (chest frame), its back (+Z: the bristles) towards `back`. */
  function place(g, a, b, back) {
    Y.subVectors(b, a);
    const len = Y.length();
    if (len < 1e-6) return;
    Y.divideScalar(len);
    Z.copy(back).addScaledVector(Y, -back.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
    Z.normalize();
    X.crossVectors(Y, Z);
    mat.makeBasis(X, Y, Z);
    g.quaternion.setFromRotationMatrix(mat);
    g.position.copy(a);
  }

  // driven from the render: whichever of its meshes is drawn first each frame moves them all
  // (so it keeps up with anything that moves the body - the player, a puppet, a ragdoll, a doll)
  // (once a frame, however many passes draw it: a few ms since the last is the same frame)
  const drive = () => {
    const now = performance.now() / 1000;
    if (lastT && now - lastT < 0.004) return;
    const dt = lastT ? clamp(now - lastT, 1 / 240, 0.05) : 1 / 60;
    lastT = now;
    tick(dt);
  };
  for (const m of all) m.onBeforeRender = drive;
}
