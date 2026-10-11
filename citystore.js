import * as THREE from 'three';
import { Batch } from './cityparts.js';

/*
  The gun store: a hollow ground floor carved into one building of the plaza's north row.
  Walls with a doorway and two display windows onto the plaza, a wood floor, a lit ceiling,
  a glass-topped counter with the stock laid out in it, a pegboard behind, shelves of ammo.
  Returns the buy spots (what, price, where it lies, where you stand to buy it); the models,
  price tags and buying itself live in store.js.
*/

export const STOCK = [
  { type: 'pistol', name: 'Pistol', price: 150 },
  { type: 'shotgun', name: 'Shotgun', price: 400 },
  { type: 'rifle', name: 'Assault Rifle', price: 750 },
  { type: 'smg', name: 'Submachine Gun', price: 550 },
  { type: 'crowbar', name: 'Crowbar', price: 45 },
  { type: 'machete', name: 'Machete', price: 90 },
  { type: 'longsword', name: 'Longsword', price: 260 },
  { type: 'bat', name: 'Baseball Bat', price: 30 },
  { type: 'molotov', name: 'Molotov', price: 40 },
  { type: 'gas', name: 'Gas Grenade', price: 60 },
  { type: 'frag', name: 'Frag Grenade', price: 120 },
];

/**
 * b = the store's building rect { x0, x1, z0, z1, h, color }, front on +z.
 * K = { body, trim, glass, frame, plain, wood, metal, lamp, solid(x0,x1,z0,z1,y0,y1,extra), phys(...same), scene, CH, signTex }
 */
/**
 * The room's ceiling lamp, baked into the interior's own materials instead of a PointLight:
 * any real light makes every standard material in the city evaluate it, every frame, on
 * every pixel. This adds the same diffuse term three would (inverse-power falloff with a
 * smooth cutoff, Lambert, no specular, no shadows - the room is closed) as emissive light, so
 * it costs nothing outside the store.
 */
export function fakeLit(src, { pos, color, intensity, cutoff, decay }) {
  const m = src.clone();
  const col = new THREE.Color(color).multiplyScalar(intensity / Math.PI);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lampPos = { value: pos }; sh.uniforms.lampCol = { value: col };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLWP;\nvarying vec3 vLWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 lwp_ = vec4(transformed, 1.0);
        vec3 lwn_ = objectNormal;
        #ifdef USE_INSTANCING
          lwp_ = instanceMatrix * lwp_;
          lwn_ = mat3(instanceMatrix) * lwn_;
        #endif
        vLWP = (modelMatrix * lwp_).xyz;
        vLWN = normalize(mat3(modelMatrix) * lwn_);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLWP;\nvarying vec3 vLWN;\nuniform vec3 lampPos;\nuniform vec3 lampCol;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 L = lampPos - vLWP; float d = length(L);
          float fall = 1.0 / max(pow(d, ${decay.toFixed(3)}), 0.01);
          fall *= pow2(saturate(1.0 - pow4(d / ${cutoff.toFixed(3)})));
          float nl = saturate(dot(normalize(vLWN), L / max(d, 1e-4)));
          totalEmissiveRadiance += diffuseColor.rgb * (1.0 - metalnessFactor) * lampCol * fall * nl;
        }`);
  };
  m.customProgramCacheKey = () => 'storelamp';
  return m;
}

/**
 * The shop shell both stores share: walls, doorway and display windows onto the plaza, a sign,
 * the lit room (floor, ceiling, lining, lamps). Returns the room and the lamp-lit batches.
 */
export function storeShell(b, K, signText, signCols, wainscot = 0x3b2d22, plaster = 0xd9d0bf, floorCol = 0x6b4e35) {
  const { x0, x1, z0, z1, h } = b, CH = K.CH, T = 0.3, TOP = 3.8;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const cam = { cam: true, noSeat: true };
  const wallV = (ax, bx, az, bz, y0, y1) => K.body.add((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2, bx - ax, y1 - y0, bz - az, b.color);

  // ---- shell: upper floors sit on the ceiling slab; the walls stand on the ground ----
  wallV(x0, x1, z0, z1, TOP, h);
  K.phys(x0, x1, z0, z1, TOP, h, cam);
  const wall = (ax, bx, az, bz) => { wallV(ax, bx, az, bz, 0, TOP); K.solid(ax, bx, az, bz, 0, TOP, cam); };
  wall(x0, x1, z0, z0 + T);                  // back (north street side)
  wall(x0, x0 + T, z0 + T, z1 - T);          // sides
  wall(x1 - T, x1, z0 + T, z1 - T);
  // front, onto the plaza: pier | window | pier | door | pier | window | pier
  const door = [-0.8, 0.8].map((d) => cx + d), winL = [x0 + 0.8, cx - 1.6], winR = [cx + 1.6, x1 - 0.8];
  const fz0 = z1 - T, fz1 = z1, SILL = 0.7, HEAD = 2.9, DOOR_H = 2.6;
  wall(x0, winL[0], fz0, fz1 + 0);
  wall(winL[1], door[0], fz0, fz1);
  wall(door[1], winR[0], fz0, fz1);
  wall(winR[1], x1, fz0, fz1);
  for (const [a, c] of [winL, winR]) {
    wallV(a, c, fz0, fz1, 0, SILL); K.solid(a, c, fz0, fz1, 0, SILL, cam);
    wallV(a, c, fz0, fz1, HEAD, TOP); K.phys(a, c, fz0, fz1, HEAD, TOP, cam);
    K.glass.add((a + c) / 2, (SILL + HEAD) / 2, (fz0 + fz1) / 2, c - a, HEAD - SILL, 0.03, 0x6d7f8c);
    K.solid(a, c, fz0 + 0.1, fz1 - 0.1, SILL, HEAD, { noSeat: true });
    for (const x of [a, c]) K.frame.add(x, (SILL + HEAD) / 2, fz1 - 0.02, 0.08, HEAD - SILL, 0.06, 0x1d2024);
    K.frame.add((a + c) / 2, HEAD, fz1 - 0.02, c - a, 0.08, 0.06, 0x1d2024);
    K.trim.add((a + c) / 2, SILL, fz1 + 0.04, c - a + 0.2, 0.08, 0.14, 0xd8cfc0);
  }
  wallV(door[0], door[1], fz0, fz1, DOOR_H, TOP); K.phys(door[0], door[1], fz0, fz1, DOOR_H, TOP, cam);
  for (const x of door) K.frame.add(x, DOOR_H / 2, (fz0 + fz1) / 2, 0.1, DOOR_H, T + 0.04, 0x1d2024);
  K.frame.add(cx, DOOR_H, (fz0 + fz1) / 2, door[1] - door[0] + 0.1, 0.1, T + 0.04, 0x1d2024);
  // the door leaf, swung open against the inside of the front wall
  K.frame.add(door[1] + 0.05, 1.3 + CH, fz0 - 0.8, 0.05, 2.4, 1.5, 0x1d2024);
  K.glass.add(door[1] + 0.05, 1.45 + CH, fz0 - 0.8, 0.07, 1.6, 1.2, 0x9fb3c0);
  K.solid(door[1], door[1] + 0.1, fz0 - 1.55, fz0, 0, 2.6, { noSeat: true });
  // sign over the storefront
  const signMat = new THREE.MeshStandardMaterial({ map: K.signTex(signText, ...signCols), roughness: 0.5 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(W - 1.2, 0.75, 0.1), signMat);
  sign.position.set(cx, 3.35, z1 + 0.06);
  sign.castShadow = true;
  K.scene.add(sign);
  K.lamp.add(cx, 2.93, z1 + 0.2, W - 1.6, 0.03, 0.12);

  // ---- inside ----
  // everything in the room is drawn with the lamp baked in (fakeLit): own batches, built below
  const lamp = { pos: new THREE.Vector3(cx, TOP - 0.4, cz), color: 0xfff0d8, intensity: 22, cutoff: 14, decay: 1.4 };
  const lit = (bt) => new Batch(bt.geo, fakeLit(bt.mat, lamp), { cast: bt.cast });
  K = { ...K, plain: lit(K.plain), wood: lit(K.wood), metal: lit(K.metal) };
  const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
  K.plain.add(cx, CH / 2, (iz0 + z1) / 2, ix1 - ix0, CH, z1 - iz0, floorCol);          // floor (runs out under the door)
  K.solid(ix0, ix1, iz0, z1, 0, CH, { noSeat: true });
  const seam = new THREE.Color(floorCol).multiplyScalar(0.72).getHex();
  for (let k = ix0 + 0.18; k < ix1; k += 0.18) K.plain.add(k, CH + 0.001, (iz0 + iz1) / 2, 0.006, 0.002, iz1 - iz0, seam); // board seams
  K.plain.add(cx, TOP - 0.01, cz, ix1 - ix0, 0.02, iz1 - iz0, 0xe6e1d6);              // ceiling
  // lining: wainscot below, plaster above
  const line = (ax, bx, az, bz) => {
    K.plain.add((ax + bx) / 2, CH + 0.6, (az + bz) / 2, bx - ax, 1.2, bz - az, wainscot);
    K.plain.add((ax + bx) / 2, (CH + 1.2 + TOP) / 2, (az + bz) / 2, bx - ax, TOP - CH - 1.2, bz - az, plaster);
  };
  line(ix0, ix1, iz0, iz0 + 0.01);
  line(ix0, ix0 + 0.01, iz0, iz1);
  line(ix1 - 0.01, ix1, iz0, iz1);
  // light panels (their glow is the emissive lamp material; the light they cast is fakeLit's)
  for (const lx of [cx - 2.5, cx + 2.5]) for (const lz of [cz - 2.5, cz + 2]) K.lamp.add(lx, TOP - 0.03, lz, 1.2, 0.03, 0.3);
  return { K, cx, cz, CH, TOP, ix0, ix1, iz0, iz1, lamp, room: { x0: ix0, x1: ix1, z0: iz0, z1: iz1 } };
}

export function buildStore(b, K0) {
  const { x0, x1, z0 } = b;
  const { K, cx, CH, ix0, ix1, iz0, iz1, lamp, room } = storeShell(b, K0, 'GUNS & AMMO', ['#15171a', '#e8c46a']);

  // counter: a glass display case the customer faces from the door side
  const cz0 = z0 + 4.4, cz1 = cz0 + 0.7, ca = x0 + 1.2, cb = x1 - 1.2, CT = CH + 1.0, CASE = CH + 0.72;
  K.wood.add((ca + cb) / 2, (CH + CASE) / 2, (cz0 + cz1) / 2, cb - ca, CASE - CH, cz1 - cz0, 0x4a3322);
  K.plain.add((ca + cb) / 2, CASE + 0.01, (cz0 + cz1) / 2, cb - ca - 0.1, 0.02, cz1 - cz0 - 0.1, 0x2a1c1c); // felt
  K.caseGlass.add((ca + cb) / 2, (CASE + CT) / 2, (cz0 + cz1) / 2, cb - ca, CT - CASE, cz1 - cz0, 0xb9cad4);
  for (const x of [ca, cb]) for (const z of [cz0, cz1]) K.metal.add(x, (CASE + CT) / 2, z, 0.03, CT - CASE, 0.03, 0x9aa0a6);
  K.metal.add((ca + cb) / 2, CT, cz1, cb - ca, 0.02, 0.03, 0x9aa0a6);
  K.metal.add((ca + cb) / 2, CT, cz0, cb - ca, 0.02, 0.03, 0x9aa0a6);
  K.solid(ca, cb, cz0, cz1, 0, CT, { noSeat: true });
  // pegboard behind the counter and ammo shelves along the side walls
  K.wood.add(cx, CH + 2.1, iz0 + 0.03, cb - ca, 1.6, 0.04, 0x8b6f4e);
  const shelf = (x, zA, zB, s) => {
    for (let k = 0; k < 4; k++) {
      const y = CH + 0.3 + k * 0.55;
      K.wood.add(x, y, (zA + zB) / 2, 0.45, 0.03, zB - zA, 0x5c4330);
      for (let z = zA + 0.15; z < zB - 0.1; z += 0.2 + Math.random() * 0.12) {
        const bh = 0.12 + Math.random() * 0.12;
        K.plain.add(x + s * (0.02 + Math.random() * 0.05), y + 0.015 + bh / 2, z, 0.26, bh, 0.16, [0x2e5a3a, 0x8a1f1f, 0xc9a13a, 0x2a4d8f, 0x3a3a3a][(Math.random() * 5) | 0]);
      }
    }
    for (const z of [zA, zB]) K.wood.add(x, CH + 1.1, z, 0.45, 2.2, 0.03, 0x4a3322);
    K.solid(x - 0.23, x + 0.23, zA, zB, 0, CH + 2.2, { noSeat: true });
  };
  shelf(ix0 + 0.24, cz1 + 1.2, iz1 - 0.8, 1);
  shelf(ix1 - 0.24, cz1 + 1.2, iz1 - 0.8, -1);
  // doormat
  K.plain.add(cx, CH + 0.004, iz1 - 0.6, 1.4, 0.008, 0.8, 0x2d2a26);

  // ---- stock: evenly along the case; you buy it standing in front ----
  const n = STOCK.length, slot = (cb - ca) / n;
  const spots = STOCK.map((s, i) => {
    const x = ca + slot * (i + 0.5);
    return { ...s, lie: new THREE.Vector3(x, CASE + 0.02, (cz0 + cz1) / 2), stand: new THREE.Vector3(x, CH, cz1 + 0.45), tag: new THREE.Vector3(x, CH + 0.5, cz1 + 0.006) };
  });
  // decorative pieces on the pegboard (models placed by store.js)
  for (const k of ['plain', 'wood', 'metal']) K[k].build(K.scene);
  const wallRack = [0, 1, 2, 3, 4, 5].map((i) => new THREE.Vector3(ca + 0.6 + i * ((cb - ca - 1.2) / 5), CH + 2.3 - (i % 2) * 0.55, iz0 + 0.08));
  return { spots, wallRack, lamp, room };
}

/**
 * The clothes store: rails of shirts along the walls, stacked trousers on tables, a long
 * mirror on the back wall and a spot in front of it where you try things on.
 */
export function buildClothes(b, K0) {
  const { K, cx, cz, CH, ix0, ix1, iz0, iz1, lamp, room } = storeShell(b, K0, 'THREADS', ['#f4efe6', '#b0305a'], 0xe9e3d8, 0xf3eee6, 0xb89a74);
  const COLS = [0x3d6fb6, 0xc4553d, 0x5a8f55, 0xd9b440, 0x8a5aa8, 0xe8e4dc, 0x2b2d33, 0xd27a9a, 0x4aa3a0, 0xe07b39, 0x1f3b5c, 0xb03a48];
  const pick = () => COLS[(Math.random() * COLS.length) | 0];
  // clothes rails down both side walls: a chrome bar, shirts hanging off it
  const rail = (x, zA, zB, s) => {
    K.metal.add(x, CH + 1.62, (zA + zB) / 2, 0.03, 0.03, zB - zA, 0xc7ccd1);
    for (const z of [zA, zB]) K.metal.add(x, CH + 0.81, z, 0.03, 1.62, 0.03, 0xc7ccd1);
    for (let z = zA + 0.15; z < zB - 0.1; z += 0.11 + Math.random() * 0.05) {
      const c = pick();
      K.plain.add(x, CH + 1.25, z, 0.46, 0.7, 0.03, c);                     // shirt on its hanger
      K.plain.add(x - s * 0.02, CH + 1.52, z, 0.5, 0.12, 0.04, c);          // shoulders
    }
    K.solid(x - 0.26, x + 0.26, zA, zB, 0, CH + 1.7, { noSeat: true });
  };
  rail(ix0 + 0.4, iz0 + 1.2, iz1 - 1.4, 1);
  rail(ix1 - 0.4, iz0 + 1.2, iz1 - 1.4, -1);
  // a table of folded trousers in the middle
  const tz = cz + 1.2;
  K.wood.add(cx, CH + 0.4, tz, 1.8, 0.8, 0.9, 0xd9c7a3);
  for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) {
    K.plain.add(cx - 0.62 + i * 0.25, CH + 0.83 + k * 0.05, tz + (k % 2 ? 0.02 : -0.02), 0.22, 0.045, 0.34, [0x2a2a30, 0x2f4a6e, 0xb9ab8a, 0x46607f, 0x55463a, 0x3b3f4a][i]);
  }
  K.solid(cx - 0.9, cx + 0.9, tz - 0.45, tz + 0.45, 0, CH + 0.95, { noSeat: true });
  // the mirror: a tall glass panel in a frame on the back wall, a rug in front of it
  const mz = iz0 + 0.05;
  K.wood.add(cx, CH + 1.2, mz, 1.3, 2.2, 0.06, 0x3a2a1c);
  K.metal.add(cx, CH + 1.2, mz + 0.035, 1.14, 2.04, 0.01, 0xdfe6ea);
  K.plain.add(cx, CH + 0.004, iz0 + 1.3, 1.6, 0.008, 1.2, 0x8c2a55);
  for (const k of ['plain', 'wood', 'metal']) K[k].build(K.scene);
  return { mirror: new THREE.Vector3(cx, CH, iz0 + 1.3), mirrorYaw: 0, lamp, room };
}

/**
 * The police station: a front desk across the room with an officer behind it, desks and filing
 * cabinets in the back office, a barred holding cell in the corner, a blue lamp by the door.
 * Returns where the officers stand their posts, and the room.
 */
export function buildStation(b, K0) {
  const { x0, x1, z1 } = b;
  const { K, cx, CH, ix0, ix1, iz0, iz1, lamp, room } = storeShell(b, K0, 'POLICE', ['#1b2a4a', '#ffffff'], 0x2e3f5c, 0xe3e6ea, 0x8f949b);
  // front desk: from the left wall, a gap on the right to get behind it
  const dz0 = iz0 + 5.2, dz1 = dz0 + 0.7, da = ix0, db = ix1 - 2.4, DT = CH + 1.05;
  K.wood.add((da + db) / 2, (CH + DT) / 2, (dz0 + dz1) / 2, db - da, DT - CH, dz1 - dz0, 0x2b3a55);
  K.plain.add((da + db) / 2, DT + 0.015, (dz0 + dz1) / 2, db - da + 0.06, 0.03, dz1 - dz0 + 0.1, 0xcfd3d8);
  K.metal.add(cx - 1.2, DT + 0.2, dz0 + 0.3, 0.45, 0.32, 0.04, 0x1d2126);                  // a monitor
  K.solid(da, db, dz0, dz1, 0, DT + 0.03, { noSeat: true });
  // back office: two desks, chairs, filing cabinets, a notice board
  for (const [x, z] of [[ix0 + 1.6, iz0 + 1.6], [cx + 1.4, iz0 + 1.6]]) {
    K.wood.add(x, CH + 0.72, z, 1.5, 0.05, 0.75, 0x8a6e4f);
    for (const dx of [-0.68, 0.68]) K.metal.add(x + dx, CH + 0.36, z, 0.05, 0.72, 0.7, 0x3a3f46);
    K.metal.add(x, CH + 0.95, z - 0.2, 0.42, 0.3, 0.04, 0x1d2126);
    K.plain.add(x, CH + 0.45, z + 0.65, 0.45, 0.08, 0.45, 0x22262c);                         // chair
    K.solid(x - 0.75, x + 0.75, z - 0.38, z + 0.38, 0, CH + 0.75, { noSeat: true });
  }
  for (let k = 0; k < 3; k++) K.metal.add(ix1 - 0.3, CH + 0.65, iz0 + 3.2 + k * 0.52, 0.5, 1.3, 0.48, 0x7c848c);
  K.solid(ix1 - 0.55, ix1, iz0 + 2.9, iz0 + 4.8, 0, CH + 1.3, { noSeat: true });
  K.wood.add(cx, CH + 1.8, iz0 + 0.03, 2.4, 1.1, 0.04, 0xa8845c);
  for (let k = 0; k < 7; k++) K.plain.add(cx - 0.95 + k * 0.32, CH + 1.8 + (k % 2 ? 0.2 : -0.15), iz0 + 0.06, 0.2, 0.26, 0.01, 0xf2efe6);
  // holding cell, front left: bars on two sides
  const cz0 = dz1 + 1.4, cz1 = iz1 - 0.3, cx1 = ix0 + 2.6;
  for (let x = ix0 + 0.12; x < cx1; x += 0.14) K.metal.add(x, (CH + 2.6) / 2, cz0, 0.025, 2.6 - CH, 0.025, 0x2a2e33);
  for (let z = cz0; z < cz1; z += 0.14) K.metal.add(cx1, (CH + 2.6) / 2, z, 0.025, 2.6 - CH, 0.025, 0x2a2e33);
  K.metal.add((ix0 + cx1) / 2, 2.6, cz0, cx1 - ix0, 0.06, 0.06, 0x2a2e33);
  K.metal.add(cx1, 2.6, (cz0 + cz1) / 2, 0.06, 0.06, cz1 - cz0, 0x2a2e33);
  K.solid(ix0, cx1, cz0 - 0.03, cz0 + 0.03, 0, 2.6, { noSeat: true });
  K.solid(cx1 - 0.03, cx1 + 0.03, cz0, cz1, 0, 2.6, { noSeat: true });
  K.wood.add(ix0 + 0.3, CH + 0.4, (cz0 + cz1) / 2, 0.5, 0.06, cz1 - cz0 - 0.4, 0x5c4330);   // bench inside
  for (const k of ['plain', 'wood', 'metal']) K[k].build(K.scene);
  // the blue lamp over the door
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshStandardMaterial({ color: 0x2a5cff, emissive: 0x2a5cff, emissiveIntensity: 1.6 }));
  blue.position.set(cx, 3.05, z1 + 0.35);
  K.scene.add(blue);
  const V3 = (x, z) => new THREE.Vector3(x, CH, z);
  return {
    room, lamp,
    // the desk officer, and one by the door
    posts: [{ pos: V3(cx - 1.2, dz0 - 0.55), yaw: 0 }, { pos: V3(ix1 - 1.3, iz1 - 1.6), yaw: -Math.PI / 2 }, { pos: V3(cx + 1.4, iz0 + 2.5), yaw: Math.PI }],
    door: V3(cx, z1 + 1.2),
  };
}
