import * as THREE from 'three';
import { Colliders, addSky } from './world.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// the room's concrete: one image, tiled every TILE m (a copy per surface, each with its own repeat)
const TILE = 4;
let concreteImg = null;
function concrete(renderer, w, h) {
  concreteImg ||= new THREE.TextureLoader().load('concrete_dif.png');
  const t = concreteImg.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() || 1);
  t.repeat.set(w / TILE, h / TILE);
  // (clones share the image: one arriving later updates them all)
  if (concreteImg.image) t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
}

function floor(scene, colliders, size, material, surface) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.boxes.push({ minX: -size / 2, maxX: size / 2, minZ: -size / 2, maxZ: size / 2, top: 0, surface });
}

function box(scene, colliders, w, h, d, x, y, z, color, surface = 'concrete') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), color?.isMaterial ? color : new THREE.MeshStandardMaterial({ color, roughness: 0.78 }));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h, surface });
  colliders.solids.push({ type: 'box', x, y: y + h / 2, z, w, h, d });
}

/**
 * A ceiling over the walls: drawn and solid (rounds, blood and grenades stop on it), but not a
 * floor anything stands on, and it casts no shadow - the sun still lights the room inside.
 */
function roof(scene, colliders, w, d, y, material) {
  const T = 0.4;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, T, d), material);
  mesh.position.set(0, y + T / 2, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.solids.push({ type: 'box', x: 0, y: y + T / 2, z: 0, w, h: T, d });
}

function baseLevel(colliders, sun, surface, spawn, npcs) {
  return { colliders, sun, seats: [], parking: [], table: { x: 10000, z: 10000, top: 0 }, surfaceAt: () => surface, spawn: V(...spawn), spawnYaw: 0, spawnR: 5, npcs };
}

/**
 * The arena: a walled pit for wave fights, and next to it (walled off, roofed) the little spawn
 * room you start in, with the button that starts a round (arena.js) and sends you in.
 */
export function buildArena(scene, renderer, opt = {}) {
  const sun = addSky(scene, { sky: 0x8fa0ad, fogNear: 70, fogFar: 180, hemi: 1.3, sunI: 2.7, span: 34 });
  const colliders = new Colliders();
  floor(scene, colliders, 140, new THREE.MeshStandardMaterial({ color: 0x6f6658, roughness: 0.97 }), 'concrete');
  // the pit: sand, high walls, a few pillars to fight round
  const R = 20, H = 6;
  const sandTex = new THREE.TextureLoader().load('sand_dif.jpg');
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.colorSpace = THREE.SRGBColorSpace;
  sandTex.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() || 1);
  sandTex.repeat.set(R * 2 / 3, R * 2 / 3); // (a tile every 3 m)
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  sand.rotation.x = -Math.PI / 2; sand.position.y = 0.002; sand.receiveShadow = true;
  scene.add(sand);
  const wall = concrete(renderer, R * 2, H);
  box(scene, colliders, R * 2 + 2, H, 1, 0, 0, -R - 0.5, wall);
  box(scene, colliders, R * 2 + 2, H, 1, 0, 0, R + 0.5, wall);
  box(scene, colliders, 1, H, R * 2, -R - 0.5, 0, 0, wall);
  box(scene, colliders, 1, H, R * 2, R + 0.5, 0, 0, wall);
  // a red band round the top of the wall
  const band = new THREE.MeshStandardMaterial({ color: 0x8c2a22, roughness: 0.8 });
  for (const [w, d, x, z] of [[R * 2 + 2.2, 1.2, 0, -R - 0.5], [R * 2 + 2.2, 1.2, 0, R + 0.5], [1.2, R * 2 + 2.2, -R - 0.5, 0], [1.2, R * 2 + 2.2, R + 0.5, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), band);
    m.position.set(x, H + 0.15, z); m.castShadow = true;
    scene.add(m);
  }
  const stone = concrete(renderer, 2, 3);
  for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) box(scene, colliders, 1.6, 3, 1.6, x, 0, z, stone);
  // the gates they come in by (dark recesses in the walls)
  const dark = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 1 });
  const gates = [];
  for (const [x, z, yaw] of [[0, -R, 0], [-R, 0, Math.PI / 2], [R, 0, -Math.PI / 2], [-R * 0.6, -R, 0], [R * 0.6, -R, 0]]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), dark);
    const out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    g.position.set(x + out.x * 0.01, 1.6, z + out.z * 0.01);
    g.rotation.y = yaw;
    scene.add(g);
    gates.push({ pos: V(x + out.x * 1.2, 0, z + out.z * 1.2), yaw });
  }

  // the multiplayer arena: just the pit - everyone spawns (and respawns) straight into it
  if (opt.mp) {
    const lvl = baseLevel(colliders, sun, 'concrete', [0, 0, 0], 0);
    lvl.spawnR = R - 6;
    lvl.clean = true;
    lvl.mpArena = { half: R };
    return lvl;
  }
  // the spawn room: walled off and roofed, south of the pit
  const S = 6, RZ = R + 14, RH = 4;
  const room = new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.9 });
  box(scene, colliders, S * 2 + 2, RH, 1, 0, 0, RZ - S - 0.5, room);
  box(scene, colliders, S * 2 + 2, RH, 1, 0, 0, RZ + S + 0.5, room);
  box(scene, colliders, 1, RH, S * 2, -S - 0.5, 0, RZ, room);
  box(scene, colliders, 1, RH, S * 2, S + 0.5, 0, RZ, room);
  const rf = new THREE.Mesh(new THREE.BoxGeometry(S * 2 + 2, 0.4, S * 2 + 2), new THREE.MeshStandardMaterial({ color: 0xe0d8ca, roughness: 0.9 }));
  rf.position.set(0, RH + 0.2, RZ); rf.receiveShadow = true;
  scene.add(rf);
  colliders.solids.push({ type: 'box', x: 0, y: RH + 0.2, z: RZ, w: S * 2 + 2, h: 0.4, d: S * 2 + 2 });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshStandardMaterial({ color: 0x4d3a33, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mat.rotation.x = -Math.PI / 2; mat.position.set(0, 0.002, RZ); mat.receiveShadow = true;
  scene.add(mat);
  // a light in there (the roof keeps the sun out)
  const lamp = new THREE.PointLight(0xfff0d8, 14, 14, 1.6);
  lamp.position.set(0, RH - 0.4, RZ);
  scene.add(lamp);

  const lvl = baseLevel(colliders, sun, 'concrete', [0, 0, RZ + 1], 0);
  lvl.spawnR = 1.5;
  lvl.spawnYaw = Math.PI; // (facing the button)
  lvl.clean = true;
  lvl.arena = {
    button: V(0, 0, RZ - 3),
    board: { pos: V(0, 2, RZ - S + 0.02), yaw: 0 },
    entry: V(0, 0, R - 4), entryYaw: Math.PI, entryR: 2.5,
    gates, half: R,
  };
  return lvl;
}

export function buildObby(scene) {
  const sun = addSky(scene, { sky: 0x99b7d1, fogNear: 65, fogFar: 180, hemi: 1.3, sunI: 2.9, span: 30 });
  const colliders = new Colliders();
  const grass = new THREE.MeshStandardMaterial({ color: 0x608a54, roughness: 0.96 });
  floor(scene, colliders, 90, grass, 'grass');
  const colors = [0xf08a55, 0xe8c658, 0x64b8a0, 0x6d91d5, 0xb276c1, 0xf0eee6];
  const route = [[0, 0, 0], [4, 1.2, -5], [8, 2.4, -10], [5, 3.6, -15], [0, 4.8, -20], [-5, 6, -25], [-9, 7.2, -30], [-4, 8.4, -35], [2, 9.6, -40]];
  route.forEach(([x, y, z], index) => box(scene, colliders, index ? 4 : 10, 0.55, index ? 4 : 10, x, y, z, colors[index % colors.length]));
  for (let i = 0; i < 4; i++) box(scene, colliders, 1.5, 0.5, 1.5, 12 + i * 4, 1 + i * 0.9, -8 - i * 5, colors[(i + 2) % colors.length]);
  box(scene, colliders, 10, 1, 10, 2, 10, -48, 0xe6bd48);
  return baseLevel(colliders, sun, 'grass', [0, 0, 0], 3);
}


/** The credits board on the menu room's wall: a framed card, drawn once on a canvas. */
const CREDITS = [['OWNER', 'Toas-Tuh'], ['ORIGINAL GAME', 'Rick Deckard']];
function creditsBoard(scene, pos, yaw) {
  const W = 1024, H = 768, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3b2a1e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d1b20'; g.fillRect(28, 28, W - 56, H - 56);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e8c46a'; g.font = 'bold 84px system-ui, sans-serif';
  g.fillText('CREDITS', W / 2, 130);
  g.fillRect(W / 2 - 160, 190, 320, 4);
  CREDITS.forEach(([role, name], i) => {
    const y = 320 + i * 220;
    g.fillStyle = '#9a948a'; g.font = '600 46px system-ui, sans-serif';
    g.fillText(role, W / 2, y);
    g.fillStyle = '#f4efe6'; g.font = 'bold 76px system-ui, sans-serif';
    g.fillText(name, W / 2, y + 74);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), new THREE.MeshBasicMaterial({ map: t }));
  mesh.position.copy(pos);
  mesh.rotation.y = yaw;
  scene.add(mesh);
}

/** The main menu: a small warm room, one dummy, and the map board on the north wall. */
export function buildMenuRoom(scene) {
  const sun = addSky(scene, { sky: 0x2a2730, fogNear: 60, fogFar: 160, hemi: 1.5, sunI: 2.2, span: 12 });
  const colliders = new Colliders();
  floor(scene, colliders, 60, new THREE.MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.8 }), 'wood');
  const S = 8, wall = 0xd8cfc0;
  box(scene, colliders, S * 2 + 1, 5, 1, 0, 0, -S - 0.5, wall);
  box(scene, colliders, S * 2 + 1, 5, 1, 0, 0, S + 0.5, wall);
  box(scene, colliders, 1, 5, S * 2 + 1, -S - 0.5, 0, 0, wall);
  box(scene, colliders, 1, 5, S * 2 + 1, S + 0.5, 0, 0, wall);
  roof(scene, colliders, S * 2 + 2, S * 2 + 2, 5, new THREE.MeshStandardMaterial({ color: 0xe6ddd0, roughness: 0.9 }));
  // a rug under the dummy
  // (just over the floor, under the blood laid on it - bloodsurf.js, 6 mm up - so blood lands on top of it)
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshStandardMaterial({ color: 0x7c3b3b, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(3.5, 0.002, 0); rug.receiveShadow = true;
  scene.add(rug);
  creditsBoard(scene, V(-S + 0.02, 2.3, 0), Math.PI / 2);
  const lvl = baseLevel(colliders, sun, 'wood', [0, 0, 4], 0);
  lvl.spawnR = 1.2;
  lvl.spawnYaw = Math.PI; // (facing the board)
  lvl.dummyAt = V(3.5, 0, 0);
  // the sandbox's maps (single player)
  lvl.menuBoard = { pos: V(0, 2.4, -S + 0.02), yaw: 0, title: 'Choose a map',
    maps: [{ id: 'baseplate', name: 'Baseplate' }, { id: 'room', name: 'Room' }, { id: 'racetrack', name: 'Racetrack' }, { id: 'arena', name: 'Arena' }] };
  return lvl;
}

/**
 * The main menu: where everyone starts (and a headset always starts). One board - Sandbox (the
 * menu room above, single player) or Multiplayer Arena - and the dressing booth to make your
 * character in before you go.
 */
export function buildMainMenu(scene) {
  const sun = addSky(scene, { sky: 0x1f2230, fogNear: 60, fogFar: 160, hemi: 1.5, sunI: 2.2, span: 12 });
  const colliders = new Colliders();
  floor(scene, colliders, 60, new THREE.MeshStandardMaterial({ color: 0x3a3f4f, roughness: 0.85 }), 'concrete');
  const S = 8, wall = 0x9aa3b8;
  box(scene, colliders, S * 2 + 1, 5, 1, 0, 0, -S - 0.5, wall);
  box(scene, colliders, S * 2 + 1, 5, 1, 0, 0, S + 0.5, wall);
  box(scene, colliders, 1, 5, S * 2 + 1, -S - 0.5, 0, 0, wall);
  box(scene, colliders, 1, 5, S * 2 + 1, S + 0.5, 0, 0, wall);
  roof(scene, colliders, S * 2 + 2, S * 2 + 2, 5, new THREE.MeshStandardMaterial({ color: 0xc8cedb, roughness: 0.9 }));
  const lvl = baseLevel(colliders, sun, 'concrete', [0, 0, 4], 0);
  lvl.spawnR = 1.2;
  lvl.spawnYaw = Math.PI; // (facing the board)
  lvl.clean = true;
  lvl.menuBoard = { pos: V(0, 2.4, -S + 0.02), yaw: 0, title: 'Play',
    maps: [{ id: 'menu', name: 'Sandbox' }, { id: 'mparena', name: 'Multiplayer Arena', color: '#7a1f1a' }] };
  // the dressing booth on the east wall: two partitions, a mat, the mirror and its panel (booth.js)
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.7 });
  for (const z of [1.7, 5.9]) box(scene, colliders, 1.5, 2.6, 0.1, S - 0.75, 0, z, wood, 'wood');
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4.1), new THREE.MeshStandardMaterial({ color: 0x2f4a5e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mat.rotation.x = -Math.PI / 2; mat.position.set(S - 0.75, 0.002, 3.8); mat.receiveShadow = true;
  scene.add(mat);
  lvl.booth = { mirror: { pos: V(S - 0.03, 1.2, 4.75), yaw: -Math.PI / 2 }, panel: { pos: V(S - 0.03, 1.45, 2.7), yaw: -Math.PI / 2 } };
  return lvl;
}

/** The room: four plain walls and a floor, nothing else. */
export function buildRoom(scene, renderer) {
  const sun = addSky(scene, { sky: 0xe9e6df, fogNear: 60, fogFar: 160, hemi: 1.7, sunI: 2.0, span: 16 });
  const colliders = new Colliders();
  floor(scene, colliders, 80, concrete(renderer, 80, 80), 'concrete');
  const S = 10, H = 6, T = 1;
  // concrete walls
  for (const [w, d, x, z] of [[S * 2 + T * 2, T, 0, -S - T / 2], [S * 2 + T * 2, T, 0, S + T / 2], [T, S * 2, -S - T / 2, 0], [T, S * 2, S + T / 2, 0]]) {
    box(scene, colliders, w, H, d, x, 0, z, concrete(renderer, Math.max(w, d), H));
  }
  roof(scene, colliders, S * 2 + T * 2, S * 2 + T * 2, H, concrete(renderer, S * 2 + T * 2, S * 2 + T * 2));
  const lvl = baseLevel(colliders, sun, 'concrete', [0, 0, 5], 1);
  lvl.soft = true;
  lvl.spawnYaw = Math.PI;
  return lvl;
}
