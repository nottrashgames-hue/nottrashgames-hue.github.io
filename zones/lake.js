import * as THREE from 'three';
import { Frame } from '../cityprops.js';
import { SPHERE } from '../cityparts.js';
import { gable, inPoly } from './kit.js';

/*
  The lake park: an irregular lake ringed by a gravel beach and a paved loop path, with a
  wooden pier, a boathouse, rowboats and ducks on the water, reeds and lily pads, benches,
  lamps, picnic tables and trees. The water can't be walked on: invisible walls just inside
  the shoreline (too tall to climb) keep people on the beach, except along the pier.
*/

export function buildLake(block, ctx) {
  const { R, B, X, M, env, tex, scene, batch, kit } = ctx;
  const I = block.inner;
  const cx = (I.x0 + I.x1) / 2 - 2, cz = (I.z0 + I.z1) / 2 + 2;
  const r0 = Math.min(I.x1 - I.x0, I.z1 - I.z0) * 0.3;
  const rad = (a) => r0 * (1 + 0.12 * Math.sin(2 * a + 1) + 0.08 * Math.sin(3 * a + 2.3) + 0.05 * Math.sin(5 * a + 0.4));
  const ring = (off, n = 96) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, r = rad(a) + off;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });
  const shore = ring(0), beach = ring(3.2), inner = ring(-1.2);

  // ---------- water, beach ----------
  const shape = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const waterN = tex.waterN;
  waterN.repeat.set(1 / 9, 1 / 9);
  const water = new THREE.Mesh(
    new THREE.ShapeGeometry(shape(shore), 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x2f5f70, roughness: 0.06, metalness: 0.15, envMap: env, envMapIntensity: 1.25,
      normalMap: waterN, normalScale: new THREE.Vector2(0.55, 0.55), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
  );
  water.position.y = 0.02;
  water.receiveShadow = true;
  water.matrixAutoUpdate = false; water.updateMatrix();
  scene.add(water);
  const beachShape = shape(beach);
  beachShape.holes.push(new THREE.Path(shore.map(([x, z]) => new THREE.Vector2(x, -z))));
  const beachM = new THREE.Mesh(
    new THREE.ShapeGeometry(beachShape, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex.sand, color: 0xb9ad98, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  beachM.material.map = tex.sand.clone(); beachM.material.map.repeat.set(1 / 5, 1 / 5); beachM.material.map.needsUpdate = true;
  beachM.position.y = 0.01;
  beachM.receiveShadow = true;
  beachM.matrixAutoUpdate = false; beachM.updateMatrix();
  scene.add(beachM);
  ctx.onUpdate((dt) => {
    waterN.offset.x += dt * 0.012;
    waterN.offset.y += dt * 0.007;
  });

  // ---------- the pier: out from the east shore ----------
  const shoreE = cx + rad(0);
  const pier = { x0: shoreE - 20, x1: shoreE + 2.5, z0: cz - 1.5, z1: cz + 1.5 };
  const head = { x0: shoreE - 26, x1: shoreE - 20, z0: cz - 3.5, z1: cz + 3.5 };
  const PD = 0.2; // deck top: one step up from the beach
  const deck = (r) => {
    for (let x = r.x0 + 0.1; x < r.x1; x += 0.3) B.wood.add(x + 0.13, PD - 0.04, (r.z0 + r.z1) / 2, 0.26, 0.06, r.z1 - r.z0, R.pick([0x8a6a4a, 0x7f6044, 0x94724f]));
    for (let x = r.x0 + 0.3; x < r.x1; x += 2.5) for (const z of [r.z0 + 0.15, r.z1 - 0.15]) B.bark.add(x, PD / 2 - 0.3, z, 0.22, PD + 0.6, 0.22);
    kit.walkBox(r.x0, r.x1, r.z0, r.z1, PD);
    kit.physBox(r.x0, r.x1, PD - 0.08, PD, r.z0, r.z1);
  };
  deck(pier); deck(head);
  const rail = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    B.wood.add((x0 + x1) / 2, PD + 1, (z0 + z1) / 2, 0.08, 0.08, L, 0x6b5238, yaw);
    const n = Math.max(1, Math.round(L / 2));
    for (let i = 0; i <= n; i++) B.wood.add(x0 + (x1 - x0) * i / n, PD + 0.5, z0 + (z1 - z0) * i / n, 0.1, 1, 0.1, 0x6b5238);
    kit.walkBox(Math.min(x0, x1) - 0.05, Math.max(x0, x1) + 0.05, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.05, PD + 1.05, { noSeat: true });
    kit.physBox(Math.min(x0, x1) - 0.05, Math.max(x0, x1) + 0.05, PD + 0.95, PD + 1.05, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.05);
  };
  rail(pier.x0, pier.z0, pier.x1 - 3, pier.z0); rail(pier.x0, pier.z1, pier.x1 - 3, pier.z1);
  rail(head.x0, head.z0, head.x0, head.z1); rail(head.x0, head.z0, head.x1, head.z0); rail(head.x0, head.z1, head.x1, head.z1);
  // a bench at the end of the pier, looking out over the water
  ctx.bench(head.x0 + 1.2, cz, -Math.PI / 2, PD);

  // ---------- keep people out of the water ----------
  const cut = [pier, head].map((r) => ({ x0: r.x0 - 0.2, x1: r.x1 + 0.2, z0: r.z0 - 0.2, z1: r.z1 + 0.2 }));
  const STEP = 1.5;
  let zmin = Infinity, zmax = -Infinity;
  for (const [, z] of inner) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  for (let z = zmin; z < zmax; z += STEP) {
    const zc = z + STEP / 2;
    // crossings of the inset shoreline at this row (both band edges: keep the narrower span)
    const xs = [];
    for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
      const [xi, zi] = inner[i], [xj, zj] = inner[j];
      if ((zi > zc) !== (zj > zc)) xs.push(xi + ((zc - zi) / (zj - zi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let spans = [[xs[k], xs[k + 1]]];
      for (const c of cut) {
        if (z + STEP <= c.z0 || z >= c.z1) continue;
        spans = spans.flatMap(([a, b]) => (b <= c.x0 || a >= c.x1 ? [[a, b]] : [[a, Math.min(b, c.x0)], [Math.max(a, c.x1), b]]).filter(([p, q]) => q - p > 0.1));
      }
      for (const [a, b] of spans) {
        // clip the band's corners back inside the lake
        const ok = (x) => inPoly(shore, x, z) && inPoly(shore, x, z + STEP);
        let a2 = a, b2 = b;
        while (a2 < b2 && !ok(a2)) a2 += 0.4;
        while (b2 > a2 && !ok(b2)) b2 -= 0.4;
        if (b2 - a2 > 0.2) kit.walkBox(a2, b2, z, z + STEP, 40, { noSeat: true });
      }
    }
  }

  // ---------- the loop path, with spurs to the sidewalks ----------
  const path = ring(9, 72), PW = 2.6;
  const pave = (x0, z0, x1, z1, w = PW) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    ctx.markB.add((x0 + x1) / 2, 0.006, (z0 + z1) / 2, L + w * 0.5, 1, w, 0xb7b0a4, Math.atan2(-(z1 - z0), x1 - x0));
  };
  for (let i = 0; i < path.length; i++) {
    const [x0, z0] = path[i], [x1, z1] = path[(i + 1) % path.length];
    pave(x0, z0, x1, z1);
  }
  const pathAt = (a) => { const r = rad(a) + 9; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
  { const [x, z] = pathAt(0); pave(x, z, I.x1 + 0.5, z); pave(shoreE, cz, x, z, 3); }
  { const [x, z] = pathAt(-Math.PI / 2); pave(x, z, x, I.z0 - 0.5); }
  { const [x, z] = pathAt(-Math.PI / 4); pave(x, z, I.x1 + 0.5, I.z0 - 0.5); }

  // ---------- benches, lamps, picnic tables, trees ----------
  const globe = batch('lkGlobe', SPHERE, M.lamp, { cast: false });
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + 0.17;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.2) continue; // the pier's spur
    const r = rad(a) + 9 - PW / 2 - 0.55;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // bench on the lake side of the path, facing the water
    if (k % 2 === 0) { const yaw = Math.atan2(cx - x, cz - z); const s = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); ctx.bench(x, z, s, 0); }
    else {
      const lr = rad(a) + 9 + PW / 2 + 0.6, lx = cx + Math.cos(a) * lr, lz = cz + Math.sin(a) * lr;
      B.metalC.add(lx, 1.8, lz, 0.14, 3.6, 0.14, 0x2b2f33);
      B.metalC.add(lx, 0.2, lz, 0.3, 0.4, 0.3, 0x2b2f33);
      globe.add(lx, 3.85, lz, 0.5, 0.5, 0.5);
      ctx.solidCyl(lx, lz, 0.1, 3.6);
      ctx.claim(lx, lz, 0.5);
    }
  }
  const picnic = (x, z, yaw) => {
    const F = new Frame(kit, x, z, yaw, 0);
    F.put(B.wood, 0, 0.74, 0, 0.8, 0.06, 1.9, 0x8a6a4a);
    for (const s of [-1, 1]) {
      F.put(B.wood, s * 0.7, 0.44, 0, 0.3, 0.05, 1.9, 0x8a6a4a);
      F.put(B.wood, s * 0.3, 0.36, -0.75, 0.08, 0.75, 0.08, 0x6b5238, s * 0.5);
      F.put(B.wood, s * 0.3, 0.36, 0.75, 0.08, 0.75, 0.08, 0x6b5238, s * 0.5);
      F.walk(s * 0.7 - 0.15, s * 0.7 + 0.15, -0.95, 0.95, 0.46);
      F.phys(s * 0.7 - 0.15, s * 0.7 + 0.15, 0.4, 0.46, -0.95, 0.95);
    }
    F.walk(-0.4, 0.4, -0.95, 0.95, 0.77, { noSeat: true });
    F.phys(-0.4, 0.4, 0.71, 0.77, -0.95, 0.95);
    ctx.claim(x, z, 1.6);
  };
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI * 0.35 + k * 0.28, r = rad(a) + 15;
    picnic(cx + Math.cos(a) * r, cz + Math.sin(a) * r, k % 2 ? 0 : Math.PI / 2);
  }
  // trees: everywhere outside the path, thicker toward the back walls
  for (let k = 0; k < 150; k++) {
    const x = R.range(I.x0 + 3, I.x1 - 3), z = R.range(I.z0 + 3, I.z1 - 3);
    const a = Math.atan2(z - cz, x - cx), d = Math.hypot(x - cx, z - cz);
    if (d < rad(a) + 12.5) continue;
    if (ctx.free(x, z, 3)) ctx.tree(x, z, 0, R.range(1.1, 1.7));
  }

  // ---------- boathouse by the pier ----------
  {
    const bx = shoreE + 5, bz = cz - 9;
    const F = new Frame(kit, bx, bz, -Math.PI / 2, 0); // doors toward the water (-x)
    const d = 7, w = 6, h = 3.2;
    F.put(X.siding, 0, h / 2, 0, d, h, w, 0x8a3a2a);
    gable(F, X, 0, 0, d, w, h, 2, 0x8a3a2a, 0x3e4448);
    F.put(ctx.B.trim, d / 2 + 0.03, 1.3, 0, 0.06, 2.6, 3.4, 0xf4f1ea);
    F.put(ctx.B.wood, d / 2 + 0.07, 1.25, 0, 0.04, 2.5, 3.2, 0x5a3a24);
    F.put(ctx.B.plain, d / 2 + 0.08, 3.9, 0, 0.05, 0.5, 2.4, 0xf4f1ea);
    F.walk(-d / 2, d / 2, -w / 2, w / 2, h + 2);
    F.phys(-d / 2, d / 2, 0, h + 2, -w / 2, w / 2, { cam: true });
    ctx.claim(bx, bz, 5);
  }

  // ---------- reeds and lily pads ----------
  for (let k = 0; k < 14; k++) {
    const a = R() * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.35) continue;
    const r = rad(a) - 0.6;
    const x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r;
    for (let n = 0; n < 16; n++) {
      const x = x0 + R.range(-1.4, 1.4), z = z0 + R.range(-1.4, 1.4), h = R.range(0.9, 1.8);
      B.plain.add(x, h / 2, z, 0.04, h, 0.04, R.pick([0x6b7a3a, 0x7d8a45, 0x8a7a48]), R() * 3, R.range(-0.15, 0.15));
      if (n % 5 === 0) B.bark.add(x, h + 0.1, z, 0.07, 0.24, 0.07, 0x5a3a24);
    }
  }
  for (let k = 0; k < 40; k++) {
    const a = R() * Math.PI * 2, r = rad(a) * R.range(0.55, 0.9);
    X.disc.add(cx + Math.cos(a) * r, 0.03, cz + Math.sin(a) * r, R.range(0.4, 0.8), 0.01, R.range(0.4, 0.8), R.pick([0x3f6a2e, 0x4d7a36, 0x5a8a3e]));
  }

  // ---------- things that move: rowboats at the pier, ducks ----------
  const hullM = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const inM = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
  const boatG = new THREE.BoxGeometry(1, 1, 1);
  const boats = [];
  for (const [bx, bz, col, yaw] of [[head.x1 + 1.6, head.z1 + 1.8, 0x2a5a8a, 0.2], [pier.x0 + 6, pier.z0 - 1.9, 0xb0302a, -0.1], [pier.x0 + 10, pier.z1 + 1.9, 0xe8e4da, 0.05]]) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(boatG, hullM.clone()); hull.material.color.set(col);
    hull.scale.set(3.4, 0.45, 1.3); hull.position.y = 0.1;
    const bow = new THREE.Mesh(boatG, hull.material); bow.scale.set(0.9, 0.45, 0.92); bow.position.set(1.95, 0.12, 0); bow.rotation.y = Math.PI / 4;
    const floor = new THREE.Mesh(boatG, inM); floor.scale.set(3.1, 0.05, 1.05); floor.position.y = 0.3;
    const seat = new THREE.Mesh(boatG, inM); seat.scale.set(0.3, 0.05, 1.15); seat.position.set(0.3, 0.4, 0);
    g.add(hull, bow, floor, seat);
    for (const m of g.children) m.castShadow = m.receiveShadow = true;
    g.position.set(bx, 0, bz); g.rotation.y = yaw;
    scene.add(g);
    boats.push({ g, ph: R() * 6, yaw });
  }
  const duckBody = new THREE.SphereGeometry(0.5, 10, 8), duckM = [0x6a5038, 0xece9e0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const headM = new THREE.MeshStandardMaterial({ color: 0x1f5a3a, roughness: 0.5 }), beakM = new THREE.MeshStandardMaterial({ color: 0xe0902a, roughness: 0.6 });
  const ducks = [];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.Group();
    const white = k % 3 === 0;
    const b = new THREE.Mesh(duckBody, duckM[white ? 1 : 0]); b.scale.set(0.32, 0.2, 0.2); b.position.y = 0.08;
    const h = new THREE.Mesh(duckBody, white ? duckM[1] : headM); h.scale.set(0.12, 0.12, 0.12); h.position.set(0.14, 0.24, 0);
    const bk = new THREE.Mesh(boatG, beakM); bk.scale.set(0.08, 0.025, 0.05); bk.position.set(0.22, 0.23, 0);
    g.add(b, h, bk);
    b.castShadow = true;
    scene.add(g);
    ducks.push({ g, r: r0 * R.range(0.25, 0.6), a: R() * 6.28, w: R.range(0.04, 0.08) * (R() < 0.5 ? 1 : -1), ph: R() * 6 });
  }
  let t = 0;
  ctx.onUpdate((dt) => {
    t += dt;
    for (const b of boats) {
      b.g.position.y = Math.sin(t * 1.3 + b.ph) * 0.03 - 0.02;
      b.g.rotation.set(Math.sin(t * 1.1 + b.ph) * 0.03, b.yaw + Math.sin(t * 0.3 + b.ph) * 0.05, Math.sin(t * 0.9 + b.ph * 2) * 0.025);
    }
    for (const d of ducks) {
      d.a += d.w * dt;
      const r = d.r * (1 + 0.15 * Math.sin(t * 0.2 + d.ph));
      d.g.position.set(cx + Math.cos(d.a) * r, 0.02 + Math.sin(t * 2 + d.ph) * 0.01, cz + Math.sin(d.a) * r);
      d.g.rotation.y = -d.a - (d.w > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  });
}
