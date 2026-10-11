/*
  Street props for the city level, each built from batched boxes / cylinders in its own local
  frame (u = forward, v = right, y = up) and given two kinds of collision:
    walk: flat-topped footprints for the character controller (standing, stepping, sitting),
    phys: the actual solid parts for ragdolls, debris and blood (Rapier + stains).
  Yaws are multiples of 90 degrees, so every local box maps to an axis-aligned world box.
*/

export class Frame {
  constructor(kit, x, z, yaw, y = 0) {
    this.kit = kit; this.x = x; this.z = z; this.yaw = yaw; this.y = y;
    this.fx = Math.sin(yaw); this.fz = Math.cos(yaw);   // forward
    this.lx = Math.cos(yaw); this.lz = -Math.sin(yaw);  // right (local +X of a batch box)
  }
  p(u, v) { return [this.x + this.fx * u + this.lx * v, this.z + this.fz * u + this.lz * v]; }
  /** Box su (forward) x sy x sv (right), centred at (u, y, v); pitch tips +y toward +u. */
  put(b, u, y, v, su, sy, sv, c = 0xffffff, pitch = 0, roll = 0) {
    const [x, z] = this.p(u, v);
    b.add(x, this.y + y, z, sv, sy, su, c, this.yaw, pitch, roll);
  }
  /** A slab whose outer face runs from (u1, y1) to (u2, y2) (u2 > u1), `thick` deep behind it. */
  slope(b, u1, y1, u2, y2, v, sv, thick, c) {
    const du = u2 - u1, dy = y2 - y1, len = Math.hypot(du, dy), th = Math.atan2(dy, du);
    const nu = -Math.sin(th), ny = Math.cos(th);
    this.put(b, (u1 + u2) / 2 - nu * thick / 2, (y1 + y2) / 2 - ny * thick / 2, v, len, thick, sv, c, -th);
  }
  rect(u0, u1, v0, v1) {
    const [ax, az] = this.p(u0, v0), [bx, bz] = this.p(u1, v1);
    return [Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz)];
  }
  walk(u0, u1, v0, v1, top, extra) { const [x0, x1, z0, z1] = this.rect(u0, u1, v0, v1); this.kit.walkBox(x0, x1, z0, z1, this.y + top, extra); }
  phys(u0, u1, y0, y1, v0, v1, extra) { const [x0, x1, z0, z1] = this.rect(u0, u1, v0, v1); this.kit.physBox(x0, x1, this.y + y0, this.y + y1, z0, z1, extra); }
  solid(u0, u1, y0, y1, v0, v1, extra) { this.walk(u0, u1, v0, v1, y1, extra); this.phys(u0, u1, y0, y1, v0, v1); }
}

// ---------------------------------------------------------------- cars
const CAR_COLS = [0xb0302a, 0x2a4d8f, 0xdedede, 0x1d1d1f, 0x6d7278, 0x9aa3a8, 0x2e6b4a, 0xc9a13a, 0x7a2f55, 0xe5e1d6, 0x5a2a22, 0x3a4a5a];
const TRIM = 0x1c1d20, WELL = 0x0b0b0c, GLASS = 0x222b33, CHROME = 0xb9bdc2;

// side profiles: u of the nose/tail, windshield base, roof front/back, rear-glass base; y of the
// belt line (top of the doors) and the roof; wheel positions and radius; sill height
const CARS = {
  sedan: { L: 4.6, W: 1.8, sill: 0.3, belt: 0.82, roof: 1.42, ws: 0.9, rf: 0.22, rb: -0.95, rear: -1.45, wheel: 1.38, r: 0.32 },
  hatch: { L: 4.05, W: 1.76, sill: 0.3, belt: 0.84, roof: 1.47, ws: 0.95, rf: 0.28, rb: -1.55, rear: -1.9, wheel: 1.24, r: 0.31 },
  taxi: { L: 4.8, W: 1.84, sill: 0.3, belt: 0.84, roof: 1.45, ws: 0.95, rf: 0.25, rb: -1.0, rear: -1.5, wheel: 1.45, r: 0.33 },
  pickup: { L: 5.3, W: 1.95, sill: 0.42, belt: 1.02, roof: 1.86, ws: 1.25, rf: 0.55, rb: -0.55, rear: -0.55, wheel: 1.68, r: 0.39, bed: -0.65 },
  van: { L: 5.1, W: 1.96, sill: 0.36, belt: 1.12, roof: 2.12, ws: 1.9, rf: 1.02, rb: -2.55, rear: -2.55, wheel: 1.65, r: 0.35 },
};

export function pickCar(R) {
  const t = R();
  return t < 0.46 ? 'sedan' : t < 0.7 ? 'hatch' : t < 0.8 ? 'taxi' : t < 0.9 ? 'pickup' : 'van';
}
export const carLength = (kind) => CARS[kind].L;

/** A parked car centred at (x, z), facing yaw, standing on y = 0. */
export function car(kit, x, z, yaw, kind = 'sedan') {
  const S = CARS[kind], { L, W, sill, belt, roof, ws, rf, rb, rear, wheel, r } = S;
  const F = new Frame(kit, x, z, yaw);
  const b = kit.b, R = kit.R;
  const col = kind === 'taxi' ? 0xf2b705 : kind === 'van' && R() < 0.6 ? R.pick([0xe8e6e0, 0xdedede, 0x2a4d8f]) : R.pick(CAR_COLS);
  const hl = L / 2;

  // ---- body: sill-to-belt tub with bumpers, wheel wells, hood and trunk ----
  const tubBack = S.bed ?? -hl + 0.08;
  F.put(b.paint, (hl - 0.08 + tubBack) / 2, (sill + belt) / 2, 0, hl - 0.08 - tubBack, belt - sill, W, col);
  for (const s of [1, -1]) {
    F.put(b.plain, s * (hl - 0.08), sill + 0.13, 0, 0.18, 0.28, W - 0.06, TRIM);           // bumper
    F.put(b.plain, s * (hl + 0.012), sill + 0.14, 0, 0.01, 0.12, 0.5, 0xe9e7df);            // plate
    for (const v of [-1, 1]) {
      F.put(b.plain, s * wheel, sill + r * 0.6, 0, r * 2.35, r * 1.2 + 0.02, W + 0.006, WELL); // wheel well
      F.put(b.tire, s * wheel, r, v * (W / 2 - 0.13), r * 2, 0.24, r * 2, 0xffffff, 0, Math.PI / 2);
      F.put(b.metalC, s * wheel, r, v * (W / 2 - 0.005), r * 1.15, 0.02, r * 1.15, CHROME, 0, Math.PI / 2);
    }
  }
  // lights and grille
  const ly = belt - 0.12;
  for (const v of [-1, 1]) {
    F.put(b.lamp, hl - 0.03, ly, v * (W / 2 - 0.26), 0.06, 0.13, 0.36);
    F.put(b.tail, -hl + 0.03, ly, v * (W / 2 - 0.22), 0.06, 0.15, 0.3);
  }
  F.put(b.plain, hl - 0.03, ly - 0.02, 0, 0.05, 0.16, W - 1.1, TRIM);
  // door shut lines and handles
  const doorF = Math.min(ws - 0.1, rf + 0.4), doorB = kind === 'hatch' ? rb + 0.2 : kind === 'pickup' || kind === 'van' ? rf - 0.9 : rb + 0.05;
  const doors = kind === 'van' || kind === 'pickup' ? [doorF, doorB] : [doorF, (doorF + doorB) / 2 - 0.05, doorB];
  for (const u of doors) F.put(b.plain, u, (sill + 0.1 + belt) / 2, 0, 0.012, belt - sill - 0.1, W + 0.008, TRIM);
  for (let i = 0; i < doors.length - 1; i++) F.put(b.plain, doors[i] - 0.22, belt - 0.12, 0, 0.14, 0.03, W + 0.02, CHROME);
  if (kind === 'van') F.put(b.plain, -0.1, (sill + roof) / 2, 0, 0.012, roof - sill - 0.25, W + 0.008, TRIM); // sliding door

  if (kind === 'van') {
    // tall box behind the cab, short nose in front
    F.put(b.paint, (rf + rb) / 2 - 0.01, (belt + roof) / 2, 0, rf - rb - 0.02, roof - belt, W, col);
    F.slope(b.paint, ws, belt + 0.03, hl - 0.08, belt - 0.08, 0, W - 0.02, 0.1, col);        // hood
    F.slope(b.glass, rf, roof - 0.06, ws, belt + 0.05, 0, W - 0.12, 0.4, GLASS);              // windshield
    F.put(b.glass, rf - 0.45, (belt + roof) / 2 + 0.05, 0, 0.8, roof - belt - 0.35, W + 0.01, GLASS); // cab side glass
    F.put(b.glass, -hl + 0.005, (belt + roof) / 2 + 0.1, 0, 0.02, 0.5, W - 0.5, GLASS);      // rear doors' windows
    F.put(b.plain, -hl + 0.005, (sill + roof) / 2, 0, 0.022, roof - sill - 0.1, 0.012, TRIM);
    for (const v of [-1, 1]) F.put(b.paint, ws - 0.15, belt + 0.12, v * (W / 2 + 0.1), 0.1, 0.2, 0.16, TRIM);
    // collision: nose + box
    F.solid(rb, hl, 0.2, belt, -W / 2, W / 2, { noSeat: true });
    F.solid(rb, rf + 0.3, belt, roof, -W / 2, W / 2, { noSeat: true });
    F.phys(rf + 0.3, ws, belt, (belt + roof) / 2, -W / 2 + 0.06, W / 2 - 0.06);
    return;
  }

  // ---- greenhouse: windshield and rear glass wedges, side glass, roof, pillars ----
  F.slope(b.paint, ws, belt + 0.04, hl - 0.07, belt - 0.02, 0, W - 0.04, 0.1, col);            // hood
  F.slope(b.glass, rf, roof - 0.03, ws, belt + 0.03, 0, W - 0.16, 0.45, GLASS);                // windshield
  F.put(b.glass, (rf + rb) / 2, (belt + roof) / 2 - 0.02, 0, rf - rb, roof - belt - 0.04, W - 0.14, GLASS);
  F.put(b.paint, (rf + rb) / 2, roof - 0.02, 0, rf - rb + 0.08, 0.06, W - 0.18, col);           // roof
  for (const v of [-1, 1]) {
    F.slope(b.paint, rf, roof - 0.01, ws, belt + 0.05, v * (W / 2 - 0.1), 0.07, 0.03, col);     // A pillars
    F.put(b.plain, (rf + rb) / 2 - 0.05, (belt + roof) / 2, v * (W / 2 - 0.07), 0.08, roof - belt - 0.06, 0.012, TRIM); // B pillar
    F.put(b.paint, ws - 0.12, belt + 0.1, v * (W / 2 + 0.07), 0.08, 0.12, 0.15, col);           // mirror
    F.put(b.plain, (rf + rb) / 2, belt + 0.01, v * (W / 2 - 0.068), rf - rb, 0.02, 0.012, CHROME); // window trim
  }
  if (kind === 'pickup') {
    // upright cab back, open bed with side walls and a tailgate
    const bf = S.bed, bh = belt + 0.02;
    F.put(b.paint, (bf - hl) / 2, sill + 0.12, 0, bf + hl, 0.24, W - 0.1, TRIM);                 // bed floor / chassis
    for (const v of [-1, 1]) F.put(b.paint, (bf - hl + 0.04) / 2, (sill + bh) / 2, v * (W / 2 - 0.04), bf + hl - 0.04, bh - sill, 0.08, col);
    F.put(b.paint, -hl + 0.06, (sill + bh) / 2, 0, 0.08, bh - sill, W - 0.16, col);             // tailgate
    F.put(b.paint, bf - 0.04, (sill + bh) / 2, 0, 0.08, bh - sill, W - 0.16, col);               // bed front wall
    F.put(b.plain, (bf - hl) / 2, bh + 0.01, 0, bf + hl, 0.02, W, TRIM);                         // rail caps
    F.solid(bf, hl, 0.2, belt, -W / 2, W / 2, { noSeat: true });
    F.solid(rb, rf, belt, roof, -W / 2 + 0.07, W / 2 - 0.07, { noSeat: true });
    F.phys(rf, ws, belt, (belt + roof) / 2, -W / 2 + 0.08, W / 2 - 0.08);
    F.phys(-hl, bf, 0.2, sill + 0.24, -W / 2, W / 2);                                           // bed floor
    for (const v of [-1, 1]) F.phys(-hl, bf, sill, bh, v > 0 ? W / 2 - 0.08 : -W / 2, v > 0 ? W / 2 : -W / 2 + 0.08);
    F.phys(-hl, -hl + 0.1, sill, bh, -W / 2, W / 2);
    F.walk(-hl, bf, -W / 2, W / 2, bh, { noSeat: true });
    return;
  }
  F.slope(b.glass, rear, belt + 0.05, rb, roof - 0.03, 0, W - 0.16, 0.45, GLASS);              // rear glass
  for (const v of [-1, 1]) F.slope(b.paint, rear, belt + 0.07, rb, roof - 0.01, v * (W / 2 - 0.1), 0.1, 0.03, col); // C pillars
  if (kind !== 'hatch') F.slope(b.paint, -hl + 0.07, belt + 0.02, rear, belt + 0.05, 0, W - 0.04, 0.1, col); // trunk lid
  if (kind === 'taxi') {
    F.put(b.plain, (rf + rb) / 2, roof + 0.1, 0, 0.3, 0.16, 0.8, 0xfdf6d8);
    F.put(b.lamp, (rf + rb) / 2, roof + 0.1, 0, 0.31, 0.08, 0.7);
    for (const v of [-1, 1]) F.put(b.plain, 0, sill + 0.28, v * (W / 2 + 0.002), 1.6, 0.08, 0.01, 0x1a1a1a);
  }

  // ---- collision ----
  F.solid(-hl, hl, 0.18, belt + 0.04, -W / 2, W / 2, { noSeat: true });
  F.solid(rb - 0.1, rf + 0.1, belt, roof, -W / 2 + 0.07, W / 2 - 0.07, { noSeat: true });
  F.phys(rf + 0.1, (rf + ws) / 2, belt, (belt + roof) / 2, -W / 2 + 0.08, W / 2 - 0.08);
  F.phys((rear + rb) / 2 - 0.1, rb - 0.1, belt, (belt + roof) / 2, -W / 2 + 0.08, W / 2 - 0.08);
}

// ---------------------------------------------------------------- seating
const IRON = 0x25292d;

/**
 * Park bench, sitter faces yaw. Cast-iron end frames with armrests, slatted seat and back.
 * Walk: seat block (sittable, front only) + backrest wall. Phys: seat, back, end frames only,
 * so things can fall underneath it.
 */
export function bench(kit, x, z, yaw, y) {
  const F = new Frame(kit, x, z, yaw, y), b = kit.b;
  const HL = 0.9, SEAT = 0.45, BACK = -0.24, lean = 0.2;
  for (let k = 0; k < 4; k++) F.put(b.wood, -0.155 + k * 0.103, SEAT - 0.02, 0, 0.09, 0.035, HL * 2, 0xffffff);
  for (let k = 0; k < 3; k++) {
    const h = 0.56 + k * 0.13;
    F.put(b.wood, BACK - (h - SEAT) * Math.tan(lean), h, 0, 0.03, 0.095, HL * 2, 0xffffff, -lean);
  }
  for (const s of [-1, 1]) {
    const v = s * (HL - 0.1);
    F.put(b.metal, 0.17, SEAT / 2 - 0.01, v, 0.05, SEAT - 0.02, 0.05, IRON);                    // front leg
    const top = BACK - 0.04 - (0.93 - SEAT) * Math.tan(lean);
    F.slope(b.metal, BACK - 0.04, SEAT, BACK + 0.01, 0, v, 0.05, 0.05, IRON);                  // rear leg
    F.slope(b.metal, top, 0.93, BACK - 0.04, SEAT, v, 0.05, 0.05, IRON);                       // back support
    F.put(b.metal, -0.04, SEAT - 0.06, v, 0.48, 0.05, 0.05, IRON);                               // seat rail
    F.put(b.metal, 0.03, 0.66, v, 0.44, 0.04, 0.07, IRON);                                       // armrest
    F.put(b.metal, 0.17, (SEAT + 0.66) / 2, v, 0.04, 0.66 - SEAT, 0.04, IRON);                   // armrest post
  }
  F.walk(-0.21, 0.21, -HL, HL, SEAT, { seatYaw: yaw });
  F.walk(-0.38, -0.21, -HL, HL, 0.95, { noSeat: true });
  F.phys(-0.2, 0.21, SEAT - 0.045, SEAT, -HL, HL);
  F.phys(-0.36, -0.24, 0.52, 0.94, -HL, HL);
  for (const s of [-1, 1]) F.phys(-0.3, 0.2, 0, 0.68, s * (HL - 0.1) - 0.03, s * (HL - 0.1) + 0.03);
  kit.claim(x, z, 1.1);
}

/** Bistro chair facing yaw (props.js builds it: it can be knocked flying); its seat goes straight into the seat list. */
export function chair(kit, x, z, yaw, y) {
  const F = new Frame(kit, x, z, yaw, y), H = 0.46;
  const [ox, oz] = F.p(0.21, 0);
  const seat = kit.seat(ox, y, oz, yaw, H);
  kit.breakable('chair', x, z, y, yaw, () => F.walk(-0.21, 0.21, -0.21, 0.21, H, { noSeat: true }), { seat });
}

/** Round café table with two chairs across it. */
export function cafeTable(kit, x, z, y, yaw = 0) {
  kit.breakable('table', x, z, y, 0, () => kit.walkCyl(x, z, 0.1, y + 0.76));
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  chair(kit, x - fx * 0.62, z - fz * 0.62, yaw, y);
  chair(kit, x + fx * 0.62, z + fz * 0.62, yaw + Math.PI, y);
  kit.claim(x, z, 1.2);
}

// ---------------------------------------------------------------- small furniture
/** Litter bin (props.js: tips over and spills). */
export function trashCan(kit, x, z, y) {
  kit.breakable('trash', x, z, y, 0, () => kit.walkCyl(x, z, 0.3, y + 0.93));
  kit.claim(x, z, 0.5);
}

export function hydrant(kit, x, z, y, yaw) {
  kit.breakable('hydrant', x, z, y, yaw, () => kit.walkCyl(x, z, 0.15, y + 0.75));
  kit.claim(x, z, 0.5);
}

/** Newspaper vending box on a pedestal, window toward the sidewalk (yaw). */
export function newsBox(kit, x, z, yaw, y) {
  const F = new Frame(kit, x, z, yaw, y), color = kit.R.pick([0xc0392b, 0x2e6fa8, 0xe0b52c, 0x3a8a4a]);
  kit.breakable('news', x, z, y, yaw, () => F.walk(-0.21, 0.21, -0.24, 0.24, 1.04, { noSeat: true }), { color });
  kit.claim(x, z, 0.45);
}

/** Blue post-box: body, rounded top, pull-down chute facing the sidewalk. */
export function mailbox(kit, x, z, yaw, y) {
  const F = new Frame(kit, x, z, yaw, y);
  kit.breakable('mail', x, z, y, yaw, () => F.walk(-0.25, 0.25, -0.26, 0.26, 1.3, { noSeat: true }));
  kit.claim(x, z, 0.45);
}

/** Row of inverted-U bike hoops across the sidewalk line (yaw = the way the hoops run). */
export function bikeRack(kit, x, z, yaw, y) {
  const F = new Frame(kit, x, z, yaw, y), b = kit.b;
  for (const v of [-0.6, 0, 0.6]) {
    for (const u of [-0.32, 0.32]) F.put(b.metalC, u, 0.4, v, 0.05, 0.8, 0.05, 0x5a6068);
    F.put(b.metalC, 0, 0.8, v, 0.05, 0.69, 0.05, 0x5a6068, Math.PI / 2);
    F.walk(-0.34, 0.34, v - 0.03, v + 0.03, 0.82, { noSeat: true });
    F.phys(-0.35, 0.35, 0.77, 0.83, v - 0.03, v + 0.03);
    for (const u of [-0.32, 0.32]) F.phys(u - 0.03, u + 0.03, 0, 0.8, v - 0.03, v + 0.03);
  }
  kit.claim(x, z, 1);
}

/** Parking meter at the curb. */
export function meter(kit, x, z, yaw, y) {
  kit.breakable('meter', x, z, y, yaw, () => kit.walkCyl(x, z, 0.05, y + 1.1));
  kit.claim(x, z, 0.35);
}

/** Bus shelter on the sidewalk: back panel toward the buildings, open to the curb (yaw = facing the street). */
export function busShelter(kit, x, z, yaw, y) {
  const F = new Frame(kit, x, z, yaw, y), b = kit.b, W = 2, D = 0.75, H = 2.6, frame = 0x3a3f45;
  F.put(b.glass, -D, 1.3, 0, 0.03, 2.1, W * 2 - 0.1, 0xa8bcc8);
  F.put(b.metal, -D, 0.14, 0, 0.06, 0.1, W * 2, frame);
  F.put(b.metal, -D, 2.38, 0, 0.06, 0.08, W * 2, frame);
  for (const s of [-1, 1]) {
    for (const u of [-D, D]) F.put(b.metal, u, H / 2, s * W, 0.08, H, 0.08, frame);
    F.put(b.glass, 0, 1.3, s * W, D * 2 - 0.12, 2.1, 0.03, 0xa8bcc8);
    F.put(b.metal, 0, 2.38, s * W, D * 2, 0.08, 0.06, frame);
  }
  F.put(b.metal, 0.05, H + 0.05, 0, D * 2 + 0.4, 0.1, W * 2 + 0.3, frame);
  F.put(b.lamp, 0.05, H - 0.005, 0, 0.3, 0.02, W * 2 - 0.4);
  // walls block walking; the roof only stops falling things
  F.solid(-D - 0.05, -D + 0.05, 0, H, -W, W, { noSeat: true });
  for (const s of [-1, 1]) F.solid(-D, D, 0, H, s * W - 0.05, s * W + 0.05, { noSeat: true });
  F.phys(-D - 0.15, D + 0.25, H, H + 0.1, -W - 0.15, W + 0.15);
  bench(kit, ...F.p(-D + 0.42, 0), yaw, y);
  kit.claim(x, z, 2.4);
}
