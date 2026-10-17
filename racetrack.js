import * as THREE from 'three';
import { Colliders, addSky } from './world.js';

/*
  The racetrack: a closed loop of asphalt over grass, red/white kerbs, tyre-stack barriers either
  side (physics cylinders: cars bounce off them), a start/finish line with a gantry over it, and
  two cars waiting on the grid.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const W = 13;          // track width
const KERB = 1.1;      // kerb width, each side
const N = 480;         // samples round the loop
const GROUND = 520;

// the loop's control points (x, z), driven anticlockwise from the start straight
const PTS = [
  [0, 90], [-60, 92], [-118, 78], [-148, 30], [-140, -28], [-104, -50], [-70, -30], [-40, -2],
  [-6, -8], [18, -48], [40, -100], [86, -120], [134, -96], [150, -40], [128, 14], [118, 58], [80, 88],
];

function stripes(n, a, b) {
  const c = document.createElement('canvas');
  c.width = 64 * n; c.height = 8;
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 64, 0, 64, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function asphaltTex() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#3d3f43'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const v = 50 + Math.random() * 40 | 0;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A ribbon between offsets o0 and o1 from the centre line; u runs along it (one repeat per uLen m). */
function ribbon(pts, nrm, o0, o1, y, uLen) {
  const pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i <= pts.length; i++) {
    const k = i % pts.length, p = pts[k], n = nrm[k];
    if (i) u += pts[k].distanceTo(pts[i - 1]) / uLen;
    pos.push(p.x + n.x * o0, y, p.z + n.z * o0, p.x + n.x * o1, y, p.z + n.z * o1);
    uv.push(u, 0, u, 1);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (wound either way round depending on the side: always face up)
  const nm = g.attributes.normal;
  if (nm.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

const flat = (color, off = -1) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off });

export function buildRacetrack(scene, renderer) {
  const sun = addSky(scene, { sky: 0x9cc3e4, fogNear: 120, fogFar: 300, hemi: 1.35, sunI: 2.8, span: 34 });
  const colliders = new Colliders();
  const curve = new THREE.CatmullRomCurve3(PTS.map(([x, z]) => V(x, 0, z)), true, 'centripetal');
  const pts = curve.getSpacedPoints(N).slice(0, N);
  const tan = pts.map((_, i) => pts[(i + 1) % N].clone().sub(pts[(i + N - 1) % N]).normalize());
  const nrm = tan.map((t) => V(-t.z, 0, t.x)); // (left of the direction of travel... or right: both sides are drawn)

  // grass: the whole ground, one walkable box
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5f8f48, roughness: 1 });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);
  colliders.boxes.push({ minX: -GROUND / 2, maxX: GROUND / 2, minZ: -GROUND / 2, maxZ: GROUND / 2, top: 0 });

  // asphalt, white edge lines, kerbs
  const at = asphaltTex(); at.repeat.set(1, 1);
  const asphalt = new THREE.Mesh(ribbon(pts, nrm, -W / 2, W / 2, 0.01, 14), new THREE.MeshStandardMaterial({ map: at, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  asphalt.receiveShadow = true;
  scene.add(asphalt);
  const lineMat = flat(0xeeeeea, -2);
  for (const s of [-1, 1]) {
    const o = s * (W / 2 - 0.45);
    const line = new THREE.Mesh(ribbon(pts, nrm, o - 0.12, o + 0.12, 0.012, 10), lineMat);
    line.receiveShadow = true;
    scene.add(line);
    const kt = stripes(2, '#d8312a', '#f2f2ee');
    const kerb = new THREE.Mesh(ribbon(pts, nrm, s * W / 2, s * (W / 2 + KERB), 0.03, 4),
      new THREE.MeshStandardMaterial({ map: kt, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    kerb.receiveShadow = true;
    scene.add(kerb);
  }

  // start / finish: a chequered band across the track
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f0'; g.fillRect(i * 16, j * 16, 16, 16); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.6), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    band.rotation.x = -Math.PI / 2;
    // (the band's width across the track: its local x laid along the normal)
    band.rotation.z = Math.atan2(-nrm[0].z, nrm[0].x);
    band.position.copy(pts[0]).setY(0.014);
    band.receiveShadow = true;
    scene.add(band);
  }

  // the gantry over the line: two posts and a beam with the chequered banner
  {
    const p = pts[0], n = nrm[0], yaw = Math.atan2(n.x, n.z);
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.5, metalness: 0.4 });
    for (const s of [-1, 1]) {
      const x = p.x + n.x * s * (W / 2 + 2.4), z = p.z + n.z * s * (W / 2 + 2.4);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
      post.position.set(x, 3.5, z);
      post.castShadow = true;
      scene.add(post);
      colliders.solids.push({ type: 'box', x, y: 3.5, z, w: 0.5, h: 7, d: 0.5 });
    }
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#c8202a'; g.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) { g.fillStyle = '#fff'; g.fillRect(i * 16, j * 16, 16, 16); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 5.3, 1.2, 0.4), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: t }), new THREE.MeshStandardMaterial({ map: t })]);
    beam.position.set(p.x, 6.6, p.z);
    beam.rotation.y = yaw + Math.PI / 2;
    beam.castShadow = true;
    scene.add(beam);
  }

  // tyre stacks along both sides, wherever there's room (not over the track elsewhere on the loop)
  const near = (x, z, r) => {
    for (const p of pts) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true;
    return false;
  };
  const spots = [];
  const OFF = W / 2 + KERB + 2.2, gantryClear = 4;
  for (let i = 0; i < N; i++) {
    if (pts[i].distanceTo(pts[0]) < gantryClear) continue;
    for (const s of [-1, 1]) {
      const x = pts[i].x + nrm[i].x * s * OFF, z = pts[i].z + nrm[i].z * s * OFF;
      if (near(x, z, OFF - 0.3)) continue;
      if (spots.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 1.4 * 1.4)) continue;
      spots.push({ x, z, k: spots.length });
    }
  }
  const tyreGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 14);
  const tyres = new THREE.InstancedMesh(tyreGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), spots.length);
  const m4 = new THREE.Matrix4(), black = new THREE.Color(0x1d1d20), red = new THREE.Color(0xc23a2e), white = new THREE.Color(0xe8e8e2);
  spots.forEach((s, i) => {
    m4.makeTranslation(s.x, 0.45, s.z);
    tyres.setMatrixAt(i, m4);
    tyres.setColorAt(i, i % 6 === 0 ? red : i % 6 === 3 ? white : black);
    colliders.solids.push({ type: 'cyl', x: s.x, y: 0.45, z: s.z, r: 0.45, h: 0.9 });
  });
  tyres.castShadow = tyres.receiveShadow = true;
  scene.add(tyres);

  // a grandstand facing the start straight, outside the loop
  {
    const p = pts[Math.floor(N * 0.03)], n = nrm[Math.floor(N * 0.03)];
    const out = near(p.x + n.x * 20, p.z + n.z * 20, 15) ? -1 : 1;
    const cx = p.x + n.x * out * (W / 2 + 12), cz = p.z + n.z * out * (W / 2 + 12);
    const yaw = Math.atan2(n.x * out, n.z * out);
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = yaw;
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa7a59e, roughness: 0.9 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2c5f9e, roughness: 0.7 });
    for (let r = 0; r < 6; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8 * (r + 1), 1.4), r % 2 ? seat : concrete);
      step.position.set(0, 0.4 * (r + 1), r * 1.4);
      step.castShadow = step.receiveShadow = true;
      g.add(step);
    }
    const roofM = new THREE.Mesh(new THREE.BoxGeometry(31, 0.3, 9), new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.6 }));
    roofM.position.set(0, 7.6, 3.4);
    roofM.castShadow = true;
    g.add(roofM);
    scene.add(g);
    // (solid as one block, in world axes: its bounding box)
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    colliders.solids.push({ type: 'box', x: (bb.min.x + bb.max.x) / 2, y: 2.4, z: (bb.min.z + bb.max.z) / 2, w: bb.max.x - bb.min.x, h: 4.8, d: bb.max.z - bb.min.z });
  }

  // asphalt or grass underfoot: a coarse grid of "on the track"
  const CELL = 2, GN = Math.ceil(GROUND / CELL), onTrack = new Uint8Array(GN * GN);
  for (let gx = 0; gx < GN; gx++) for (let gz = 0; gz < GN; gz++) {
    const x = gx * CELL - GROUND / 2 + 1, z = gz * CELL - GROUND / 2 + 1;
    if (Math.abs(x) < 170 && Math.abs(z) < 145 && near(x, z, W / 2 + KERB)) onTrack[gx * GN + gz] = 1;
  }
  const surfaceAt = (x, z) => {
    const gx = Math.floor((x + GROUND / 2) / CELL), gz = Math.floor((z + GROUND / 2) / CELL);
    return gx >= 0 && gz >= 0 && gx < GN && gz < GN && onTrack[gx * GN + gz] ? 'asphalt' : 'grass';
  };

  // the grid: two cars behind the line, facing the way round
  const yaw0 = Math.atan2(tan[0].x, tan[0].z);
  const back = (d, side) => pts[0].clone().addScaledVector(tan[0], -d).addScaledVector(nrm[0], side);
  const parking = [
    { kind: 'sedan', color: 0xc8202a, p: back(8, -2.8) },
    { kind: 'hatch', color: 0x2a5bd7, p: back(15, 2.8) },
  ].map(({ kind, color, p }) => ({ kind, color, x: p.x, z: p.z, yaw: yaw0, interior: 0 }));
  // you: by the red car's driver's door (the car's left: +x in its frame)
  const left = V(Math.cos(yaw0), 0, -Math.sin(yaw0));
  const spawn = V(parking[0].x, 0, parking[0].z).addScaledVector(left, 2.2).addScaledVector(tan[0], -0.5);

  return {
    colliders, sun, seats: [], parking, table: { x: 10000, z: 10000, top: 0 }, surfaceAt,
    spawn, spawnYaw: yaw0 - Math.PI / 2, spawnR: 0.5, npcs: 0, soft: false,
  };
}
