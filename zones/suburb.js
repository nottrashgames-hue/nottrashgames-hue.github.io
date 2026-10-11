import { Frame } from '../cityprops.js';
import { gable } from './kit.js';
import { anchorAt, anchorOff } from '../cityparts.js';

/*
  Suburbs: lots along every street side of the block, each with a detached house set back
  behind a lawn - ranch with an attached garage, two-storey colonial, porch bungalow, or a
  flat-roofed modern - plus driveway, front path, mailbox, shrubs, trees and side fences.
  Lot frames: u = toward the street (the lot runs u -D..0), v = along the street.
*/

const SIDING = [0xe8e2d0, 0xc9d6df, 0xd7c9a8, 0xa9bfa6, 0xe9d3c9, 0xf2efe6, 0xb7c3cc, 0xd9c28f, 0x9fb1bf, 0xc4a79a];
const ROOFS = [0x4a4a4c, 0x5b4636, 0x6d3a2e, 0x3d4a52, 0x3e4a3a, 0x77685a, 0x2f3134];
const DOORS = [0x7a1f1f, 0x1f3a5a, 0x2e5a3a, 0x222222, 0xc9a13a, 0x6a3a1f, 0xf2efe6];
const TRIM = 0xf4f1ea;
const GLASS = [0x7f92a2, 0x8a9cab, 0x6e8294];
const LOT_D = 22;

/** A lot frame mirrored across v (so every house can be designed with its driveway on +v). */
class Mirror {
  constructor(F, s) { this.F = F; this.s = s; this.yaw = F.yaw; }
  p(u, v) { return this.F.p(u, v * this.s); }
  put(b, u, y, v, su, sy, sv, c, pitch = 0, roll = 0) { this.F.put(b, u, y, v * this.s, su, sy, sv, c, pitch, roll * this.s); }
  slope(b, u1, y1, u2, y2, v, sv, thick, c) { this.F.slope(b, u1, y1, u2, y2, v * this.s, sv, thick, c); }
  rect(u0, u1, v0, v1) { return this.F.rect(u0, u1, v0 * this.s, v1 * this.s); }
  walk(u0, u1, v0, v1, top, extra) { this.F.walk(u0, u1, v0 * this.s, v1 * this.s, top, extra); }
  phys(u0, u1, y0, y1, v0, v1, extra) { this.F.phys(u0, u1, y0, y1, v0 * this.s, v1 * this.s, extra); }
}

export function buildSuburb(block, ctx) {
  const { R } = ctx;
  const I = block.inner, st = block.st;
  const lots = [];
  const row = (a0, a1, side) => {
    const L = a1 - a0;
    let a = 0;
    while (L - a > 12) {
      let w = R.range(17, 22);
      if (L - a - w < 14) w = L - a;
      lots.push({ side, a0: a0 + a, a1: a0 + a + w });
      a += w;
    }
  };
  if (st.zm) row(I.x0, I.x1, 'zm');
  if (st.zp) row(I.x0, I.x1, 'zp');
  const za = st.zm ? I.z0 + LOT_D : I.z0, zb = st.zp ? I.z1 - LOT_D : I.z1;
  if (st.xm) row(za, zb, 'xm');
  if (st.xp) row(za, zb, 'xp');
  const rects = [];
  for (const L of lots) {
    const W = L.a1 - L.a0, m = (L.a0 + L.a1) / 2;
    // frame origin: the middle of the lot's street line; forward = toward the street
    const [ox, oz, yaw] =
      L.side === 'zm' ? [m, I.z0, Math.PI] : L.side === 'zp' ? [m, I.z1, 0] :
      L.side === 'xm' ? [I.x0, m, -Math.PI / 2] : [I.x1, m, Math.PI / 2];
    const F = new Frame(ctx.kit, ox, oz, yaw, 0);
    rects.push(F.rect(-LOT_D, 0, -W / 2, W / 2));
    anchorAt(...F.p(-LOT_D / 2, 0)); // the whole lot swaps detail LOD as one
    lot(new Mirror(F, R() < 0.5 ? 1 : -1), W, ctx);
    anchorOff();
  }
  // the land behind the lots: a scatter of big old trees
  const inLot = (x, z) => rects.some(([x0, x1, z0, z1]) => x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2);
  const area = (I.x1 - I.x0) * (I.z1 - I.z0);
  for (let k = 0; k < area / 260; k++) {
    const x = R.range(I.x0 + 3, I.x1 - 3), z = R.range(I.z0 + 3, I.z1 - 3);
    if (!inLot(x, z) && ctx.free(x, z, 3)) ctx.tree(x, z, 0, R.range(1.1, 1.6));
  }
}

// ---------------------------------------------------------------- one lot
function lot(F, W, ctx) {
  const { R, B, X } = ctx;
  const type = W < 18.5 ? R.pick(['bungalow', 'colonial', 'modern']) : R.pick(['ranch', 'ranch', 'colonial', 'bungalow', 'modern']);
  const wall = R.pick(SIDING), roof = R.pick(ROOFS), door = R.pick(DOORS);
  const m = 1.2, set = R.range(6.5, 8.5); // side margin, front setback
  const H = { F, ctx, wall, roof, door };
  let drive; // { v, w, u0 } driveway: centre, width, where it starts (garage door / parking pad)
  if (type === 'ranch') drive = ranch(H, W, m, set);
  else if (type === 'colonial') drive = colonial(H, W, m, set);
  else if (type === 'bungalow') drive = bungalow(H, W, m, set);
  else drive = modern(H, W, m, set);

  // driveway and front path (flat concrete over the lawn; the sidewalk slab runs over their ends)
  plane(F, ctx, drive.u0, 0.3, drive.v - drive.w / 2, drive.v + drive.w / 2, 0xb3aea5);
  const pv = drive.door;
  plane(F, ctx, -set + 0.05, 0.3, pv - 0.6, pv + 0.6, 0xbdb6aa);
  // a car on some of the driveways, nose to the house
  if (drive.car && R() < 0.5) {
    const [x, z] = F.p(-set + 2.9, drive.v);
    const kind = R() < 0.6 ? 'sedan' : 'hatch';
    ctx.drivewayCars.push({ x, z, yaw: F.yaw + Math.PI, kind, color: R.pick([0xb0302a, 0x2a4d8f, 0xdedede, 0x1d1d1f, 0x6d7278, 0x9aa3a8, 0x2e6b4a, 0x7a2f55, 0xe5e1d6]), interior: Math.floor(R() * 3) });
  }
  // mailbox on a post by the driveway
  {
    const mv = drive.v - drive.w / 2 - 0.6;
    F.put(B.wood, -0.6, 0.55, mv, 0.09, 1.1, 0.09, 0x6b5238);
    F.put(B.metal, -0.6, 1.2, mv, 0.5, 0.22, 0.2, R.pick([0x2b2f33, 0x5a6068, 0xe8e4da, 0x7a1f1f]));
    F.put(B.paint, -0.72, 1.33, mv + 0.11, 0.1, 0.12, 0.015, 0xc0392b);
    F.walk(-0.66, -0.54, mv - 0.06, mv + 0.06, 1.3, { noSeat: true });
    F.phys(-0.65, -0.55, 0, 1.1, mv - 0.05, mv + 0.05);
  }
  // shrubs under the front windows, a tree or two
  const greens = [0x3f6630, 0x4f7a3a, 0x5d8a41, 0x466d33];
  for (let v = drive.hv0 + 0.8; v < drive.hv1 - 0.6; v += R.range(1.1, 1.7)) {
    if (Math.abs(v - pv) < 1.1) continue;
    const s = R.range(0.8, 1.2);
    const [x, z] = F.p(-set + 0.7, v);
    ctx.canopy([[x, 0.4 * s, z, 1.1 * s, 0.9 * s, 1.1 * s, R.pick(greens), R() * 6]], true);
  }
  if (R() < 0.7) {
    const [x, z] = F.p(-set * R.range(0.35, 0.55), -W / 2 + R.range(2.2, 4));
    if (ctx.free(x, z, 1.5)) ctx.tree(x, z, 0, R.range(0.9, 1.3));
  }
  if (R() < 0.6) {
    const [x, z] = F.p(-LOT_D + R.range(2, 4), R.range(-W / 2 + 3, W / 2 - 3));
    if (ctx.free(x, z, 1.5)) ctx.tree(x, z, 0, R.range(1, 1.4));
  }
  // side fence (each lot does its +v side) from the back line to the house's back corner
  const fv = W / 2, fu1 = -set - drive.depth + 0.6;
  if (fu1 > -LOT_D + 2) fence(F, ctx, -LOT_D, fu1, fv, R() < 0.5 ? 0x8a6a4a : 0xece9e0);
}

function plane(F, ctx, u0, u1, v0, v1, c) {
  const [x0, x1, z0, z1] = F.rect(u0, u1, v0, v1);
  ctx.markB.add((x0 + x1) / 2, 0.004, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, c);
}

/** A board fence along the lot line v = fv, from u0 to u1. */
function fence(F, ctx, u0, u1, v, c) {
  const { B } = ctx, h = 1.7;
  const n = Math.max(1, Math.round((u1 - u0) / 2.4));
  // the board panel alone casts the fence's shadow; posts and cap rail sit inside its silhouette
  for (let i = 0; i <= n; i++) F.put(B.woodD, u0 + (u1 - u0) * i / n, h / 2 + 0.05, v, 0.1, h + 0.1, 0.1, c);
  F.put(B.wood, (u0 + u1) / 2, h / 2, v, u1 - u0, h - 0.1, 0.03, c);
  F.put(B.woodD, (u0 + u1) / 2, h - 0.12, v, u1 - u0, 0.08, 0.07, c);
  F.walk(u0, u1, v - 0.06, v + 0.06, h, { noSeat: true });
  F.phys(u0, u1, 0, h, v - 0.04, v + 0.04);
}

// ---------------------------------------------------------------- house parts
/** A wall box with windows and a door; body = { u0, u1 (front), v0, v1, h } */
function body(H, b, col, batch) {
  const { F, ctx } = H;
  const d = b.u1 - b.u0, w = b.v1 - b.v0;
  F.put(batch || ctx.X.siding, (b.u0 + b.u1) / 2, b.h / 2, (b.v0 + b.v1) / 2, d, b.h, w, col);
  // foundation
  F.put(ctx.B.conc, (b.u0 + b.u1) / 2, 0.15, (b.v0 + b.v1) / 2, d + 0.08, 0.3, w + 0.08, 0x9d9990);
}
/** Put something flat on a wall of body b: side f(ront) / b(ack) / l / r, t = position along it. */
function on(H, b, side, t, y, out, along, h, thick, batch, col) {
  const F = H.F;
  if (side === 'f') F.put(batch, b.u1 + out + thick / 2, y, t, thick, h, along, col);
  else if (side === 'b') F.put(batch, b.u0 - out - thick / 2, y, t, thick, h, along, col);
  else if (side === 'l') F.put(batch, t, y, b.v0 - out - thick / 2, along, h, thick, col);
  else F.put(batch, t, y, b.v1 + out + thick / 2, along, h, thick, col);
}
function win(H, b, side, t, y, w = 1.1, h = 1.3, shutters = false) {
  const { ctx } = H, B = ctx.B, R = ctx.R;
  // all flush on the wall: none of it casts into the shadow map (the *D batches)
  on(H, b, side, t, y, 0, w + 0.18, h + 0.18, 0.06, B.trimD, TRIM);
  on(H, b, side, t, y, 0.06, w, h, 0.02, B.glass, R() < 0.12 ? 0xe6d2a0 : R.pick(GLASS));
  on(H, b, side, t, y, 0.08, w, 0.05, 0.02, B.trimD, TRIM);
  on(H, b, side, t, y - h / 2 - 0.1, 0, w + 0.3, 0.07, 0.12, B.trimD, TRIM);
  if (shutters) for (const s of [-1, 1]) on(H, b, side, t + s * (w / 2 + 0.3), y, 0, 0.4, h + 0.1, 0.05, B.paintD, H.shutter);
}
/** Windows along a whole wall, skipping spans in `skip` ([from, to] along it). */
function windows(H, b, side, y, { gap = 3, w = 1.1, h = 1.3, skip = [], shutters = false } = {}) {
  const [a0, a1] = side === 'f' || side === 'b' ? [b.v0, b.v1] : [b.u0, b.u1];
  const L = a1 - a0, n = Math.max(1, Math.floor((L - 0.6) / gap));
  for (let i = 0; i < n; i++) {
    const t = a0 + L * (i + 0.5) / n;
    if (skip.some(([p, q]) => t > p - w / 2 - 0.2 && t < q + w / 2 + 0.2)) continue;
    win(H, b, side, t, y, w, h, shutters);
  }
}
function frontDoor(H, b, v, h = 2.1, step = true) {
  const { ctx } = H, B = ctx.B;
  on(H, b, 'f', v, 0.3 + h / 2 + 0.05, 0, 1.25, h + 0.2, 0.07, B.trimD, TRIM);
  on(H, b, 'f', v, 0.3 + h / 2, 0.07, 0.95, h, 0.04, B.paintD, H.door);
  on(H, b, 'f', v + 0.33, 0.3 + h * 0.48, 0.1, 0.06, 0.06, 0.04, B.metalD, 0xc9a13a);
  if (step) {
    H.F.put(B.conc, b.u1 + 0.45, 0.15, v, 0.9, 0.3, 1.6, 0xa8a49b);
  }
}
function solid(H, u0, u1, v0, v1, top) {
  H.F.walk(u0, u1, v0, v1, top);
  H.F.phys(u0, u1, 0, top, v0, v1, { cam: true });
}

// ---------------------------------------------------------------- house types
/** Long and low: gable ridge along the street, attached two-car garage on the driveway side. */
function ranch(H, W, m, set) {
  const { F, ctx } = H, { X, B, R } = ctx;
  const gw = 6.4, gd = 7.2, d = 9.5;
  const gv1 = W / 2 - m, gv0 = gv1 - gw;
  const w = Math.min(14, gv0 - (-W / 2 + m));
  const b = { u0: -set - d, u1: -set, v0: gv0 - w, v1: gv0, h: 2.9 };
  body(H, b, H.wall);
  gable(F, X, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, d, w, b.h, 1.7, H.wall, H.roof);
  // garage, set back a little, with a lower roof
  const g = { u0: -set - gd - 0.6, u1: -set - 0.6, v0: gv0, v1: gv1, h: 2.7 };
  body(H, g, H.wall);
  gable(F, X, (g.u0 + g.u1) / 2, (g.v0 + g.v1) / 2, gd, gw, g.h, 1.3, H.wall, H.roof, 0.35);
  on(H, g, 'f', (gv0 + gv1) / 2, 1.15, 0, 5.2, 2.2, 0.06, B.trimD, TRIM);
  on(H, g, 'f', (gv0 + gv1) / 2, 1.1, 0.06, 5, 2.1, 0.03, B.plainD, 0xeeebe4);
  for (let k = 1; k < 4; k++) on(H, g, 'f', (gv0 + gv1) / 2, 0.05 + k * 0.52, 0.09, 5, 0.03, 0.01, B.plainD, 0xb8b4ac);
  const dv = b.v0 + w * 0.3;
  frontDoor(H, b, dv);
  // a picture window beside the door, then regular ones
  win(H, b, 'f', dv + 2.4, 1.6, 2.6, 1.4);
  windows(H, b, 'f', 1.6, { skip: [[dv - 0.6, dv + 3.8]], gap: 2.8 });
  windows(H, b, 'b', 1.6, { gap: 3.2 });
  windows(H, b, 'l', 1.6, { gap: 3.4 });
  solid(H, b.u0, b.u1, b.v0, b.v1, b.h + 1.7);
  solid(H, g.u0, g.u1, g.v0, g.v1, g.h + 1.3);
  return { v: (gv0 + gv1) / 2, w: 5.4, u0: g.u1, door: dv, hv0: b.v0, hv1: b.v1, depth: d, car: true };
}

/** Two storeys, steep gable, a pedimented portico over a centred door, shutters and a chimney. */
function colonial(H, W, m, set) {
  const { F, ctx } = H, { X, B, R } = ctx;
  H.shutter = R.pick([0x1f2a36, 0x2e3a2a, 0x3a1f1f, 0x222222]);
  const dw = 3.2, d = 8.5;
  const vmax = W / 2 - m - dw - 0.8, vmin = -W / 2 + m;
  const w = Math.min(11.5, vmax - vmin), vc = (vmin + vmax) / 2;
  const b = { u0: -set - d, u1: -set, v0: vc - w / 2, v1: vc + w / 2, h: 5.8 };
  body(H, b, H.wall);
  gable(F, X, (b.u0 + b.u1) / 2, vc, d, w, b.h, 2.8, H.wall, H.roof);
  // floor line
  on(H, b, 'f', vc, 2.95, 0, w, 0.14, 0.06, B.trimD, TRIM);
  frontDoor(H, b, vc, 2.2);
  for (const y of [1.6, 4.4]) {
    windows(H, b, 'f', y, { gap: 2.4, skip: y < 2 ? [[vc - 0.8, vc + 0.8]] : [], shutters: true });
    windows(H, b, 'b', y, { gap: 2.6 });
    windows(H, b, 'l', y, { gap: 3.4 });
    windows(H, b, 'r', y, { gap: 3.4 });
  }
  // portico: two columns and a little pediment
  for (const s of [-1, 1]) F.put(B.plainC, b.u1 + 1.35, 1.6, vc + s * 0.95, 0.24, 2.6, 0.24, TRIM);
  F.put(B.trim, b.u1 + 0.8, 2.95, vc, 1.7, 0.2, 2.5, TRIM);
  gable(F, X, b.u1 + 0.8, vc, 1.6, 2.5, 3.05, 0.7, TRIM, H.roof, 0.1);
  F.put(B.conc, b.u1 + 1.1, 0.15, vc, 2.2, 0.3, 2.6, 0xa8a49b);
  // chimney on the far side wall
  F.put(B.brick, (b.u0 + b.u1) / 2 - 1, (b.h + 4) / 2, b.v0 - 0.45, 1.2, b.h + 4, 0.9, 0x8f4535);
  solid(H, b.u0, b.u1, b.v0 - 0.9, b.v1, b.h + 2.8);
  return { v: W / 2 - m - dw / 2, w: dw, u0: -set - 1, door: vc, hv0: b.v0, hv1: b.v1, depth: d, car: true };
}

/** A storey and a half, gable end to the street, deep front porch on posts. */
function bungalow(H, W, m, set) {
  const { F, ctx } = H, { X, B, R } = ctx;
  const dw = 3.2, d = 11, porch = 2.6;
  const vmax = W / 2 - m - dw - 0.8, vmin = -W / 2 + m;
  const w = Math.min(9.5, vmax - vmin), vc = (vmin + vmax) / 2;
  const b = { u0: -set - d, u1: -set, v0: vc - w / 2, v1: vc + w / 2, h: 3.1 };
  body(H, b, H.wall);
  // the ridge runs back from the street: build it in a frame turned a quarter
  const [cx, cz] = F.p((b.u0 + b.u1) / 2, vc);
  const G = new Frame(ctx.kit, cx, cz, F.yaw + Math.PI / 2, 0);
  gable(G, X, 0, 0, w, d, b.h, 2.9, H.wall, H.roof, 0.5);
  // gable-end window high up
  win(H, b, 'f', vc, 4.1, 1.0, 0.9);
  // porch: deck, one step, posts, rail, shed roof
  const pu0 = b.u1, pu1 = b.u1 + porch;
  F.put(B.wood, (pu0 + pu1) / 2, 0.21, vc, porch, 0.42, w, 0x7a5a3e);
  F.put(B.conc, pu1 + 0.25, 0.1, vc, 0.5, 0.2, 1.8, 0xa8a49b);
  F.walk(pu0, pu1, b.v0, b.v1, 0.42);
  F.phys(pu0, pu1, 0, 0.42, b.v0, b.v1);
  F.walk(pu1, pu1 + 0.5, vc - 0.9, vc + 0.9, 0.2, { noSeat: true });
  for (const t of [-0.5, -0.17, 0.17, 0.5]) {
    const v = vc + t * (w - 0.3);
    F.put(B.trim, pu1 - 0.2, 0.42 + 1.25, v, 0.22, 2.5, 0.22, TRIM);
  }
  for (const s of [-1, 1]) {
    // rails either side of the steps
    const v0 = s < 0 ? b.v0 + 0.1 : vc + 0.9, v1 = s < 0 ? vc - 0.9 : b.v1 - 0.1;
    F.put(B.trimD, pu1 - 0.2, 1.3, (v0 + v1) / 2, 0.08, 0.08, v1 - v0, TRIM);
    for (let v = v0 + 0.15; v < v1; v += 0.3) F.put(B.trimD, pu1 - 0.2, 0.86, v, 0.04, 0.88, 0.04, TRIM);
    F.walk(pu1 - 0.25, pu1 - 0.15, v0, v1, 1.34, { noSeat: true });
  }
  F.slope(X.roof, pu0 - 0.1, b.h + 0.4, pu1 + 0.35, b.h - 0.1, vc, w + 0.4, 0.12, H.roof);
  frontDoor(H, b, vc - w * 0.18, 2.1, false);
  win(H, b, 'f', vc + w * 0.22, 1.6, 1.6, 1.4);
  windows(H, b, 'l', 1.6, { gap: 2.8 });
  windows(H, b, 'r', 1.6, { gap: 2.8 });
  windows(H, b, 'b', 1.6, { gap: 3 });
  solid(H, b.u0, b.u1, b.v0, b.v1, b.h + 2.9);
  return { v: W / 2 - m - dw / 2, w: dw, u0: -set - 2, door: vc, hv0: b.v0 - 5, hv1: b.v0 - 5, depth: d, car: true };
}

/** Flat roofs, two stacked volumes, floor-to-ceiling glass, cedar cladding and a carport. */
function modern(H, W, m, set) {
  const { F, ctx } = H, { B, R } = ctx;
  const dw = 3.4, d = 9;
  const vmax = W / 2 - m - dw - 0.6, vmin = -W / 2 + m;
  const w = Math.min(12, vmax - vmin), vc = (vmin + vmax) / 2;
  const col = R.pick([0xf2f0ea, 0xe6e4de, 0x3a3d40, 0x55595c]);
  const b = { u0: -set - d, u1: -set, v0: vc - w / 2, v1: vc + w / 2, h: 3.3 };
  body(H, b, col, B.stucco);
  const t = { u0: b.u0 + 0.5, u1: b.u0 + 7.2, v0: b.v0 + w * 0.35, v1: b.v1 + 0.6, h: 6.4 };
  F.put(B.stucco, (t.u0 + t.u1) / 2, (b.h + t.h) / 2, (t.v0 + t.v1) / 2, t.u1 - t.u0, t.h - b.h, t.v1 - t.v0, col);
  for (const s of [b, t]) F.put(B.plain, (s.u0 + s.u1) / 2, s.h + 0.12, (s.v0 + s.v1) / 2, s.u1 - s.u0 + 0.3, 0.24, s.v1 - s.v0 + 0.3, 0x2b2d30);
  // glazing: a wall of glass on the ground floor, a ribbon window above, a cedar panel
  const gv0 = b.v0 + 0.6, gv1 = b.v0 + w * 0.55;
  on(H, b, 'f', (gv0 + gv1) / 2, 1.75, 0, gv1 - gv0, 2.7, 0.04, B.glass, R.pick(GLASS));
  for (let v = gv0; v <= gv1 + 0.01; v += (gv1 - gv0) / 3) on(H, b, 'f', v, 1.75, 0.02, 0.06, 2.7, 0.05, B.frame, 0x222426);
  on(H, b, 'f', (b.v0 + w * 0.55 + b.v1) / 2 + 0.3, 1.65, 0, w * 0.4, 3.3, 0.06, B.wood, 0xa0703f);
  H.F.put(B.glass, t.u1 + 0.02, (b.h + t.h) / 2 + 0.2, (t.v0 + t.v1) / 2, 0.04, 1.2, (t.v1 - t.v0) - 1, R.pick(GLASS));
  const dv = b.v0 + w * 0.55 + 0.9;
  H.door = 0x222426;
  frontDoor(H, b, Math.min(dv, b.v1 - 0.9), 2.3, true);
  windows(H, b, 'l', 1.7, { gap: 3.2, w: 1.8, h: 1.1 });
  windows(H, b, 'b', 1.7, { gap: 3, w: 2, h: 1.6 });
  // carport: a thin roof on two steel posts over the driveway
  const cv = W / 2 - m - dw / 2, cu0 = b.u1 - 6, cu1 = b.u1;
  F.put(B.plain, (cu0 + cu1) / 2, 2.6, cv - 0.2, cu1 - cu0, 0.18, dw + 0.8, 0x2b2d30);
  for (const u of [cu0 + 0.3, cu1 - 0.3]) {
    F.put(B.metal, u, 1.26, cv + dw / 2 + 0.1, 0.12, 2.52, 0.12, 0x2b2d30);
    F.walk(u - 0.08, u + 0.08, cv + dw / 2 + 0.02, cv + dw / 2 + 0.18, 2.6, { noSeat: true });
  }
  solid(H, b.u0, b.u1, b.v0, b.v1, b.h + 0.24);
  solid(H, t.u0, t.u1, t.v0, Math.min(t.v1, b.v1), t.h + 0.24);
  return { v: cv, w: dw, u0: cu0, door: Math.min(dv, b.v1 - 0.9), hv0: b.v0, hv1: gv0, depth: d, car: true };
}
