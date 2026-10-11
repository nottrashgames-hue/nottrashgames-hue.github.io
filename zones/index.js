import { worldMat, BOX } from '../cityparts.js';
import { PRISM, PYRAMID, ROCK, DISC } from './kit.js';
import { buildSuburb } from './suburb.js';
import { buildMidtown } from './midtown.js';
import { buildLake } from './lake.js';
import { buildDesert } from './desert.js';

/*
  The outer districts round the downtown grid. Each block is handed to its zone's builder with
  the level's batches and collision helpers (ctx); everything static goes into the same chunked
  InstancedMeshes as downtown, so the camera and the sun only ever draw the cells they can see.
*/
export function buildZones(ctx) {
  const { tex, batch, B, R, WORLD, XS } = ctx;
  const mats = {
    siding: worldMat({ map: tex.siding, roughness: 0.85 }, 1 / 2),
    shingle: worldMat({ map: tex.shingle, roughness: 0.95 }, 1 / 2),
    stone: worldMat({ map: tex.stone, roughness: 0.9 }, 1 / 2),
    rock: worldMat({ map: tex.rock, roughness: 0.95, flatShading: true }, 1 / 6),
  };
  ctx.X = {
    siding: batch('zSiding', BOX, mats.siding),
    gable: batch('zGable', PRISM, mats.siding),
    roof: batch('zRoof', BOX, mats.shingle),
    stone: batch('zStone', BOX, mats.stone),
    stoneGable: batch('zStoneGable', PRISM, mats.stone),
    slate: batch('zSlatePyr', PYRAMID, mats.shingle),
    rock: batch('zRock', ROCK, mats.rock),
    rockBox: batch('zRockBox', BOX, mats.rock),
    stucco: B.stucco,
    disc: batch('zDisc', DISC, ctx.M.plain),
    discMetal: batch('zDiscMetal', DISC, ctx.M.metal),
  };
  const updates = [];
  ctx.onUpdate = (f) => updates.push(f);
  ctx.drivewayCars = [];

  const build = { suburb: buildSuburb, midtown: buildMidtown, lake: buildLake, desert: buildDesert };
  for (const b of ctx.blocks) build[b.zone](b, ctx);
  streetFurniture(ctx);
  boundary(ctx);

  // a handful of the driveways get a car (each one is a live vehicle: keep it to a few)
  const dc = ctx.drivewayCars;
  for (let k = 0; k < 10 && dc.length; k++) ctx.parking.push(dc.splice(Math.floor(R() * dc.length), 1)[0]);

  return { update(dt) { for (const f of updates) f(dt); } };
}

/** Lamps along every outer sidewalk, and street trees on the leafy ones. */
function streetFurniture(ctx) {
  const { edges, FURN, lamp, tree, free } = ctx;
  for (const e of edges) {
    const pt = (a, d) => (e.along === 'x' ? [a, e.c + e.n * d] : [e.c + e.n * d, a]);
    const toward = e.along === 'x' ? [0, -e.n] : [-e.n, 0];
    const a0 = e.a0 + 7, a1 = e.a1 - 7;
    const leafy = e.b.zone === 'suburb' || e.b.zone === 'lake';
    const gap = e.b.zone === 'midtown' ? 18 : 30;
    for (let a = a0; a <= a1; a += gap) {
      const [x, z] = pt(a, FURN - 0.3);
      if (free(x, z, 0.5)) lamp(x, z, toward);
    }
    if (leafy) for (let a = a0 + 7.5; a <= a1; a += 15) {
      const [x, z] = pt(a, FURN + 0.3);
      if (free(x, z, 0.9)) tree(x, z, ctx.CH, 0.9 + ctx.R() * 0.35);
    }
  }
}

/**
 * The edge of the world: a concrete sound wall with a tree line behind it, and out east a ridge
 * of sandstone mesas where the desert runs into it.
 */
function boundary(ctx) {
  const { B, X, R, WORLD, XS, solidBox } = ctx;
  const E = WORLD, T = 1.2, H = 6.5, desertX = XS[4][0];
  const wall = (x0, x1, z0, z1) => {
    B.conc.add((x0 + x1) / 2, H / 2, (z0 + z1) / 2, x1 - x0, H, z1 - z0, 0xb9b6ae);
    B.trim.add((x0 + x1) / 2, H + 0.1, (z0 + z1) / 2, x1 - x0 + 0.2, 0.2, z1 - z0 + 0.2, 0x9c9890);
    solidBox(x0, x1, z0, z1, 0, H, { cam: true });
  };
  // north + south walls up to the desert, west wall full length
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -E - T : E;
    for (let x = -E - T; x < desertX; x += 24) wall(x, Math.min(desertX, x + 24), z0, z0 + T);
  }
  for (let z = -E; z < E; z += 24) wall(-E - T, -E, z, Math.min(E, z + 24));
  // tree line beyond the wall
  const greens = [0x44693a, 0x4f7a3a, 0x3c5e30, 0x5a8442];
  const bigTree = (x, z) => {
    const s = R.range(1.2, 1.8);
    B.bark.add(x, 2 * s, z, 0.4, 4 * s, 0.4);
    ctx.canopy(Array.from({ length: 3 }, () => [x + R.range(-1, 1), (4 + R.range(0.5, 2.5)) * s, z + R.range(-1, 1), 4 * s, 3.4 * s, 4 * s, R.pick(greens), R() * 6]));
  };
  for (let a = -E - 4; a < desertX; a += R.range(5, 8)) for (const s of [-1, 1]) bigTree(a, s * (E + R.range(4, 14)));
  for (let a = -E; a < E; a += R.range(5, 8)) bigTree(-E - R.range(4, 14), a);
  // mesas: stacked slabs of sandstone, each tier stepped in
  const mesa = (cx, cz, w, d, h) => {
    let y = 0, tw = w, td = d;
    while (y < h - 0.5) {
      const th = Math.min(h - y, R.range(3, 7));
      X.rockBox.add(cx + R.range(-0.8, 0.8), y + th / 2, cz + R.range(-0.8, 0.8), tw, th, td, 0xffffff);
      y += th; tw *= R.range(0.78, 0.94); td *= R.range(0.78, 0.94);
    }
    // talus boulders round the foot
    for (let k = 0; k < 6; k++) {
      const a = R() * Math.PI * 2, s = R.range(1.5, 4);
      X.rock.add(cx + Math.cos(a) * (w / 2 + s * 0.2), s * 0.3, cz + Math.sin(a) * (d / 2 + s * 0.2), s * 1.3, s, s * 1.1, 0xffffff, R() * 6);
    }
    solidBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 0, h, { cam: true });
  };
  // a ranch fence along the desert's edge: posts and three strands of wire
  const fence = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 3), yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
      B.wood.add(x, 0.65, z, 0.12, 1.3, 0.12, 0x7a5e44, R.range(-0.2, 0.2));
    }
    for (const y of [0.45, 0.8, 1.15]) B.metal.add((x0 + x1) / 2, y, (z0 + z1) / 2, 0.015, 0.015, L, 0x6a6a6a, yaw);
    ctx.kit.walkBox(Math.min(x0, x1) - 0.08, Math.max(x0, x1) + 0.08, Math.min(z0, z1) - 0.08, Math.max(z0, z1) + 0.08, 1.3);
  };
  for (const s of [-1, 1]) fence(desertX, s * (E + 0.6), E + 0.6, s * (E + 0.6));
  fence(E + 0.6, -E - 0.6, E + 0.6, E + 0.6);
  for (let z = -E - 20; z < E + 20; z += R.range(26, 38)) mesa(E + R.range(14, 22), z, R.range(20, 30), R.range(24, 34), R.range(14, 34));
  for (const s of [-1, 1]) for (let x = desertX + 6; x < E; x += R.range(28, 40)) mesa(x, s * (E + R.range(14, 22)), R.range(22, 32), R.range(20, 28), R.range(12, 28));
}

