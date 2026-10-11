import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Colliders, addSky } from './world.js';

/*
  The tower: the roof of a skyscraper, very high up, for the survival mode. Built cheap:
  a handful of merged meshes and shared materials, one instanced skyline far below, canvas
  textures, no real lights but the sun. What's on the roof: a parapet round the edge, a
  cornice ledge just under it on the outside (the dead climb up over it), stair and lift
  housings with doors (the dead come out of those too), some cover.
  Returns what main.js wants of a level, plus `survival`: where the waves come in from.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const TOWER_H = 120;   // m: the roof
const R = 18;                 // m: half the roof's width
const PARA = 1.0, PARA_T = 0.4;
const LEDGE_DROP = 1.2, LEDGE_W = 0.8;

function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
// four floors x sixteen bays of curtain wall: glass between mullions, spandrel bands, the odd lit office
const facadeTex = (rx, ry) => canvasTex(256, 256, (g) => {
  g.fillStyle = '#6a7684'; g.fillRect(0, 0, 256, 256);
  for (let f = 0; f < 4; f++) for (let i = 0; i < 16; i++) {
    const lit = Math.random() < 0.1;
    const y = f * 64;
    const gr = g.createLinearGradient(0, y + 6, 0, y + 54);
    gr.addColorStop(0, lit ? '#f1dfa6' : '#3d5068'); gr.addColorStop(1, lit ? '#c4ad78' : '#223040');
    g.fillStyle = gr; g.fillRect(i * 16 + 2, y + 6, 12, 48);
  }
  g.fillStyle = '#56606c';
  for (let f = 0; f < 4; f++) g.fillRect(0, f * 64 + 56, 256, 8);
}, rx, ry);
const gravelTex = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#7d7a74'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = 90 + Math.random() * 70;
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // seams of the roofing
  g.fillStyle = 'rgba(40,38,34,.35)'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128);
}, R, R);
const padTex = () => canvasTex(256, 256, (g) => {
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = '#e8c33a'; g.lineWidth = 12;
  g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#f2f2ee'; g.font = 'bold 170px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('H', 128, 136);
});

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export function buildTower(scene, renderer) {
  const H = TOWER_H;
  const sun = addSky(scene, { sky: 0x9fb8d2, fogNear: 60, fogFar: 380, hemi: 1.35, sunI: 2.7, span: 22, near: 1, far: 90 });
  const colliders = new Colliders();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // (shared materials: a few for the whole map)
  const M = {
    facade: new THREE.MeshLambertMaterial({ map: facadeTex(1.5, 8.5) }),
    roof: new THREE.MeshStandardMaterial({ map: gravelTex(), roughness: 0.95 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8d9197, roughness: 0.7, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6f757c, roughness: 0.5, metalness: 0.6 }),
    door: new THREE.MeshStandardMaterial({ color: 0x5b6f86, roughness: 0.55, metalness: 0.3 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x0b0c0e }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  };
  M.roof.map.anisotropy = aniso;

  // a solid block: drawn (merged into `into`), walked on, collided with
  const solid = (into, w, h, d, x, y0, z, surface = 'concrete') => {
    into.push(box(w, h, d, x, y0 + h / 2, z));
    colliders.boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y0 + h, surface });
    colliders.solids.push({ type: 'box', x, y: y0 + h / 2, z, w, h, d });
  };
  const add = (geos, mat, shadow = false) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = shadow; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
    return m;
  };

  // ---- the tower: one box, the facade texture tiled a floor at a time ----
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(R * 2, H - 0.3, R * 2).translate(0, (H - 0.3) / 2, 0), M.facade);
  shaft.matrixAutoUpdate = false;
  scene.add(shaft);
  colliders.boxes.push({ minX: -R, maxX: R, minZ: -R, maxZ: R, top: H, surface: 'gravel' });
  colliders.solids.push({ type: 'box', x: 0, y: H / 2, z: 0, w: R * 2, h: H, d: R * 2 });
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2).translate(0, H + 0.001, 0), M.roof);
  roof.receiveShadow = true; roof.matrixAutoUpdate = false;
  scene.add(roof);

  // ---- parapet, the cornice ledge outside it, the crown band ----
  const conc = [], trim = [], metal = [], cast = [];
  for (const s of [1, -1]) {
    solid(conc, R * 2, PARA, PARA_T, 0, H, s * (R - PARA_T / 2));
    solid(conc, PARA_T, PARA, R * 2 - PARA_T * 2, s * (R - PARA_T / 2), H, 0);
    // (the ledge: a walkable strip round the outside, just under the top)
    const L = R + LEDGE_W, y0 = H - LEDGE_DROP - 0.3;
    solid(trim, L * 2, 0.3, LEDGE_W, 0, y0, s * (R + LEDGE_W / 2));
    solid(trim, LEDGE_W, 0.3, R * 2, s * (R + LEDGE_W / 2), y0, 0);
    trim.push(box(R * 2 + 0.3, 0.12, 0.12, 0, H + PARA + 0.06, s * (R - PARA_T / 2)));
    trim.push(box(0.12, 0.12, R * 2 + 0.3, s * (R - PARA_T / 2), H + PARA + 0.06, 0));
  }
  // ---- housings: two stair towers and the lift's motor room, each with a door ----
  const HOUSE = [
    { x: -10, z: -9, w: 4.4, d: 4, h: 3.3, face: 'z' },   // door on +z
    { x: 10.5, z: 8, w: 4.4, d: 4, h: 3.3, face: '-x' },
    { x: 9, z: -10.5, w: 6, d: 4, h: 4.2, face: 'z' },    // the lift room
  ];
  const doors = [];
  for (const hs of HOUSE) {
    solid(conc, hs.w, hs.h, hs.d, hs.x, H, hs.z);
    cast.push(box(hs.w + 0.3, 0.2, hs.d + 0.3, hs.x, H + hs.h + 0.1, hs.z));
    // the door: a dark opening, a panel on a hinge that swings out
    const out = hs.face === 'z' ? V(0, 0, 1) : V(-1, 0, 0);
    const half = (hs.face === 'z' ? hs.d : hs.w) / 2;
    const c = V(hs.x + out.x * (half + 0.01), H, hs.z + out.z * (half + 0.01));
    const yaw = Math.atan2(out.x, out.z);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.15), M.dark);
    hole.position.set(c.x, H + 1.075, c.z);
    hole.rotation.y = yaw;
    scene.add(hole);
    const hinge = new THREE.Group();
    const side = V(Math.cos(yaw), 0, -Math.sin(yaw));  // the door's width, across the opening
    hinge.position.copy(c).addScaledVector(side, -0.55).addScaledVector(out, 0.03);
    hinge.rotation.y = yaw;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.15, 0.05).translate(0.55, 1.075, 0), M.door);
    panel.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M.metal);
    knob.position.set(0.95, 1.05, 0.05);
    panel.add(knob);
    hinge.add(panel);
    scene.add(hinge);
    doors.push({ hinge, yaw, openT: 0, spot: c.clone().addScaledVector(out, 0.9), out, from: c.clone().addScaledVector(out, -0.3) });
  }
  // ---- cover: plant units (low boxes with a fan on top), vents, a water tank on legs ----
  const UNITS = [[-3, 5, 3, 1.3, 1.8], [2.5, -4, 1.8, 1.1, 3.2], [-12, 6, 2.4, 1.2, 2.4], [4, 12, 3.6, 1.0, 1.4], [-5, -13, 1.4, 1.4, 1.4]];
  const fans = [];
  for (const [x, z, w, h, d] of UNITS) {
    solid(metal, w, h, d, x, H, z, 'metal');
    trim.push(box(w + 0.08, 0.06, d + 0.08, x, H + h + 0.03, z));
    fans.push(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 14).translate(x, H + h + 0.1, z));
  }
  for (const [x, z] of [[-14, -2], [14, -3], [-2, 14.5], [0, -15]]) {
    metal.push(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 10).translate(x, H + 0.45, z));
    metal.push(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10).translate(x, H + 0.95, z));
    colliders.circles.push({ x, z, r: 0.25, top: H + 1.0, surface: 'metal' });
    colliders.solids.push({ type: 'cyl', x, y: H + 0.5, z, r: 0.25, h: 1.0 });
  }
  // the water tank: up on four legs you can walk between
  const TX = -11, TZ = 12;
  for (const [dx, dz] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]]) {
    metal.push(new THREE.CylinderGeometry(0.1, 0.1, 3, 6).translate(TX + dx, H + 1.5, TZ + dz));
    colliders.circles.push({ x: TX + dx, z: TZ + dz, r: 0.12, top: H + 3, surface: 'metal' });
    colliders.solids.push({ type: 'cyl', x: TX + dx, y: H + 1.5, z: TZ + dz, r: 0.12, h: 3 });
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 3.2, 20).translate(TX, H + 4.6, TZ), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 }));
  tank.castShadow = true; tank.matrixAutoUpdate = false;
  scene.add(tank);
  cast.push(new THREE.ConeGeometry(2.25, 0.8, 20).translate(TX, H + 6.6, TZ));
  colliders.solids.push({ type: 'cyl', x: TX, y: H + 4.6, z: TZ, r: 2.1, h: 3.2 });
  // the mast, a light blinking at the top
  const MX = 13, MZ = -14;
  metal.push(new THREE.CylinderGeometry(0.06, 0.16, 22, 6).translate(MX, H + 11, MZ));
  for (let i = 1; i < 4; i++) metal.push(new THREE.BoxGeometry(1.4 - i * 0.3, 0.05, 0.05).translate(MX, H + i * 5, MZ));
  colliders.circles.push({ x: MX, z: MZ, r: 0.18, top: H + 22, surface: 'metal' });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M.red);
  beacon.position.set(MX, H + 22.1, MZ);
  scene.add(beacon);

  add(conc, M.concrete, true);
  add(trim, M.trim);
  add(metal, M.metal, true);
  add(cast, M.concrete, true);
  add(fans, M.dark);
  // the helipad markings (one transparent quad)
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2).translate(1, H + 0.01, 3), new THREE.MeshBasicMaterial({ map: padTex(), transparent: true, depthWrite: false }));
  pad.matrixAutoUpdate = false;
  scene.add(pad);

  // ---- the skyline, far below: one instanced mesh, one draw ----
  const sky = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 230;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // (most well below the roof: the tower's the tallest thing about; a few giants far off)
    const h = r > 200 && Math.random() < 0.3 ? H * (0.9 + Math.random() * 0.5) : 20 + Math.random() * (H - 45);
    sky.push([x, z, 14 + Math.random() * 26, 14 + Math.random() * 26, h]);
  }
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ map: facadeTex(0.5, 2) }), sky.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  sky.forEach(([x, z, w, d, h], i) => {
    city.setMatrixAt(i, m4.compose(V(x, 0, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.round(Math.random() * 3) * 0.1), V(w, h, d)));
    city.setColorAt(i, col.setHSL(0.58 + Math.random() * 0.05, 0.08, 0.55 + Math.random() * 0.3));
  });
  city.frustumCulled = false;
  scene.add(city);
  const street = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3b3f44 }));
  street.matrixAutoUpdate = false;
  scene.add(street);

  // ---- where the dead come in: out of the doors, up over the ledge ----
  const ledges = [];
  const LY = H - LEDGE_DROP;
  for (const s of [1, -1]) for (let i = -3; i <= 3; i++) {
    const t = i * 4.6 + (Math.random() - 0.5);
    ledges.push({ pos: V(t, LY, s * (R + LEDGE_W * 0.55)), yaw: s > 0 ? Math.PI : 0 });
    ledges.push({ pos: V(s * (R + LEDGE_W * 0.55), LY, t), yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
  let t = 0;
  const update = (dt) => {
    t += dt;
    beacon.visible = t % 1.6 < 0.25;
    // doors: swing open (someone's coming out), stand a moment, swing shut
    for (const d of doors) {
      if (d.openT <= 0) { d.hinge.rotation.y += (d.yaw - d.hinge.rotation.y) * Math.min(1, dt * 6); continue; }
      d.openT -= dt;
      d.hinge.rotation.y += (d.yaw - 1.9 - d.hinge.rotation.y) * Math.min(1, dt * 9);
    }
  };
  const surfaceAt = (_, __, y) => y > H - 2 ? 'gravel' : 'concrete';
  return {
    colliders, sun, update, surfaceAt,
    table: { x: 0, z: 0, w: 1, d: 1, top: H },
    seats: [], parking: [],
    spawn: V(0, H, 2), spawnYaw: 0, spawnR: 3, npcs: 0,
    sunOff: V(18, 32, 12),
    survival: { doors, ledges, height: H, half: R, button: V(1, H, 3) },
  };
}
