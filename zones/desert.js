import * as THREE from 'three';
import { Frame } from '../cityprops.js';
import { BOX, PLANE } from '../cityparts.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
  The desert east of town: open sand crossed by the streets, with a gas station, a roadside
  motel, a cluster of adobe houses, windpumps, an old shack, saguaros and other cacti, rocks,
  dry scrub, wooden utility poles strung along the roads, and tumbleweeds rolling in the wind.
*/

let T = null;

/** Windpump moving parts, built once: the merged wheel, and tail + vane coloured per vertex. */
let PUMP = null;
function pumpParts() {
  if (PUMP) return PUMP;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
  const blades = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    _q.setFromEuler(_e.set(-a, 0.4, 0));
    blades.push(new THREE.BoxGeometry(0.02, 1.35, 0.32).applyMatrix4(_m.compose(new THREE.Vector3(0, Math.cos(a) * 1.05, Math.sin(a) * 1.05), _q, _s)));
  }
  const paint = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => c.toArray()[i % 3]), 3));
    return g;
  };
  const tail = paint(new THREE.BoxGeometry(2.2, 0.06, 0.05).translate(-0.8, 0, 0), 0xb8bcc0);
  const vane = paint(new THREE.BoxGeometry(1, 0.8, 0.03).translate(-1.9, 0, 0), 0xb01e1e);
  PUMP = {
    wheel: mergeGeometries(blades),
    blade: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
    tail: mergeGeometries([tail, vane]),
    tailM: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.55 }),
  };
  return PUMP;
}
function materials(ctx) {
  if (T) return T;
  const { batch, signTex } = ctx;
  const neon = (text, bg, fg, i = 1) => {
    const t = signTex(text, bg, fg);
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: i, roughness: 0.5 });
  };
  T = {
    gas: batch('dsGas', BOX, neon('GAS  3.49', '#b01e1e', '#ffffff', 0.7)),
    mart: batch('dsMart', BOX, neon('MART', '#f4f1ea', '#b01e1e', 0.5)),
    motel: batch('dsMotel', BOX, neon('MOTEL', '#1d6d6a', '#ffd76a', 1)),
    vacancy: batch('dsVacancy', BOX, neon('VACANCY', '#1b1b1b', '#ff5a3a', 1.3)),
    pave: batch('dsPave', PLANE, new THREE.MeshStandardMaterial({ roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { cast: false }),
    pool: batch('dsPool', PLANE, new THREE.MeshStandardMaterial({ color: 0x3fa8c8, roughness: 0.05, metalness: 0.2, envMap: ctx.env, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { cast: false }),
  };
  return T;
}

const solid = (F, u0, u1, v0, v1, top, cam = true) => { F.walk(u0, u1, v0, v1, top); F.phys(u0, u1, 0, top, v0, v1, { cam }); };
const pave = (F, T, u0, u1, v0, v1, c, y = 0.005) => {
  const [x0, x1, z0, z1] = F.rect(u0, u1, v0, v1);
  T.pave.add((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, c);
};

export function buildDesert(block, ctx) {
  const T = materials(ctx);
  const { R } = ctx;
  const I = block.inner;
  const cz = (I.z0 + I.z1) / 2;
  const front = (u) => new Frame(ctx.kit, I.x0 + u, cz, -Math.PI / 2, 0); // facing the road to the west
  if (block.j === 1) motel(front(26), I, ctx, T);
  if (block.j === 2) gasStation(front(20), I, ctx, T);
  if (block.j === 3) adobes(block, ctx);
  if (block.j === 0 || block.j === 4) {
    windpump(ctx, I.x0 + R.range(30, 60), cz + R.range(-20, 20));
    windpump(ctx, I.x0 + R.range(80, 110), cz + R.range(-30, 30));
    shack(ctx, I.x0 + R.range(50, 90), cz + (block.j === 0 ? 25 : -25));
    tumbleweeds(ctx, I);
  }
  utilityPoles(block, ctx);
  scrub(block, ctx);
}

// ---------------------------------------------------------------- gas station
function gasStation(F, I, ctx, T) {
  const { B, R } = ctx;
  // concrete apron from the road back to the store
  pave(F, T, -26, 19.5, -18, 18, 0xb9b3a8);
  for (let k = 0; k < 7; k++) {
    const [x, z] = F.p(R.range(-2, 12), R.range(-9, 9));
    T.pave.add(x, 0.007, z, R.range(0.6, 1.6), 1, R.range(0.5, 1.2), 0x6f6a62, R() * 3);
  }
  // canopy on four columns
  const cu = 6, cw = 16, cd = 10, ch = 5.2;
  F.put(B.plain, cu, ch + 0.45, 0, cd, 0.9, cw, 0xf4f4f2);
  F.put(B.paint, cu + cd / 2 + 0.01, ch + 0.45, 0, 0.04, 0.5, cw, 0xb01e1e);
  F.put(B.paint, cu - cd / 2 - 0.01, ch + 0.45, 0, 0.04, 0.5, cw, 0xb01e1e);
  for (const s of [-1, 1]) F.put(B.paint, cu, ch + 0.45, s * (cw / 2 + 0.01), cd, 0.5, 0.04, 0xb01e1e);
  F.put(B.lamp, cu, ch - 0.01, 0, cd - 1, 0.02, cw - 1);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const u = cu + su * (cd / 2 - 1.2), v = sv * 4.2;
    F.put(B.plain, u, ch / 2, v, 0.5, ch, 0.5, 0xd8d4c8);
    solid(F, u - 0.25, u + 0.25, v - 0.25, v + 0.25, ch, false);
  }
  // two pump islands
  for (const v of [-4.2, 4.2]) {
    F.put(B.conc, cu, 0.1, v, 6.4, 0.2, 1.3, 0xc9c5bc);
    F.walk(cu - 3.2, cu + 3.2, v - 0.65, v + 0.65, 0.2);
    F.phys(cu - 3.2, cu + 3.2, 0, 0.2, v - 0.65, v + 0.65);
    for (const du of [-1.6, 1.6]) {
      const u = cu + du;
      F.put(B.plain, u, 1.05, v, 0.8, 1.7, 0.55, 0xe8e6e0);
      F.put(B.paint, u, 1.75, v, 0.82, 0.3, 0.57, 0xb01e1e);
      F.put(B.glass, u, 1.3, v - 0.29, 0.4, 0.3, 0.02, 0x1d2a33);
      F.put(B.glass, u, 1.3, v + 0.29, 0.4, 0.3, 0.02, 0x1d2a33);
      for (const s of [-1, 1]) F.put(B.metal, u + s * 0.46, 1, v, 0.08, 0.6, 0.08, 0x1b1b1d);
      solid(F, u - 0.42, u + 0.42, v - 0.3, v + 0.3, 1.95, false);
    }
  }
  // the store: stucco box, a glass front, sign band
  const su1 = -8, sd = 12, sw = 18, sh = 4.2;
  F.put(B.stucco, su1 - sd / 2, sh / 2, 0, sd, sh, sw, 0xece4d4);
  F.put(B.paint, su1 + 0.03, sh - 0.2, 0, 0.06, 0.4, sw, 0xb01e1e);
  F.put(T.mart, su1 + 0.08, sh - 0.9, -3, 0.08, 0.9, 4.2, 0xffffff);
  F.put(B.glass, su1 + 0.03, 1.55, 2, 0.04, 2.6, 10, 0x9fb3c0);
  for (let k = 0; k <= 5; k++) F.put(B.frame, su1 + 0.06, 1.55, -3 + k * 2, 0.05, 2.6, 0.08, 0x25282c);
  F.put(B.plain, su1 + 1.2, sh - 0.1, 0, 2.4, 0.15, sw, 0xf4f4f2);
  // ice chest and air machine by the door
  F.put(B.plain, su1 + 0.6, 0.6, -6, 0.9, 1.2, 1.6, 0xeaf2f6);
  F.put(B.paint, su1 + 1.06, 0.8, -6, 0.02, 0.3, 1.4, 0x2e6fa8);
  solid(F, su1 + 0.1, su1 + 1.1, -6.8, -5.2, 1.2, false);
  F.put(B.paint, su1 + 0.5, 0.75, 7.5, 0.5, 1.5, 0.5, 0x2e6b4a);
  solid(F, su1 + 0.25, su1 + 0.75, 7.25, 7.75, 1.5, false);
  solid(F, su1 - sd, su1, -sw / 2, sw / 2, sh);
  // tall price sign by the road
  F.put(B.metal, 17, 4.5, -15, 0.3, 9, 0.3, 0x5a6068);
  F.put(T.gas, 17, 8.8, -15, 0.3, 1.5, 5.6, 0xffffff);
  ctx.solidCyl(...F.p(17, -15), 0.2, 9);
  claimRect(ctx, F, -26, 19.5, -18, 18);
}

// ---------------------------------------------------------------- motel
function motel(F, I, ctx, T) {
  const { B, R } = ctx;
  const units = 10, UW = 4, len = units * UW, dep = 8, h = 3.2;
  const u1 = -12, u0 = u1 - dep, v0 = -len / 2 + 4;
  const wall = 0xe9d9b8, doorCols = [0x1d6d6a, 0xb04a2a, 0xd8a23a, 0x2a4d8f];
  // car park and stalls
  pave(F, T, u1, 24, v0 - 10, v0 + len + 1, 0x4a4c50);
  for (let k = 0; k <= units; k++) pave(F, T, u1 + 1, u1 + 6, v0 + k * UW - 0.06, v0 + k * UW + 0.06, 0xe9e7e0, 0.008);
  // the row of rooms, a walkway roof on posts
  F.put(B.stucco, (u0 + u1) / 2, h / 2, v0 + len / 2, dep, h, len, wall);
  F.put(B.plain, (u0 + u1) / 2 + 1, h + 0.15, v0 + len / 2, dep + 2.4, 0.3, len + 0.6, 0x7a4a2a);
  F.put(B.conc, u1 + 1.1, 0.075, v0 + len / 2, 2.2, 0.15, len, 0xc9c5bc);
  F.walk(u1, u1 + 2.2, v0, v0 + len, 0.15);
  for (let k = 0; k <= units; k += 2) {
    const v = v0 + k * UW;
    F.put(B.wood, u1 + 2, h / 2, v, 0.18, h, 0.18, 0x6b4a2a);
    solid(F, u1 + 1.9, u1 + 2.1, v - 0.1, v + 0.1, h, false);
  }
  for (let k = 0; k < units; k++) {
    const v = v0 + k * UW + UW / 2;
    F.put(B.paint, u1 + 0.04, 1.2, v - 0.9, 0.06, 2.1, 0.95, doorCols[k % doorCols.length]);
    F.put(B.metal, u1 + 0.08, 2.45, v - 0.9, 0.04, 0.18, 0.3, 0xc9a13a);
    F.put(B.frame, u1 + 0.03, 1.6, v + 0.8, 0.05, 1.2, 1.6, 0xf4f1ea);
    F.put(B.glass, u1 + 0.06, 1.6, v + 0.8, 0.02, 1.05, 1.45, R() < 0.2 ? 0xe6d2a0 : 0x6e8294);
    F.put(B.plain, u1 + 0.5, 0.35, v + 0.8, 0.5, 0.7, 0.6, 0x9aa0a4); // air conditioner
  }
  // the office at the end, with its own sign
  const ou0 = u1 - 7, ov = v0 - 5;
  F.put(B.stucco, ou0 + 3.5, 2, ov, 7, 4, 8, 0xd9c7a3);
  F.put(B.glass, u1 + 0.03, 1.6, ov, 0.04, 2.4, 6, 0x9fb3c0);
  F.put(B.plain, ou0 + 3.5, 4.1, ov, 7.4, 0.3, 8.4, 0x7a4a2a);
  solid(F, u0, u1, v0, v0 + len, h + 0.3);
  solid(F, ou0, u1, ov - 4, ov + 4, 4.3);
  // pole sign by the road
  const pu = 21, pv = v0 - 8;
  for (const s of [-1, 1]) {
    F.put(B.metal, pu, 4, pv + s * 1.6, 0.25, 8, 0.25, 0x3a3f45);
    ctx.solidCyl(...F.p(pu, pv + s * 1.6), 0.15, 8);
  }
  F.put(T.motel, pu, 7.6, pv, 0.4, 1.8, 6, 0xffffff);
  F.put(T.vacancy, pu, 6.2, pv, 0.2, 0.7, 3.6, 0xffffff);
  // a small pool with a fence
  const qu = 4, qv = v0 + len - 6;
  pave(F, T, qu - 5, qu + 5, qv - 4, qv + 4, 0xd8d2c4, 0.008);
  const [px0, px1, pz0, pz1] = F.rect(qu - 3.5, qu + 3.5, qv - 2.2, qv + 2.2);
  T.pool.add((px0 + px1) / 2, 0.012, (pz0 + pz1) / 2, px1 - px0, 1, pz1 - pz0);
  for (const [a, b, c, d] of [[qu - 5, qu + 5, qv - 4, qv - 3.95], [qu - 5, qu + 5, qv + 3.95, qv + 4], [qu - 5, qu - 4.95, qv - 4, qv + 4], [qu + 4.95, qu + 5, qv - 4, qv + 1]]) {
    F.put(B.metal, (a + b) / 2, 1.05, (c + d) / 2, b - a + 0.04, 0.05, d - c + 0.04, 0xe8e8e8);
    F.put(B.metal, (a + b) / 2, 0.55, (c + d) / 2, b - a + 0.04, 0.05, d - c + 0.04, 0xe8e8e8);
    F.walk(a, b, c, d, 1.1, { noSeat: true });
  }
  claimRect(ctx, F, u0 - 2, 24, v0 - 12, v0 + len + 2);
}

// ---------------------------------------------------------------- adobe houses
function adobes(block, ctx) {
  const { R, B } = ctx;
  const I = block.inner;
  const spots = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
    spots.push([I.x0 + 18 + a * 36 + R.range(-4, 4), I.z0 + 16 + b * 32 + R.range(-3, 3), R.pick([-Math.PI / 2, 0, Math.PI])]);
  }
  const cols = [0xc8a27a, 0xd4ae84, 0xbf9670, 0xcfa98a, 0xd9b890];
  for (const [x, z, yaw] of spots) {
    const F = new Frame(ctx.kit, x, z, yaw, 0);
    const d = R.range(8, 10), w = R.range(10, 13), h = R.range(3.4, 4), col = R.pick(cols);
    F.put(B.stucco, 0, h / 2, 0, d, h, w, col);
    // soft, uneven parapet
    for (let k = 0; k < 4; k++) F.put(B.stucco, R.range(-d / 3, d / 3), h + 0.15, R.range(-w / 3, w / 3), R.range(d * 0.4, d), 0.5, R.range(w * 0.4, w), col);
    F.put(B.stucco, 0, h + 0.2, 0, d + 0.1, 0.4, w + 0.1, col);
    // a second, lower room off one side
    const sw = R.range(4, 6), sd = d * 0.7;
    F.put(B.stucco, -d / 2 + sd / 2, (h - 0.8) / 2, w / 2 + sw / 2, sd, h - 0.8, sw, col);
    // vigas: roof beam ends poking out of the front
    for (let k = 0; k < 6; k++) F.put(B.bark, d / 2 + 0.3, h - 0.45, -w / 2 + 1 + k * (w - 2) / 5, 0.2, 0.7, 0.2, 0xffffff, Math.PI / 2);
    // deep-set blue window frames, a turquoise door, a portal on posts
    const blue = R.pick([0x2a6a8a, 0x2f8a8a, 0x3a5a9a]);
    for (const v of [-w / 2 + 2, w / 2 - 2]) {
      F.put(B.paint, d / 2 + 0.02, 1.7, v, 0.06, 1.2, 1, blue);
      F.put(B.glass, d / 2 + 0.03, 1.7, v, 0.02, 1, 0.8, 0x4a5a66);
    }
    F.put(B.paint, d / 2 + 0.03, 1.1, 0, 0.06, 2.2, 1.1, 0x2fa89a);
    F.put(B.wood, d / 2 + 1.6, 2.8, 0, 0.3, 0.25, w * 0.6, 0x6b4a2a);
    F.put(B.wood, d / 2 + 0.9, 3, 0, 1.7, 0.1, w * 0.6, 0x7a5a3a);
    for (const s of [-1, 1]) {
      F.put(B.wood, d / 2 + 1.6, 1.35, s * w * 0.28, 0.22, 2.7, 0.22, 0x6b4a2a);
      solid(F, d / 2 + 1.49, d / 2 + 1.71, s * w * 0.28 - 0.11, s * w * 0.28 + 0.11, 2.7, false);
    }
    // a string of chiles by the door
    for (let k = 0; k < 6; k++) F.put(B.paint, d / 2 + 0.12, 2.3 - k * 0.14, 0.9, 0.08, 0.13, 0.1, 0xa01818);
    // courtyard wall to one side
    F.put(B.stucco, 0, 0.6, -w / 2 - 4, d, 1.2, 0.35, col);
    solid(F, -d / 2, d / 2, -w / 2 - 4.2, -w / 2 - 3.8, 1.2, false);
    solid(F, -d / 2, d / 2, -w / 2, w / 2, h + 0.4);
    solid(F, -d / 2, -d / 2 + sd, w / 2, w / 2 + sw, h - 0.8);
    ctx.claim(x, z, Math.max(d, w) * 0.85);
  }
}

// ---------------------------------------------------------------- windpump, shack
function windpump(ctx, x, z) {
  const { B, X, R } = ctx;
  if (!ctx.free(x, z, 6)) return;
  const H = 9, base = 1.4, top = 0.35, col = 0x8a8e92;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const dx = (base - top) * sx, dz = (base - top) * sz, L = Math.hypot(H, dx, dz);
    const lx = x + sx * (base + top) / 2, lz = z + sz * (base + top) / 2;
    B.metal.add(lx, H / 2, lz, 0.09, L, 0.09, col, 0, -Math.atan2(dz, H), Math.atan2(dx, H));
    ctx.solidCyl(x + sx * base, z + sz * base, 0.08, 1.2);
  }
  for (let y = 2; y < H; y += 2.4) {
    const s = base - (base - top) * (y / H);
    for (const [a, b] of [[[-s, -s], [s, -s]], [[s, -s], [s, s]], [[s, s], [-s, s]], [[-s, s], [-s, -s]]]) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      B.metal.add(x + (a[0] + b[0]) / 2, y, z + (a[1] + b[1]) / 2, 0.05, 0.05, L, col, Math.atan2(b[0] - a[0], b[1] - a[1]));
    }
  }
  // the fan wheel and tail, turning
  const yaw = R() * Math.PI * 2;
  // one mesh for the 16-blade wheel (it turns), one for tail + vane; shared by every windpump
  const P = pumpParts();
  const wheel = new THREE.Mesh(P.wheel, P.blade);
  const hub = new THREE.Group();
  hub.position.set(x, H + 0.3, z); hub.rotation.y = yaw;
  wheel.position.x = 0.7;
  const tail = new THREE.Mesh(P.tail, P.tailM);
  wheel.castShadow = tail.castShadow = true;
  hub.add(wheel, tail);
  ctx.scene.add(hub);
  const sp = R.range(1.2, 2.2);
  ctx.onUpdate((dt) => { wheel.rotation.x += dt * sp; });
  // stock tank beside it
  X.discMetal.add(x + 3, 0.5, z + 1, 3.2, 1, 3.2, 0x9aa0a4);
  X.disc.add(x + 3, 0.97, z + 1, 2.9, 0.02, 2.9, 0x4a7a8a);
  ctx.solidCyl(x + 3, z + 1, 1.6, 1);
  ctx.claim(x, z, 6);
}

function shack(ctx, x, z) {
  const { B, R } = ctx;
  if (!ctx.free(x, z, 6)) return;
  const F = new Frame(ctx.kit, x, z, R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), 0);
  const d = 5, w = 6, h = 2.6;
  for (let v = -w / 2 + 0.15; v < w / 2; v += 0.3) F.put(B.wood, 0, h / 2, v, d, h + R.range(-0.1, 0.1), 0.28, R.pick([0x7a6450, 0x6b5846, 0x857060, 0x5e4e40]));
  F.put(B.metal, 0.2, h + 0.15, 0, d + 0.8, 0.05, w + 0.6, 0x8a7a6a, -0.08);
  F.put(B.plain, d / 2 + 0.02, 1.05, -1, 0.04, 2.1, 0.9, 0x2a2420);
  F.put(B.glass, d / 2 + 0.02, 1.6, 1.4, 0.03, 0.7, 0.8, 0x3a3f42);
  solid(F, -d / 2, d / 2, -w / 2, w / 2, h + 0.3);
  ctx.claim(x, z, 5);
}

// ---------------------------------------------------------------- along the roads
function utilityPoles(block, ctx) {
  const { B, R } = ctx;
  // one line of poles along the road on the block's north side, strung with wires
  if (!block.st.zm) return;
  const z = block.z0 + 1.6, pts = [];
  for (let x = block.x0 + 6; x < block.x1 - 4; x += 32) pts.push(x);
  for (const x of pts) {
    B.wood.add(x, 4.5, z, 0.26, 9, 0.26, 0x5e4a36);
    B.wood.add(x, 8.4, z, 0.12, 0.14, 2.4, 0x5e4a36);
    for (const dz of [-1, 0, 1]) B.plain.add(x, 8.55, z + dz * 1.05, 0.08, 0.14, 0.08, 0x9ab0a0);
    ctx.solidCyl(x, z, 0.15, 9);
    ctx.claim(x, z, 1);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = b - a;
    for (const dz of [-1, 0, 1]) {
      // a little sag: two segments
      const mid = (a + b) / 2, sag = 0.6;
      for (const [p, q] of [[a, mid], [mid, b]]) {
        const y0 = p === a ? 8.6 : 8.6 - sag, y1 = q === b ? 8.6 : 8.6 - sag;
        B.metal.add((p + q) / 2, (y0 + y1) / 2, z + dz * 1.05, Math.hypot(q - p, y1 - y0), 0.025, 0.025, 0x1b1b1d, 0, 0, Math.atan2(y1 - y0, q - p));
      }
    }
    void L;
  }
  void R;
}

/** Cacti, rocks and dry scrub over whatever sand is left. */
function scrub(block, ctx) {
  const { R, B, X } = ctx;
  const I = block.inner;
  const area = (I.x1 - I.x0) * (I.z1 - I.z0);
  const cactus = 0x4f6b3a;
  for (let k = 0; k < area / 170; k++) {
    const x = R.range(I.x0 + 3, I.x1 - 3), z = R.range(I.z0 + 3, I.z1 - 3);
    const t = R();
    if (t < 0.22) {
      if (!ctx.free(x, z, 2.2)) continue;
      // saguaro: a trunk and one to three arms
      const h = R.range(3, 6), r = R.range(0.38, 0.5);
      B.plainC.add(x, h / 2, z, r * 2, h, r * 2, cactus);
      B.plainS.add(x, h, z, r * 2, r * 1.4, r * 2, cactus);
      for (let a = R.int(1, 3); a > 0; a--) {
        const ang = R() * Math.PI * 2, ay = R.range(1.4, h * 0.65), out = R.range(0.8, 1.2), up = R.range(0.9, 1.8);
        const dx = Math.cos(ang), dz = Math.sin(ang), ar = r * 0.7;
        B.plainC.add(x + dx * out / 2, ay, z + dz * out / 2, ar * 2, out, ar * 2, cactus, Math.atan2(dx, dz), Math.PI / 2);
        B.plainC.add(x + dx * out, ay + up / 2, z + dz * out, ar * 2, up, ar * 2, cactus);
        B.plainS.add(x + dx * out, ay + up, z + dz * out, ar * 2, ar * 1.4, ar * 2, cactus);
      }
      ctx.solidCyl(x, z, r, h);
      ctx.claim(x, z, 1.5);
    } else if (t < 0.4) {
      if (!ctx.free(x, z, 1)) continue;
      // barrel cactus or a clump of prickly pear pads
      if (R() < 0.5) B.plainS.add(x, 0.3, z, 0.7, 0.7, 0.7, 0x5a7a3a);
      else for (let p = 0; p < 5; p++) X.disc.add(x + R.range(-0.4, 0.4), 0.3 + p * 0.18, z + R.range(-0.4, 0.4), 0.5, 0.06, 0.6, 0x6a8a4a, R() * 3, Math.PI / 2 + R.range(-0.4, 0.4));
      ctx.claim(x, z, 0.6);
    } else if (t < 0.65) {
      // rocks, big ones solid
      const s = R.range(0.4, 2.6);
      if (!ctx.free(x, z, s)) continue;
      X.rock.add(x, s * 0.3, z, s * R.range(1, 1.6), s, s * R.range(1, 1.4), 0xffffff, R() * 6, R() * 0.3);
      if (s > 1.1) { ctx.kit.walkCyl(x, z, s * 0.55, s * 0.72); ctx.kit.physCyl(x, z, s * 0.5, 0, s * 0.72); }
      ctx.claim(x, z, s);
    } else {
      if (!ctx.free(x, z, 0.8)) continue;
      const s = R.range(0.5, 1.1);
      ctx.canopy([[x, s * 0.35, z, s * 1.3, s * 0.8, s * 1.3, R.pick([0x7a7a4a, 0x8a8456, 0x6b6e44, 0x9a8a5a]), R() * 6]], true);
    }
  }
}

function tumbleweeds(ctx, I) {
  const { R, scene } = ctx;
  const geo = new THREE.IcosahedronGeometry(0.5, 1), mat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, wireframe: true });
  const list = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(geo, mat);
    const s = R.range(0.7, 1.1);
    m.scale.setScalar(s);
    m.castShadow = true;
    scene.add(m);
    list.push({ m, s, x: R.range(I.x0, I.x1), z: R.range(I.z0 + 5, I.z1 - 5), v: R.range(1.5, 3), ph: R() * 6 });
  }
  let t = 0;
  ctx.onUpdate((dt) => {
    t += dt;
    for (const w of list) {
      w.x += w.v * dt;
      if (w.x > I.x1) w.x = I.x0;
      w.z += Math.sin(t * 0.5 + w.ph) * dt * 0.6;
      const hop = Math.abs(Math.sin(t * 2.2 + w.ph)) * 0.35;
      w.m.position.set(w.x, w.s * 0.5 + hop, w.z);
      w.m.rotation.z -= (w.v * dt) / (w.s * 0.5);
    }
  });
}

function claimRect(ctx, F, u0, u1, v0, v1) {
  const [x0, x1, z0, z1] = F.rect(u0, u1, v0, v1);
  for (let x = x0; x <= x1; x += 4) for (let z = z0; z <= z1; z += 4) ctx.claim(x, z, 3);
}
