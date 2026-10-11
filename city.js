import * as THREE from 'three';
import { Colliders, addSky, addTable, findSeats } from './world.js';
import {
  rng, asphaltTex, sidewalkTex, brickTex, stuccoTex, concreteTex, worldMat,
  Batch, Face, BOX, CYL, CYL_LO, SPHERE, CONE, PLANE, NEAR, FAR, anchorAt, anchorOff, anchored, lodMeshes, ditherFade,
} from './cityparts.js';
import { CityNav } from './citynav.js';
import * as P from './cityprops.js';
import { buildStore, buildClothes, buildStation } from './citystore.js';
import { SPECS } from './carmodel.js';
import { zoneTextures } from './zones/kit.js';
import { buildZones } from './zones/index.js';

const CAR_COLS = [0xb0302a, 0x2a4d8f, 0xdedede, 0x1d1d1f, 0x6d7278, 0x9aa3a8, 0x2e6b4a, 0xc9a13a, 0x7a2f55, 0xe5e1d6, 0x5a2a22, 0x3a4a5a];

/*
  Test level: one detailed, walkable city block (with a courtyard plaza cut into it) inside a
  3x3 grid of blocks. Streets with markings, crosswalks and working signals, raised
  sidewalks with street furniture, parked cars, and instanced buildings with windows,
  storefronts, awnings and fire escapes. Everything static is batched into InstancedMeshes.
*/

const CH = 0.15;       // curb height (walkable: below STEP)
const SW = 5;          // sidewalk width
const LANE = 2.6;      // walking line, from the curb
const FURN = 0.85;     // street furniture line, from the curb
const WORLD = 240;      // the boundary: streets dead-end against it
const XS = [[-WORLD, -111], [-100, -42], [-31, 31], [42, 100], [111, WORLD]];
const ZS = [[-WORLD, -111], [-100, -34], [-23, 23], [34, 100], [111, WORLD]];
const STREETS_X = [[-111, -100], [-42, -31], [31, 42], [100, 111]]; // streets running along z
const STREETS_Z = [[-111, -100], [-34, -23], [23, 34], [100, 111]]; // streets running along x
/*
  The 5x5 grid of blocks: the old downtown is the inner 3x3; round it run the ring roads and
  the outer districts - suburbs to the north and south, a lake park in the south-west corner,
  a newer midtown to the west and desert out east.
*/
function zoneOf(i, j) {
  if (i >= 1 && i <= 3 && j >= 1 && j <= 3) return 'downtown';
  if (i === 4) return 'desert';
  if (i === 0 && j === 4) return 'lake';
  if (i === 0 && (j === 1 || j === 2)) return 'midtown';
  return 'suburb';
}
const ACTIVE = { x: 66, z: 58 };          // where people walk and furniture is placed
const GROUND_H = 4.4, FLOOR_H = 3.2;

// the courtyard plaza cut into the centre block, and its opening onto the south street
const PLAZA = [{ x0: -14, x1: 14, z0: -6, z1: 6 }, { x0: -7, x1: 7, z0: 6, z1: 18 }];
// the gun store: the ground floor of one building on the plaza's north side, door onto the plaza
const STORE = { x0: -14, x1: -4, z0: -18, z1: -6 };
// the clothes store, its mirror image across the plaza
const CLOTHES = { x0: 4, x1: 14, z0: -18, z1: -6 };
// the police station: on the block's south street, beside the plaza's opening
const STATION = { x0: 7, x1: 19, z0: 6, z1: 18 };
const COP_CAR = { x: 13, z: 24.25, yaw: -Math.PI / 2 }; // parked at the curb out front

const SHOPS = [
  ['CAFE', '#2f4a3a', '#f3e6c8'], ['DELI', '#8a1f1f', '#fff4e0'], ['BOOKS', '#233a5e', '#f1e3b5'],
  ['PHARMACY', '#e8f1ec', '#1a7d4a'], ['PIZZA', '#1e1e1e', '#ffb13b'], ['LAUNDRY', '#3c7fb8', '#ffffff'],
  ['BAKERY', '#f6e3c5', '#7a3e1d'], ['HARDWARE', '#c83a22', '#ffffff'], ['FLOWERS', '#f5d8e4', '#8c2a55'],
  ['BAR', '#141414', '#e8c46a'], ['NOODLES', '#b5271f', '#ffe8a8'], ['BARBER', '#f2f2f2', '#22447a'],
];
/** One sign: text on bg in fg, into g at row y (512 x 96). */
function drawSign(g, y, text, bg, fg) {
  g.fillStyle = bg; g.fillRect(0, y, 512, 96);
  g.strokeStyle = fg; g.globalAlpha = 0.35; g.lineWidth = 4; g.strokeRect(8, y + 8, 496, 80); g.globalAlpha = 1;
  g.fillStyle = fg;
  g.font = `700 ${text.length > 7 ? 52 : 60}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, y + 52);
}
/**
 * All SHOPS signs stacked in one texture (128 px rows: the 96 px sign plus its background run
 * 16 px either side, so mipmaps don't bleed rows together) and a material that picks the row
 * from the instance colour's red byte, then draws untinted.
 */
const ROW = 128, PAD = 16;
function signAtlas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = ROW * SHOPS.length;
  const g = c.getContext('2d');
  SHOPS.forEach(([text, bg], i) => { g.fillStyle = bg; g.fillRect(0, i * ROW, 512, ROW); });
  SHOPS.forEach(([text, bg, fg], i) => drawSign(g, i * ROW + PAD, text, bg, fg));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.flipY = false; // row 0 at v = 0
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        float row_ = floor(instanceColor.r * 255.0 + 0.5);
        vMapUv = vec2(uv.x, (row_ * ${ROW}.0 + ${PAD}.0 + (1.0 - uv.y) * 96.0) / ${ROW * SHOPS.length}.0);
        vColor = vec3(1.0);
      #endif`);
  };
  m.customProgramCacheKey = () => 'signatlas';
  return m;
}
function signTex(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  drawSign(c.getContext('2d'), 0, text, bg, fg);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; // shop signs are seen fairly square-on
  return t;
}

/** A small sky dome rendered into a prefiltered environment map, for glass and car paint. */
function skyEnv(renderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const p = geo.attributes.position;
  const top = new THREE.Color(0x7fa6d0), hor = new THREE.Color(0xe4ecf2), gnd = new THREE.Color(0x3a3833);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(gnd, Math.min(1, -y * 4));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}

export function buildCity(scene, renderer) {
  const R = rng(1337);
  const sun = addSky(scene, { sky: 0xb4c8da, fogNear: 50, fogFar: 175, hemi: 1.15, sunI: 2.8, span: 24, far: 68 });
  // Shadow depth fitted to the sun (offset 22, 40, 15 -> 48 m out, 56 deg up): the 48 m square
  // box's top edge sits at y = 53 - 0.83 d along the ray, so past d = 64 the whole slice is
  // underground. Casters beyond that are culled from the shadow pass (far was 140).
  const env = skyEnv(renderer);
  const colliders = new Colliders();
  // GPU ceiling only: each texture asks for what its surface needs (8 ground, 4 walls)
  const aniso = renderer.capabilities.getMaxAnisotropy();

  // ---------- materials ----------
  const asphalt = asphaltTex(); asphalt.anisotropy = Math.min(8, aniso);
  const stuccoT = stuccoTex(), concreteT = concreteTex(); // each shared by two materials
  const ZT = zoneTextures(aniso);
  const M = {
    sidewalk: worldMat({ map: sidewalkTex(), roughness: 0.92 }, 1 / 3),
    curb: worldMat({ map: concreteT, color: 0xb0aca4, roughness: 0.85 }, 1 / 2),
    brick: worldMat({ map: brickTex(), roughness: 0.9 }, 1 / 2),
    stucco: worldMat({ map: stuccoT, roughness: 0.95 }, 1 / 2),
    concrete: worldMat({ map: concreteT, roughness: 0.85 }, 1 / 3),
    trim: worldMat({ map: stuccoT, roughness: 0.8 }, 1 / 2),
    glass: new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0.85, envMap: env, envMapIntensity: 1.1 }),
    frame: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.5, metalness: 0.55, envMap: env, envMapIntensity: 0.5 }),
    fabric: new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5d3a, roughness: 0.7 }),
    bark: new THREE.MeshStandardMaterial({ color: 0x4d3b2c, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
    paint: new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.5, envMap: env, envMapIntensity: 0.9 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 }),
    plain: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff0cc, emissiveIntensity: 0.6 }),
    mark: new THREE.MeshStandardMaterial({ roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8c1010, emissive: 0x5a0000, emissiveIntensity: 0.5, roughness: 0.3 }),
    caseGlass: new THREE.MeshStandardMaterial({ color: 0xcfe4ee, roughness: 0.05, metalness: 0.1, envMap: env, envMapIntensity: 0.6, transparent: true, opacity: 0.16, depthWrite: false }),
    water: new THREE.MeshStandardMaterial({ color: 0x5f8fa8, roughness: 0.05, metalness: 0.3, envMap: env, transparent: true, opacity: 0.85 }),
  };
  const B = {};
  const batch = (name, geo, mat, o) => (B[name] ||= new Batch(geo, mat, o));
  const box = (name, mat, o) => batch(name, BOX, M[mat], o);
  const sidewalkB = box('sidewalk', 'sidewalk'), curbB = box('curb', 'curb');
  const brickB = box('brick', 'brick'), stuccoB = box('stucco', 'stucco'), concB = box('conc', 'concrete');
  // glass and frames sit flush on walls: they never cast into the sun's shadow map. Frames,
  // mullions and the detail twins below are near-LOD only: past LOD_FAR a facade is its wall,
  // its glass and its cornices (cityparts.js)
  const NC = { cast: false, lod: NEAR };
  const trimB = box('trim', 'trim'), glassB = box('glass', 'glass', { cast: false }), frameB = box('frame', 'frame', NC);
  // office curtain walls: one pane per bay up close, one band per floor run far off
  const glassNear = box('glassNear', 'glass', NC), glassFar = box('glassFar', 'glass', { cast: false, lod: FAR });
  // detail twins (same materials, no shadow): sills, lintels, flush bands, thin rails and wires
  B.trimD = new Batch(BOX, M.trim, NC); B.metalD = new Batch(BOX, M.metal, NC);
  B.paintD = new Batch(BOX, M.paint, NC); B.plainD = new Batch(BOX, M.plain, NC); B.woodD = new Batch(BOX, M.wood, NC);
  const trimD = B.trimD, metalD = B.metalD, plainD = B.plainD;
  const metalB = box('metal', 'metal'), fabricB = box('fabric', 'fabric'), woodB = box('wood', 'wood');
  const plainB = box('plain', 'plain'), paintB = box('paint', 'paint');
  const metalC = batch('metalC', CYL, M.metal), plainC = batch('plainC', CYL, M.plain), barkC = batch('bark', CYL_LO, M.bark);
  const lampB = box('lamp', 'lamp', { cast: false });
  // foliage: up close a canopy is a few 80-tri spheres (casting); past LOD_FAR it is one 20-tri
  // blob that casts nothing (the sun's 48 m shadow square never reaches that far anyway).
  // Shrubs are too low to throw a shadow worth drawing: never cast, near or far.
  const BLOB = new THREE.IcosahedronGeometry(0.5, 0);
  // the two levels cross-dissolve over LOD_FAR +- FADE (ditherFade) instead of popping
  const leafNear = ditherFade(M.leaf, NEAR), leafFar = ditherFade(M.leaf, FAR);
  B.leaf = new Batch(SPHERE, leafNear, { lod: NEAR, fade: true });
  B.canopy = new Batch(BLOB, leafFar, { cast: false, lod: FAR, fade: true });
  B.shrubNear = new Batch(SPHERE, leafNear, { cast: false, lod: NEAR, fade: true });
  B.shrubFar = new Batch(BLOB, leafFar, { cast: false, lod: FAR, fade: true });
  /** Leaf clusters [x, y, z, sx, sy, sz, colour, yaw]: near spheres, or one far blob round them all. */
  function canopy(parts, shrub = false) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, y, z, sx, sy, sz] of parts) {
      x0 = Math.min(x0, x - sx / 2); x1 = Math.max(x1, x + sx / 2);
      y0 = Math.min(y0, y - sy / 2); y1 = Math.max(y1, y + sy / 2);
      z0 = Math.min(z0, z - sz / 2); z1 = Math.max(z1, z + sz / 2);
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    anchored(cx, cz, () => {
      const near = shrub ? B.shrubNear : B.leaf, far = shrub ? B.shrubFar : B.canopy;
      for (const p of parts) near.add(...p);
      // the blob is a little inside the cluster's box: spheres don't fill their box's corners
      const k = parts.length > 1 ? 0.88 : 1;
      far.add(cx, (y0 + y1) / 2, cz, (x1 - x0) * k, (y1 - y0) * k, (z1 - z0) * k, parts[0][6], parts[0][7] || 0);
    });
  }
  const markB = batch('mark', PLANE, M.mark, { cast: false }), trimC = batch('trimC', CYL, M.trim);

  // ---------- collision ----------
  const solidBox = (x0, x1, z0, z1, y0, top, extra = {}) => {
    colliders.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top, surface: extra.surface || 'concrete', ...extra });
    const h = top - y0;
    colliders.solids.push({ type: 'box', x: (x0 + x1) / 2, y: y0 + h / 2, z: (z0 + z1) / 2, w: x1 - x0, h, d: z1 - z0, cam: !!extra.cam });
  };
  const solidCyl = (x, z, r, top) => {
    colliders.circles.push({ x, z, r, top });
    colliders.solids.push({ type: 'cyl', x, y: top / 2, z, r, h: top });
  };

  // ---------- blocks ----------
  const N = XS.length;
  const allBlocks = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [x0, x1] = XS[i], [z0, z1] = ZS[j];
    const zone = zoneOf(i, j), walk = zone !== 'desert';
    const st = { xm: i > 0, xp: i < N - 1, zm: j > 0, zp: j < N - 1 }; // which sides face a street
    const sw = walk ? SW : 0;
    const inner = {
      x0: x0 + (st.xm ? sw : 0), x1: x1 - (st.xp ? sw : 0),
      z0: z0 + (st.zm ? sw : 0), z1: z1 - (st.zp ? sw : 0),
    };
    allBlocks.push({ i, j, x0, x1, z0, z1, st, inner, zone, walk, centre: i === 2 && j === 2 });
  }
  const blocks = allBlocks.filter((b) => b.zone === 'downtown');

  // ---------- ground: asphalt streets, grass and sand under the outer districts ----------
  {
    const G = WORLD + 180;
    const rects = [];
    for (const b of allBlocks) {
      if (b.zone === 'suburb' || b.zone === 'lake') rects.push({ ...b, t: 'grass' });
      else if (b.zone === 'desert') rects.push({ ...b, t: 'sand' });
    }
    // past the boundary: desert out east, fields everywhere else
    rects.push({ x0: WORLD, x1: G, z0: -G, z1: G, t: 'sand' });
    rects.push({ x0: XS[4][0], x1: WORLD, z0: -G, z1: -WORLD, t: 'sand' }, { x0: XS[4][0], x1: WORLD, z0: WORLD, z1: G, t: 'sand' });
    rects.push({ x0: -G, x1: G, z0: -G, z1: G, t: 'field' });
    const inRect = (x, z) => rects.find((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
    const cutsX = [...new Set(rects.flatMap((r) => [r.x0, r.x1]).concat([-WORLD, WORLD]))].sort((a, b) => a - b);
    const cutsZ = [...new Set(rects.flatMap((r) => [r.z0, r.z1]).concat([-WORLD, WORLD]))].sort((a, b) => a - b);
    const inWorld = (x, z) => Math.abs(x) < WORLD && Math.abs(z) < WORLD;
    const ground = {
      asphalt: batch('gAsphalt', PLANE, worldMat({ map: asphalt, roughness: 0.95 }, 1 / 4), { cast: false }),
      grass: batch('gGrass', PLANE, worldMat({ map: ZT.grass, roughness: 1 }, 1 / 4), { cast: false }),
      sand: batch('gSand', PLANE, worldMat({ map: ZT.sand, roughness: 1 }, 1 / 5), { cast: false }),
    };
    for (let a = 0; a < cutsX.length - 1; a++) for (let c = 0; c < cutsZ.length - 1; c++) {
      const x0 = cutsX[a], x1 = cutsX[a + 1], z0 = cutsZ[c], z1 = cutsZ[c + 1];
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      let t = inRect(cx, cz)?.t || 'asphalt';
      if (t === 'field') t = inWorld(cx, cz) ? 'asphalt' : 'grass';
      ground[t].add(cx, 0, cz, x1 - x0, 1, z1 - z0, t === 'grass' ? 0xffffff : 0xffffff);
    }
  }
  const inAny = (list, x, z, m = 0) => list.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
  const inPlaza = (x, z) => inAny(PLAZA, x, z);
  const active = (x, z) => Math.abs(x) < ACTIVE.x && Math.abs(z) < ACTIVE.z;

  // sidewalk slabs, cut into pieces of at most 16 m (blood decal resolution)
  const slab = (x0, x1, z0, z1) => {
    const nx = Math.ceil((x1 - x0) / 16), nz = Math.ceil((z1 - z0) / 16);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const ax = x0 + (x1 - x0) * a / nx, bx = x0 + (x1 - x0) * (a + 1) / nx;
      const az = z0 + (z1 - z0) * b / nz, bz = z0 + (z1 - z0) * (b + 1) / nz;
      sidewalkB.add((ax + bx) / 2, CH / 2, (az + bz) / 2, bx - ax, CH, bz - az);
      solidBox(ax, bx, az, bz, 0, CH, { surface: 'concrete' });
    }
  };
  // the curb stone: a granite band along the street edge
  const curbAlong = (x0, x1, z0, z1) => curbB.add((x0 + x1) / 2, CH / 2 + 0.004, (z0 + z1) / 2, x1 - x0, CH + 0.008, z1 - z0);
  // (the curb stands 1 cm proud of the slab's street face so the two faces never coincide)
  // every street-facing edge of every block: { axis the edge runs along, curb coord, n = sign toward the block, extent }
  const edges = [];
  for (const b of allBlocks) {
    if (!b.walk) continue;
    const { st, x0, x1, z0, z1 } = b;
    const za = st.zm ? z0 + SW : z0, zb = st.zp ? z1 - SW : z1;
    if (st.zm) { slab(x0, x1, z0, z0 + SW); curbAlong(x0, x1, z0 - 0.01, z0 + 0.3); edges.push({ b, along: 'x', c: z0, n: 1, a0: x0, a1: x1 }); }
    if (st.zp) { slab(x0, x1, z1 - SW, z1); curbAlong(x0, x1, z1 - 0.3, z1 + 0.01); edges.push({ b, along: 'x', c: z1, n: -1, a0: x0, a1: x1 }); }
    if (st.xm) { slab(x0, x0 + SW, za, zb); curbAlong(x0 - 0.01, x0 + 0.3, st.zm ? z0 + 0.3 : za, st.zp ? z1 - 0.3 : zb); edges.push({ b, along: 'z', c: x0, n: 1, a0: z0, a1: z1 }); }
    if (st.xp) { slab(x1 - SW, x1, za, zb); curbAlong(x1 - 0.3, x1 + 0.01, st.zm ? z0 + 0.3 : za, st.zp ? z1 - 0.3 : zb); edges.push({ b, along: 'z', c: x1, n: -1, a0: z0, a1: z1 }); }
  }
  // plaza paving
  slab(-14, 14, -6, 6);
  slab(-7, 7, 6, 18);
  // edge helpers: a point `d` in from the curb, at `a` along it
  const edgePt = (e, a, d) => e.along === 'x' ? [a, e.c + e.n * d] : [e.c + e.n * d, a];
  const edgeYaw = (e) => e.along === 'x' ? (e.n > 0 ? 0 : Math.PI) : (e.n > 0 ? Math.PI / 2 : -Math.PI / 2); // facing the block

  // ---------- buildings ----------
  const buildings = [];
  const shopSpots = [];
  let store = null, clothes = null, station = null;
  const PAL = {
    brick: [0xa4523f, 0x8f4535, 0xb56a4c, 0x7d3f33, 0x9b5a45, 0xc08060],
    stucco: [0xe8dcc4, 0xd9c7a3, 0xcfd6d0, 0xe7cfc0, 0xc9b99a, 0xdfe3e6, 0xb9c4c9],
    office: [0xa9adb2, 0x8e949b, 0xc4c1ba],
  };
  function rowOf(x0, x1, z0, z1, alongX, front, opts) {
    // split the strip into buildings of 7-15 m frontage
    const L = alongX ? x1 - x0 : z1 - z0;
    let a = 0;
    while (a < L - 0.01) {
      let w = R.range(7, 15);
      if (L - a - w < 6) w = L - a;
      const s = a, e = a + w;
      a = e;
      const b = alongX ? { x0: x0 + s, x1: x0 + e, z0, z1 } : { x0, x1, z0: z0 + s, z1: z0 + e };
      const style = opts.office && R() < 0.45 ? 'office' : R() < 0.5 ? 'brick' : 'stucco';
      const [h0, h1] = opts.h;
      const floors = Math.max(2, Math.round((R.range(h0, h1) - GROUND_H) / FLOOR_H));
      buildings.push({ ...b, style, h: GROUND_H + floors * FLOOR_H + 0.6, floors, color: R.pick(PAL[style]), front, shops: opts.shops });
    }
  }
  for (const b of blocks) {
    const I = b.inner, D = b.centre ? 12 : 14;
    const opts = b.centre ? { h: [9, 22], shops: true, office: false } : { h: [13, 38], shops: true, office: true };
    const hasN = b.st.zm, hasS = b.st.zp;
    if (b.centre) {
      rowOf(I.x0, STORE.x0, I.z0, I.z0 + D, true, 'zm', opts);
      buildings.push({ ...STORE, style: 'brick', floors: 2, h: GROUND_H + 2 * FLOOR_H + 0.6, color: 0x7d3f33, front: 'zp', shops: false, store: true });
      rowOf(STORE.x1, CLOTHES.x0, I.z0, I.z0 + D, true, 'zm', opts);
      buildings.push({ ...CLOTHES, style: 'stucco', floors: 2, h: GROUND_H + 2 * FLOOR_H + 0.6, color: 0xe7cfc0, front: 'zp', shops: false, store: 'clothes' });
      rowOf(CLOTHES.x1, I.x1, I.z0, I.z0 + D, true, 'zm', opts);
      rowOf(I.x0, -7, I.z1 - D, I.z1, true, 'zp', opts);
      buildings.push({ ...STATION, style: 'stucco', floors: 2, h: GROUND_H + 2 * FLOOR_H + 0.6, color: 0xc9cfd6, front: 'zp', shops: false, store: 'police' });
      rowOf(STATION.x1, I.x1, I.z1 - D, I.z1, true, 'zp', opts);
      rowOf(I.x0, I.x0 + D, I.z0 + D, I.z1 - D, false, 'xm', opts);
      rowOf(I.x1 - D, I.x1, I.z0 + D, I.z1 - D, false, 'xp', opts);
      continue;
    }
    if (hasN) rowOf(I.x0, I.x1, I.z0, I.z0 + D, true, 'zm', opts);
    if (hasS) rowOf(I.x0, I.x1, I.z1 - D, I.z1, true, 'zp', opts);
    const za = hasN ? I.z0 + D : I.z0, zb = hasS ? I.z1 - D : I.z1;
    if (b.st.xm) rowOf(I.x0, I.x0 + D, za, zb, false, 'xm', opts);
    if (b.st.xp) rowOf(I.x1 - D, I.x1, za, zb, false, 'xp', opts);
  }
  const innerRects = blocks.map((b) => b.inner);
  const inBuilding = (x, z, m = 0) => buildings.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
  // can you see this spot on the wall from the street? (not buried in a neighbour, not facing a hidden back yard)
  const open = (x, z) => !inBuilding(x, z) && (!inAny(innerRects, x, z) || inPlaza(x, z)) && Math.abs(x) < WORLD && Math.abs(z) < WORLD;

  // every shop sign in one atlas and one batch (flush bands: no shadow); which sign an instance
  // shows rides in its instance colour's red channel (signAtlas)
  const signBatch = batch('signs', BOX, signAtlas(), { cast: false });
  const signB = SHOPS.map((_, i) => ({ add: (x, y, z, sx, sy, sz, c, ...rot) => signBatch.add(x, y, z, sx, sy, sz, new THREE.Color(i / 255, 1, 1), ...rot) }));
  const AWN = [0x2e6b4f, 0x9c2b2b, 0x1f3f6e, 0xd8a23a, 0x5b3a6e, 0x2a2a2a, 0xc75b2a, 0x3d7a8a];

  function facades(b) {
    const W = b.x1 - b.x0, D = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const faces = [
      [new Face(b.x1, cz, 1, 0, D), 'xp'], [new Face(b.x0, cz, -1, 0, D), 'xm'],
      [new Face(cx, b.z1, 0, 1, W), 'zp'], [new Face(cx, b.z0, 0, -1, W), 'zm'],
    ];
    const body = b.style === 'brick' ? brickB : b.style === 'stucco' ? stuccoB : concB;
    anchorAt(cx, cz); // all of this building's facade swaps LOD together
    if (b.store) {
      const K = {
        body, trim: trimB, glass: glassB, caseGlass: box('caseGlass', 'caseGlass', { cast: false }), frame: frameB, plain: plainB, wood: woodB, metal: metalB, lamp: lampB,
        solid: (x0, x1, z0, z1, y0, y1, extra) => solidBox(x0, x1, z0, z1, y0, y1, extra),
        phys: (x0, x1, z0, z1, y0, y1, extra = {}) => colliders.solids.push({ type: 'box', x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, cam: !!extra.cam }),
        scene, CH, signTex,
      };
      if (b.store === 'clothes') clothes = buildClothes(b, K);
      else if (b.store === 'police') station = buildStation(b, K);
      else store = buildStore(b, K);
    } else {
      body.add(cx, b.h / 2, cz, W, b.h, D, b.color);
      solidBox(b.x0, b.x1, b.z0, b.z1, 0, b.h, { cam: true });
    }
    // roof: cornice / parapet, a few machines
    const trimCol = b.style === 'brick' ? 0xd8cfc0 : b.style === 'office' ? 0x6f757c : 0xf1ebe0;
    // the cornice caps the whole roof (its top sits just above it) and overhangs the open sides; where
    // a neighbour is as tall or taller it stops flush at the shared wall instead of overlapping theirs
    const nb = (x, z) => buildings.find((o) => o !== b && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1);
    const sides = [[b.x1 + 0.3, cz], [b.x0 - 0.3, cz], [cx, b.z1 + 0.3], [cx, b.z0 - 0.3]].map(([x, z]) => nb(x, z));
    const ring = (y, hh, over, open) => {
      const [px, mx, pz, mz] = sides.map((n) => (open(n) ? over : 0));
      trimB.add(cx + (px - mx) / 2, y, cz + (pz - mz) / 2, W + px + mx, hh, D + pz + mz, trimCol);
    };
    ring(b.h - 0.2, 0.5, 0.15, (n) => !n || n.h < b.h - 0.01);
    if (b.style !== 'office') ring(GROUND_H - 0.1, 0.22, 0.06, (n) => !n);
    for (let k = R.int(1, 3); k > 0; k--) {
      const ax = R.range(b.x0 + 2, b.x1 - 2), az = R.range(b.z0 + 2, b.z1 - 2);
      plainB.add(ax, b.h + 0.5, az, R.range(1, 2), 0.9, R.range(1, 1.6), 0x9aa0a4);
    }
    if (b.style === 'brick' && b.h < 26 && R() < 0.35) {
      // water tower on stilts
      const tx = R.range(b.x0 + 3, b.x1 - 3), tz = R.range(b.z0 + 3, b.z1 - 3);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) metalB.add(tx + dx * 0.9, b.h + 1.2, tz + dz * 0.9, 0.1, 2.4, 0.1);
      batch('woodC', CYL_LO, M.wood).add(tx, b.h + 3.4, tz, 2.6, 2.4, 2.6);
      batch('cone', CONE, M.metal).add(tx, b.h + 5.1, tz, 2.8, 1, 2.8);
    }

    for (const [F, side] of faces) {
      const len = F.len;
      if (len < 3) continue;
      const vis = (u, out = 0.6) => { const [x, z] = F.point(u, out); return open(x, z); };
      if (![-0.45, -0.2, 0, 0.2, 0.45].some((k) => vis(k * len))) continue;
      // ---- upper floors ----
      if (b.style === 'office') {
        const bays = Math.max(1, Math.round(len / 1.6)), bw = len / bays;
        const shown = Array.from({ length: bays }, (_, i) => vis(-len / 2 + (i + 0.5) * bw));
        for (let f = 0; f < b.floors; f++) {
          const y = GROUND_H + f * FLOOR_H + 1.35;
          let run = -1; // far LOD: each unbroken run of visible bays is one glass band
          for (let i = 0; i <= bays; i++) {
            if (i < bays && shown[i]) {
              const u = -len / 2 + (i + 0.5) * bw;
              F.box(glassNear, u, y, 0.0, bw - 0.1, 2.2, 0.04, R() < 0.12 ? 0xd8cfae : R.pick([0x9fb2c2, 0x8fa4b6, 0xa9bac6]));
              F.box(frameB, u - bw / 2, y, 0.0, 0.08, 2.3, 0.1, 0x2d3238);
              if (run < 0) run = i;
            } else if (run >= 0) {
              const a = -len / 2 + run * bw, c = -len / 2 + i * bw;
              F.box(glassFar, (a + c) / 2, y, 0.0, c - a - 0.1, 2.2, 0.04, 0x98abbc);
              run = -1;
            }
          }
        }
      } else {
        const cols = Math.floor((len - 1) / 2.7);
        if (cols >= 1) {
          const sp = len / cols;
          const frameCol = b.style === 'brick' ? 0x2e2b28 : 0xf4f1ea;
          for (let f = 0; f < b.floors; f++) {
            const y0 = GROUND_H + f * FLOOR_H;
            for (let i = 0; i < cols; i++) {
              const u = -len / 2 + (i + 0.5) * sp;
              if (!vis(u)) continue;
              const y = y0 + 1.75;
              F.box(frameB, u, y, 0, 1.3, 1.85, 0.05, frameCol);
              const lit = R() < 0.1;
              F.box(glassB, u, y, 0.05, 1.14, 1.69, 0.02, lit ? 0xe6d2a0 : R.pick([0x7f92a2, 0x8a9cab, 0x6e8294]));
              F.box(frameB, u, y, 0.07, 1.14, 0.05, 0.02, frameCol); // transom bar
              F.box(trimD, u, y0 + 0.78, 0, 1.55, 0.1, 0.16, 0xe4ddd0);
              if (b.style === 'brick') F.box(trimD, u, y0 + 2.78, 0, 1.5, 0.18, 0.05, 0xd8cfc0);
            }
          }
          // fire escape on the front of some brick walk-ups
          if (b.style === 'brick' && side === b.front && b.floors >= 3 && cols >= 3 && R() < 0.55) {
            const fu = -len / 2 + (Math.floor(cols / 2) + 0.5) * sp;
            if (vis(fu)) for (let f = 0; f < b.floors; f++) {
              const y = GROUND_H + f * FLOOR_H + 0.02;
              F.box(metalB, fu, y, 0, 3.2, 0.06, 1.1, 0x303438);
              F.box(metalD, fu, y + 1, 1.06, 3.2, 0.04, 0.04, 0x303438);
              for (const k of [-1.58, 0, 1.58]) F.box(metalD, fu + k, y + 0.5, 1.06, 0.04, 1, 0.04, 0x303438);
              for (const k of [-1.58, 1.58]) F.box(metalD, fu + k, y + 1, 0, 0.04, 0.04, 1.1, 0x303438);
              if (f < b.floors - 1) F.box(metalB, fu, y + FLOOR_H / 2, 0.15, 3.6, 0.05, 0.5, 0x303438, 0, (f % 2 ? 1 : -1) * Math.atan2(FLOOR_H, 2.6));
            }
          }
        }
      }
      // ---- ground floor ----
      if ((!b.shops && side !== b.front) || b.store) continue;
      const bays = Math.max(1, Math.round(len / 6.5)), bw = len / bays;
      for (let i = 0; i < bays; i++) {
        const u = -len / 2 + (i + 0.5) * bw;
        if (!vis(u, 1)) continue;
        const [sx, sz] = F.point(u, 1);
        const sidewalkHere = !inBuilding(sx, sz) && active(sx, sz);
        const shop = b.shops && b.style !== 'office' && bw > 4;
        if (shop) {
          const s = R.int(0, SHOPS.length - 1);
          F.box(trimD, u, CH + 0.22, 0, bw - 0.5, 0.44, 0.12, 0xcfc8bb);
          const door = R() < 0.7, dw = 1.1, gw = bw - 0.9;
          // glass either side of the door
          const du = u + gw / 2 - 0.8 - dw / 2;
          const parts = door ? [[-gw / 2, du - u - dw / 2 - 0.05], [du - u + dw / 2 + 0.05, gw / 2]] : [[-gw / 2, gw / 2]];
          for (const [a, c] of parts) {
            if (c - a < 0.3) continue;
            F.box(glassB, u + (a + c) / 2, CH + 0.44 + 1.35, 0.02, c - a, 2.7, 0.03, R.pick([0x52606c, 0x5c6a74, 0x4c5a66]));
            F.box(frameB, u + a, CH + 0.44 + 1.35, 0, 0.08, 2.7, 0.09, 0x25282c);
            F.box(frameB, u + c, CH + 0.44 + 1.35, 0, 0.08, 2.7, 0.09, 0x25282c);
          }
          F.box(frameB, u, CH + 3.2, 0, gw, 0.1, 0.1, 0x25282c);
          if (door) {
            F.box(frameB, du, CH + 1.2, 0.0, dw, 2.4, 0.07, 0x26303a);
            F.box(glassB, du, CH + 1.45, 0.08, dw - 0.3, 1.5, 0.02, 0x9fb3c0);
          }
          // sign band + awning
          F.box(signB[s], u, 3.85, 0.02, Math.min(bw - 0.8, 5.2), 0.6, 0.08, 0xffffff);
          if (R() < 0.8) {
            const ang = 0.38, d = 1.5, y = 3.4 - Math.sin(ang) * d / 2;
            const col = AWN[(s + i) % AWN.length];
            F.box(fabricB, u, y, 0.02 - (1 - Math.cos(ang)) * d / 2, bw - 0.4, 0.04, d, col, ang);
            F.box(fabricB, u, 3.4 - Math.sin(ang) * d - 0.12, Math.cos(ang) * d - 0.01, bw - 0.4, 0.26, 0.02, col);
          }
          if (sidewalkHere) {
            // somewhere to stand and look in the window
            for (const [a, c] of parts) {
              if (c - a < 1.2) continue;
              const pu = u + (a + c) / 2;
              const [px, pz] = F.point(pu, 0.95), [lx, lz] = F.point(pu, -0.4);
              shopSpots.push({ pos: new THREE.Vector3(px, CH, pz), look: new THREE.Vector3(lx, 1.4, lz), yaw: F.yaw + Math.PI, by: null });
            }
          }
        } else {
          // lobby: double doors under a canopy, or tall plain windows
          const lobby = i === Math.floor(bays / 2);
          if (lobby) {
            F.box(frameB, u, CH + 1.35, 0, 2.4, 2.8, 0.06, 0x23272b);
            F.box(glassB, u, CH + 1.35, 0.07, 2.2, 2.6, 0.02, 0x9ab0bf);
            F.box(frameB, u, CH + 1.35, 0.1, 0.06, 2.6, 0.02, 0x23272b);
            F.box(trimB, u, 3.35, 0, 3.4, 0.16, 1.6, 0xe8e2d6);
            F.box(lampB, u, 3.25, 1.2, 0.5, 0.03, 0.2, 0xffffff);
          } else {
            F.box(frameB, u, CH + 1.9, 0, Math.min(bw - 1, 2.6), 2.4, 0.05, 0x2a2d31);
            F.box(glassB, u, CH + 1.9, 0.04, Math.min(bw - 1, 2.6) - 0.16, 2.24, 0.02, 0x7f92a2);
            F.box(trimD, u, CH + 0.62, 0, Math.min(bw - 1, 2.6) + 0.2, 0.12, 0.16, 0xe4ddd0);
          }
        }
      }
    }
  }
  for (const b of buildings) { facades(b); anchorOff(); }

  // ---------- street furniture ----------
  const floorAt = CH;
  const occupied = []; // [x, z, r] keep-out circles, so things don't overlap
  const free = (x, z, r) => occupied.every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) > r + or);
  const claim = (x, z, r) => occupied.push([x, z, r]);

  function lamp(x, z, towardRoad) {
    const [rx, rz] = towardRoad, y = floorAt;
    metalC.add(x, y + 0.3, z, 0.34, 0.6, 0.34);
    metalC.add(x, y + 3.3, z, 0.15, 6.6, 0.15);
    const ax = x + rx * 0.75, az = z + rz * 0.75;
    metalB.add(ax, y + 6.5, az, rz ? 0.08 : 1.6, 0.08, rz ? 1.6 : 0.08);
    const hx = x + rx * 1.5, hz = z + rz * 1.5;
    metalB.add(hx, y + 6.45, hz, 0.7, 0.18, 0.34, 0xffffff, rz ? Math.PI / 2 : 0);
    lampB.add(hx, y + 6.35, hz, 0.55, 0.03, 0.26, 0xffffff, rz ? Math.PI / 2 : 0);
    solidCyl(x, z, 0.17, y + 6.6);
    claim(x, z, 0.6);
  }
  function tree(x, z, y = floorAt, big = 1) {
    plainD.add(x, y + 0.003, z, 1.3, 0.006, 1.3, 0x2b2c2c);
    const th = 3 * big;
    barkC.add(x, y + th / 2, z, 0.26, th, 0.26);
    const greens = [0x4f7a3a, 0x5d8a41, 0x466d33, 0x6a9346, 0x3f6630];
    const parts = [];
    for (let k = 0; k < 5; k++) {
      const r = R.range(1.1, 1.7) * big;
      parts.push([x + R.range(-0.9, 0.9) * big, y + th + R.range(0.5, 1.7) * big, z + R.range(-0.9, 0.9) * big, r * 2, r * 1.6, r * 2, R.pick(greens), R() * 6]);
    }
    canopy(parts);
    solidCyl(x, z, 0.15, y + th);
    claim(x, z, 0.9);
  }
  // props kit: batches + the two kinds of collision (see cityprops.js)
  const manualSeats = [];
  const props = []; // breakable street furniture (props.js)
  const kit = {
    R, claim,
    b: {
      paint: paintB, glass: glassB, frame: frameB, metal: metalB, plain: plainB, wood: woodB, lamp: lampB,
      tail: batch('tail', BOX, M.tail), tire: batch('tireHi', CYL, M.tire), metalC, plainC,
      plainS: batch('plainS', SPHERE, M.plain),
    },
    walkBox: (x0, x1, z0, z1, top, extra = {}) => colliders.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top, ...extra }),
    physBox: (x0, x1, y0, y1, z0, z1, extra = {}) => colliders.solids.push({ type: 'box', x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, ...extra }),
    walkCyl: (x, z, r, top) => colliders.circles.push({ x, z, r, top }),
    physCyl: (x, z, r, y0, y1) => colliders.solids.push({ type: 'cyl', x, y: (y0 + y1) / 2, z, r, h: y1 - y0 }),
    seat: (x, y, z, yaw, h) => { const s = { o: new THREE.Vector3(x, y, z), yaw, h, by: null }; manualSeats.push(s); return s; },
    /** A prop that can be knocked over / smashed (props.js builds it); `walk` adds its footprint. */
    breakable: (kind, x, z, y, yaw, walk, extra = {}) => {
      const b0 = colliders.boxes.length, c0 = colliders.circles.length;
      walk?.();
      const spec = { kind, x, z, y, yaw, walk: [...colliders.boxes.slice(b0), ...colliders.circles.slice(c0)], ...extra };
      props.push(spec);
      return spec;
    },
  };
  const bench = (x, z, yaw, y = floorAt) => P.bench(kit, x, z, yaw, y);

  // per edge: furniture along the curb, cars in the parking lane
  const parking = [];
  let busStop = false;
  const hydrants = [];
  // the downtown sidewalks people walk (the outer districts furnish their own)
  const activeEdges = edges.filter((e) => e.b.zone === 'downtown' && Math.abs(e.c) < (e.along === 'x' ? ACTIVE.z : ACTIVE.x));
  for (const e of activeEdges) {
    const lo = Math.max(e.a0, e.along === 'x' ? -ACTIVE.x : -ACTIVE.z), hi = Math.min(e.a1, e.along === 'x' ? ACTIVE.x : ACTIVE.z);
    if (hi - lo < 10) continue;
    const [tx, tz] = e.along === 'x' ? [0, -e.n] : [-e.n, 0]; // toward the road
    const near = e.b.centre || Math.abs(e.c) < 45;
    const a0 = lo + 5.5, a1 = hi - 5.5;
    // street lamps every ~17 m, trees between
    for (let a = a0 + 1; a <= a1; a += 17) {
      const [x, z] = edgePt(e, a, FURN - 0.3);
      if (free(x, z, 0.5)) lamp(x, z, [tx, tz]);
      const ta = a + 8.5;
      if (ta < a1 && near) { const [x2, z2] = edgePt(e, ta, FURN + 0.3); if (free(x2, z2, 0.8)) tree(x2, z2); }
    }
    if (e.b.centre && e.along === 'x' && e.n > 0 && !busStop) { busStop = true; P.busShelter(kit, ...edgePt(e, -12, 1.25), edgeYaw(e) + Math.PI, floorAt); }
    if (near) {
      // odds and ends: benches facing the shops, bins by the corners, a hydrant, boxes
      const items = ['bench', 'bench', 'trash', 'trash', 'hydrant', 'news', 'news', 'mail', 'bike'];
      for (const it of items) {
        for (let tries = 0; tries < 10; tries++) {
          const a = it === 'trash' ? (R() < 0.5 ? a0 + R.range(0, 3) : a1 - R.range(0, 3)) : R.range(a0, a1);
          const [x, z] = edgePt(e, a, FURN + (it === 'bench' ? 0.35 : 0));
          const r = it === 'bench' ? 1.2 : it === 'bike' ? 1 : 0.6;
          if (!free(x, z, r) || inPlaza(x, z)) continue;
          const yaw = edgeYaw(e);
          if (it === 'bench') bench(x, z, yaw);
          else if (it === 'trash') P.trashCan(kit, x, z, floorAt);
          else if (it === 'hydrant') { P.hydrant(kit, x, z, floorAt, yaw + Math.PI); hydrants.push([x, z]); }
          else if (it === 'news') P.newsBox(kit, x, z, yaw, floorAt);
          else if (it === 'mail') P.mailbox(kit, x, z, yaw, floorAt);
          else P.bikeRack(kit, x, z, yaw, floorAt);
          break;
        }
      }
    }
    // cars, parked nose-to-tail facing the traffic in their lane (drive on the right), with a
    // meter at the curb beside each one; never in front of a hydrant or at the bus stop
    const cl = Math.max(e.a0 + 9, lo), ch = Math.min(e.a1 - 9, hi);
    const carYaw = e.along === 'x' ? (e.n > 0 ? Math.PI / 2 : -Math.PI / 2) : (e.n > 0 ? Math.PI : 0);
    for (let a = cl + R.range(0, 2); a < ch;) {
      const t = R(), kind = t < 0.5 ? 'sedan' : t < 0.9 ? 'hatch' : 'taxi', L = SPECS[kind].L;
      if (a + L > ch) break;
      const [x, z] = edgePt(e, a + L / 2, -1.25);
      const hyd = hydrants.some(([ox, oz]) => Math.hypot(x - ox, z - oz) < L / 2 + 1.6);
      const bus = e.b.centre && e.along === 'x' && e.n > 0 && Math.abs(a + L / 2 + 12) < 9;
      if (R() < 0.72 && !hyd && !bus) {
        parking.push({ x, z, yaw: carYaw, kind, color: kind === 'taxi' ? 0xf2b705 : R.pick(CAR_COLS), interior: Math.floor(R() * 3) });
        if (near) { const [mx, mz] = edgePt(e, a + L / 2 + 0.4, 0.4); if (free(mx, mz, 0.3)) P.meter(kit, mx, mz, edgeYaw(e) + Math.PI, floorAt); }
      }
      a += L + R.range(0.8, 2.6);
    }
  }

  // ---------- the plaza ----------
  const table = addTable(scene, colliders, 11.8, -3.4, CH); // (clear of the clothes store's door)
  {
    // fountain
    const fx = 0, fz = 0, y = CH;
    trimC.add(fx, y + 0.25, fz, 3.8, 0.5, 3.8, 0xcfc7b8);
    batch('water', CYL, M.water, { cast: false }).add(fx, y + 0.42, fz, 3.4, 0.02, 3.4);
    trimC.add(fx, y + 0.9, fz, 0.45, 1.5, 0.45, 0xcfc7b8);
    trimC.add(fx, y + 1.62, fz, 1.5, 0.14, 1.5, 0xcfc7b8);
    trimC.add(fx, y + 2.0, fz, 0.2, 0.7, 0.2, 0xcfc7b8);
    batch('water', CYL, M.water, { cast: false }).add(fx, y + 1.7, fz, 1.3, 0.02, 1.3);
    solidCyl(fx, fz, 1.9, y + 0.5);
    solidCyl(fx, fz, 0.3, y + 2.3);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const o = new THREE.Vector3(fx + Math.sin(a) * 1.9, y, fz + Math.cos(a) * 1.9);
      manualSeats.push({ o, yaw: a, h: 0.5, by: null });
    }
    // planters with trees, benches along the back wall, a couple more trees
    for (const [px, pz] of [[-11.5, -3.5], [11.5, 3.5], [-11.5, 3.5]]) {
      trimB.add(px, y + 0.225, pz, 1.6, 0.45, 1.6, 0xbdb4a4);
      plainD.add(px, y + 0.46, pz, 1.4, 0.02, 1.4, 0x3b2d22);
      solidBox(px - 0.8, px + 0.8, pz - 0.8, pz + 0.8, y, y + 0.45);
      tree(px, pz, y + 0.47, 1.05);
    }
    for (const bx of [-6.5, -2.8, 2.8]) bench(bx, -5.3, 0);
    for (const bz of [9, 14]) { bench(-6.3, bz, Math.PI / 2); bench(6.3, bz, -Math.PI / 2); }
    tree(-5.2, 16.2); tree(5.2, 16.2);
    // café tables outside the plaza shops
    for (const [cx, cz] of [[-9, 4.3], [-5.2, 4.5]]) P.cafeTable(kit, cx, cz, y, Math.PI / 2);
    // string of hanging lights across the entrance
    for (const lz of [9.5, 13.5]) {
      let px = null, py = 0;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, x = -6.95 + t * 13.9, y = 4.7 - Math.sin(t * Math.PI) * 0.7;
        if (k % 2 === 0 && k > 0 && k < 12) batch('bulb', SPHERE, M.lamp, { cast: false }).add(x, y - 0.09, lz, 0.12, 0.15, 0.12);
        if (px !== null) {
          const dx = x - px, dy = y - py;
          metalD.add((x + px) / 2, (y + py) / 2, lz, Math.hypot(dx, dy), 0.015, 0.015, 0x222222, 0, 0, Math.atan2(dy, dx));
        }
        px = x; py = y;
      }
    }
  }

  // ---------- the outer districts ----------
  const zones = buildZones({
    THREE, R, M, B, env, scene, aniso, tex: ZT, batch, box, signTex, colliders,
    CH, SW, FURN, WORLD, XS, ZS, STREETS_X, STREETS_Z,
    blocks: allBlocks.filter((b) => b.zone !== 'downtown'), edges: edges.filter((e) => e.b.zone !== 'downtown'),
    solidBox, solidCyl, kit, bench, tree, canopy, lamp, claim, free, markB, parking, P,
  });

  // ---------- road markings ----------
  const WHITE = 0xe9e7e0, YELLOW = 0xe0b53a;
  const mark = (x0, x1, z0, z1, c) => markB.add((x0 + x1) / 2, 0.003, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, c);
  const crossX = STREETS_X.flatMap(([a, b]) => [a - 2.6, b + 2.6]), crossZ = STREETS_Z.flatMap(([a, b]) => [a - 2.6, b + 2.6]);
  // stretches of street between intersection+crosswalk zones
  const runs = (streets) => {
    const out = []; let s = -WORLD;
    for (const [a, b] of streets) { out.push([s, a - 4.4]); s = b + 4.4; }
    out.push([s, WORLD]);
    return out;
  };
  // crosswalks either side of every junction, and a stop line on the side traffic arrives from
  // (drive on the right: arriving at the low side heading +, the lane is on the - half)
  for (const [a, b] of STREETS_X) {
    const c = (a + b) / 2;
    for (const [s, e] of runs(STREETS_Z)) {
      mark(c - 0.2, c - 0.08, s, e, YELLOW); mark(c + 0.08, c + 0.2, s, e, YELLOW);
      mark(a + 2.3, a + 2.42, s, e, WHITE); mark(b - 2.42, b - 2.3, s, e, WHITE);
    }
    for (const [za, zb] of STREETS_Z) for (const [z, sgn] of [[za - 2.6, -1], [zb + 2.6, 1]]) {
      for (let x = a + 0.6; x < b - 0.4; x += 1.1) mark(x, x + 0.55, z - 1.5, z + 1.5, WHITE);
      mark(sgn < 0 ? a + 0.3 : c + 0.2, sgn < 0 ? c - 0.2 : b - 0.3, z + sgn * 2.1 - 0.2, z + sgn * 2.1 + 0.2, WHITE);
    }
  }
  for (const [a, b] of STREETS_Z) {
    const c = (a + b) / 2;
    for (const [s, e] of runs(STREETS_X)) {
      mark(s, e, c - 0.2, c - 0.08, YELLOW); mark(s, e, c + 0.08, c + 0.2, YELLOW);
      mark(s, e, a + 2.3, a + 2.42, WHITE); mark(s, e, b - 2.42, b - 2.3, WHITE);
    }
    for (const [xa, xb] of STREETS_X) for (const [x, sgn] of [[xa - 2.6, -1], [xb + 2.6, 1]]) {
      for (let z = a + 0.6; z < b - 0.4; z += 1.1) mark(x - 1.5, x + 1.5, z, z + 0.55, WHITE);
      mark(x + sgn * 2.1 - 0.2, x + sgn * 2.1 + 0.2, sgn < 0 ? c + 0.2 : a + 0.3, sgn < 0 ? b - 0.3 : c - 0.2, WHITE);
    }
  }
  // manholes and drains
  for (let k = 0; k < 110; k++) {
    const vert = R() < 0.5, st = R.pick(vert ? STREETS_X : STREETS_Z), along = R.range(-WORLD + 12, WORLD - 12);
    const across = R.range(st[0] + 3, st[1] - 3);
    const [x, z] = vert ? [across, along] : [along, across];
    batch('manhole', CYL_LO, M.metal, { cast: false }).add(x, 0.004, z, 0.8, 0.008, 0.8, 0x3a3a3a);
  }

  // ---------- traffic signals ----------
  const sigMat = (c) => new THREE.MeshStandardMaterial({ color: 0x151515, emissive: c, emissiveIntensity: 0, roughness: 0.4 });
  const SIG = {
    // vehicle lights for traffic moving along x ('x') and along z ('z')
    vx: { r: sigMat(0xff2a1a), y: sigMat(0xffb020), g: sigMat(0x3dff7a) },
    vz: { r: sigMat(0xff2a1a), y: sigMat(0xffb020), g: sigMat(0x3dff7a) },
    // pedestrian heads for people crossing along x / along z
    px: { walk: sigMat(0xf4f4ff), hand: sigMat(0xff7a1a) },
    pz: { walk: sigMat(0xf4f4ff), hand: sigMat(0xff7a1a) },
  };
  const sigB = {};
  for (const [g, set] of Object.entries(SIG)) for (const [k, m] of Object.entries(set)) sigB[g + k] = batch('sig' + g + k, g[0] === 'v' ? CYL : BOX, m, { cast: false });
  const centresX = STREETS_X.map(([a, b]) => (a + b) / 2), centresZ = STREETS_Z.map(([a, b]) => (a + b) / 2);
  for (const icx of centresX) for (const icz of centresZ) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = icx + sx * 6.1, z = icz + sz * 6.1; // curb corner, just back from it
      metalC.add(x, CH + 2.3, z, 0.16, 4.6, 0.16);
      solidCyl(x, z, 0.14, CH + 4.6);
      claim(x, z, 0.5);
      // pedestrian heads, one per crosswalk this corner anchors, facing across it
      for (const [nx, nz, grp] of [[-sx, 0, 'x'], [0, -sz, 'z']]) {
        const yaw = Math.atan2(nx, nz), hx = x + nx * 0.2, hz = z + nz * 0.2;
        metalB.add(hx, CH + 2.75, hz, 0.36, 0.62, 0.22, 0x2b2f33, yaw);
        const fx = hx + nx * 0.115, fz = hz + nz * 0.115;
        sigB['p' + grp + 'hand'].add(fx, CH + 2.9, fz, 0.24, 0.22, 0.01, 0xffffff, yaw);
        sigB['p' + grp + 'walk'].add(fx, CH + 2.6, fz, 0.24, 0.22, 0.01, 0xffffff, yaw);
      }
      // vehicle head for traffic arriving at this corner along z, and along x
      for (const [nx, nz, grp] of [[0, sz, 'z'], [sx, 0, 'x']]) {
        const yaw = Math.atan2(nx, nz), hx = x + nx * 0.25, hz = z + nz * 0.25;
        metalB.add(hx, CH + 3.9, hz, 0.36, 1.05, 0.3, 0x24282c, yaw);
        const fx = hx + nx * 0.16, fz = hz + nz * 0.16;
        ['r', 'y', 'g'].forEach((c, k) => sigB['v' + grp + c].add(fx, CH + 4.22 - k * 0.32, fz, 0.22, 0.02, 0.22, 0xffffff, yaw, Math.PI / 2));
      }
    }
  }

  const casters = []; // static shadow casters, box-culled against the sun each frame (main.js)
  for (const b of Object.values(B)) {
    for (const m of b.build(scene)) {
      if (b.mat === M.mark || b === B.manhole) m.receiveShadow = true;
      if (m.castShadow) casters.push(m);
    }
  }

  // ---------- people: sidewalks, crossings, spots ----------
  const nav = new CityNav({
    blocks, edges: activeEdges, lane: LANE, active: ACTIVE, crossX, crossZ, y: CH, colliders, shopSpots,
    extra: [
      [[0, 20.4], [0, 9]], [[0, 9], [-4.2, 3.6]], [[0, 9], [4.2, 3.6]],
      [[-4.2, 3.6], [-9.5, 0.2]], [[4.2, 3.6], [9.5, 0.2]], [[-9.5, 0.2], [-4, -3.4]], [[9.5, 0.2], [4, -3.4]], [[-4, -3.4], [4, -3.4]],
    ],
  });
  nav.update(0);
  const setSig = () => {
    const s = nav.signals;
    for (const g of ['x', 'z']) {
      const p = s[g];
      const blink = p === 'flash' ? (Math.floor(nav.t * 2) % 2 ? 1 : 0) : 1;
      SIG['p' + g].walk.emissiveIntensity = p === 'walk' ? 2.2 : 0;
      SIG['p' + g].hand.emissiveIntensity = p === 'walk' ? 0 : 2.2 * blink;
      const v = s['v' + g];
      for (const c of ['r', 'y', 'g']) SIG['v' + g][c].emissiveIntensity = v === c ? 2.6 : 0;
    }
  };
  setSig();

  const surfaceAt = (x, z) => {
    if (x > WORLD || (x > XS[4][0] && Math.abs(z) > WORLD)) return 'sand';
    if (Math.abs(x) > WORLD || Math.abs(z) > WORLD) return 'grass';
    const b = allBlocks.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
    if (b?.zone === 'suburb' || b?.zone === 'lake') return 'grass';
    if (b?.zone === 'desert') return 'sand';
    return 'asphalt';
  };
  const seats = [...findSeats(colliders), ...manualSeats];
  return {
    colliders, sun, table, seats, nav, store, clothes, env, surfaceAt,
    // (the cop car's spot out front kept clear)
    parking: parking.filter((p) => Math.hypot(p.x - COP_CAR.x, p.z - COP_CAR.z) > 6),
    station: station && { ...station, car: COP_CAR }, props, casters, lod: lodMeshes,
    // the street grid for traffic: intersections at every (x, z) pair, lanes 1.6 m right of
    // the centre line, stop lines and intersection exits measured from each centre
    roads: { xs: STREETS_X.map(([a, b]) => (a + b) / 2), zs: STREETS_Z.map(([a, b]) => (a + b) / 2), lane: 1.6, stop: 10.4, exit: 9.6, end: WORLD - 4, signals: nav.signals },
    spawn: new THREE.Vector3(0, CH, 16), spawnYaw: Math.PI, spawnR: 5,
    sunOff: new THREE.Vector3(22, 40, 15),
    npcs: 14, traffic: 11,
    npcSpot: () => nav.randomSpot(),
    spotIn: (x0, z0, x1, z1) => nav.spotIn(x0, z0, x1, z1),
    update(dt) { nav.update(dt); setSig(); zones.update(dt); },
  };
}
