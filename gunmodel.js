import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
  Procedural compact pistol. Gun frame: +Z = muzzle, +Y = up, origin = where the web of the
  shooting hand sits on the back of the grip. Right side of the gun = -X.
*/

export const GRIP_TILT = 0.32;              // grip leans back by this much (rad)
export const MUZZLE = new THREE.Vector3(0, 0.03, 0.165);
export const PORT = new THREE.Vector3(-0.012, 0.036, 0.055); // ejection port (right side)
export const MAG_LEN = 0.1;
// magazine seated position (top of the mag, gun frame) and the axis it slides along (down the grip)
export const MAG_SEAT = new THREE.Vector3(0, -0.016, 0.0);
export const MAG_AXIS = new THREE.Vector3(0, -Math.cos(GRIP_TILT), -Math.sin(GRIP_TILT));

// surface grain: a fine speckle, as bump (stippled polymer, brushed / parkerised steel) and as
// roughness variation, so up close (VR) the parts read as material rather than flat plastic
function grain(n = 256, k = 1, streak = false) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n);
  let row = 0;
  for (let i = 0; i < n * n; i++) {
    if (streak && i % n === 0) row = Math.random() * 40;
    const v = 128 + (Math.random() - 0.5) * 120 * k + (streak ? row - 20 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}
const STIPPLE = grain(256, 1.2), BRUSH = grain(256, 0.35, true), SOFT = grain(128, 0.5);
const polymer = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.72, metalness: 0.04, bumpMap: SOFT, bumpScale: 0.4, roughnessMap: SOFT });
const gripTex = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.9, metalness: 0.02, bumpMap: STIPPLE, bumpScale: 1.6 });
const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.3, metalness: 0.85, bumpMap: BRUSH, bumpScale: 0.25, roughnessMap: BRUSH });
const dark = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.42, metalness: 0.55, roughnessMap: SOFT });
const brass = new THREE.MeshStandardMaterial({ color: 0xc9a043, roughness: 0.25, metalness: 0.95 });
const copper = new THREE.MeshStandardMaterial({ color: 0xb06a3a, roughness: 0.3, metalness: 0.9 });
// sight dots: they glow a little, like tritium
const dotW = new THREE.MeshStandardMaterial({ color: 0xf4f4ea, emissive: 0x9fffb0, emissiveIntensity: 0.6, roughness: 0.4 });
const dotO = new THREE.MeshStandardMaterial({ color: 0xff8a1e, emissive: 0xff7a10, emissiveIntensity: 0.5, roughness: 0.4 });
const GUN_MATS = [polymer, gripTex, steel, dark, brass, copper];

/**
 * Reflections for the guns' metal: a soft studio room, prefiltered once. Without it metal
 * parts only ever show their flat base colour, which is what makes them look like toys.
 */
export function initGunLook(renderer) {
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    for (const m of [...GUN_MATS, wood, shellMat]) { m.envMap = env; m.envMapIntensity = m.metalness > 0.5 ? 0.9 : 0.35; m.needsUpdate = true; }
  } catch (e) { console.warn('gun reflections', e); }
}

const rbox = (w, h, d, r = 0.003) => new RoundedBoxGeometry(w, h, d, 2, r);
function add(parent, geo, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** A magazine (its origin = top of the mag, body extends down its local -Y). */
export function buildMag(rounds = true) {
  const g = new THREE.Group();
  add(g, rbox(0.021, MAG_LEN, 0.032, 0.003), polymer, 0, -MAG_LEN / 2, 0);
  add(g, rbox(0.024, 0.012, 0.037, 0.003), dark, 0, -MAG_LEN + 0.004, -0.002); // base plate
  if (rounds) {
    add(g, new THREE.CylinderGeometry(0.0045, 0.0045, 0.018, 10), brass, 0, 0.001, 0.0, Math.PI / 2);
    add(g, new THREE.SphereGeometry(0.0045, 8, 6), copper, 0, 0.001, 0.009);
  }
  return g;
}

/** Spent case (origin at its centre, axis along local Y). */
export const CASE_GEO = new THREE.CylinderGeometry(0.0046, 0.0046, 0.019, 10);
export const CASE_MAT = brass;

export function buildPistol() {
  const gun = new THREE.Group();
  // frame: dust cover + trigger guard + grip
  const frame = new THREE.Group();
  gun.add(frame);
  add(frame, rbox(0.026, 0.016, 0.15, 0.004), polymer, 0, 0.008, 0.07);
  // trigger guard (a flat loop)
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, 6, 16, Math.PI), polymer);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, 0.0, 0.045);
  guard.scale.set(1, 1.1, 1);
  frame.add(guard);
  add(frame, rbox(0.008, 0.02, 0.006, 0.002), dark, 0, -0.006, 0.037, 0.25); // trigger
  // grip: leaning back, textured by a slightly bigger inner panel
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT;
  grip.position.set(0, 0.002, -0.008);
  frame.add(grip);
  add(grip, rbox(0.029, 0.108, 0.047, 0.006), polymer, 0, -0.054, 0);
  add(grip, rbox(0.0305, 0.07, 0.035, 0.004), gripTex, 0, -0.055, -0.003);
  for (let i = 0; i < 3; i++) add(grip, rbox(0.03, 0.004, 0.006, 0.002), polymer, 0, -0.03 - i * 0.017, 0.023); // finger grooves
  add(grip, rbox(0.026, 0.02, 0.012, 0.004), polymer, 0, -0.004, -0.028); // beavertail

  // slide (moves back along -Z when cycling)
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.024, 0.026, 0.178, 0.004), steel, 0, 0.03, 0.074);
  add(slide, rbox(0.004, 0.006, 0.004, 0.001), dark, 0, 0.046, 0.155); // front sight
  add(slide, rbox(0.016, 0.006, 0.005, 0.001), dark, 0, 0.046, -0.008); // rear sight
  for (let i = 0; i < 6; i++) add(slide, new THREE.BoxGeometry(0.0255, 0.018, 0.0018), dark, 0, 0.03, -0.004 + i * 0.005); // serrations
  add(slide, rbox(0.0015, 0.011, 0.028, 0.0005), dark, -0.012, 0.036, 0.055); // ejection port
  // barrel crown visible in the muzzle
  add(gun, new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 12), dark, 0, 0.03, 0.163, Math.PI / 2);

  // magazine in the well
  const magWell = new THREE.Group();
  magWell.position.copy(MAG_SEAT);
  magWell.rotation.x = GRIP_TILT;
  frame.add(magWell);
  const mag = buildMag();
  magWell.add(mag);

  // detail: accessory rail, levers, front serrations, glowing three-dot sights, guide rod
  for (let i = 0; i < 3; i++) add(frame, rbox(0.022, 0.004, 0.007, 0.001), polymer, 0, -0.002, 0.098 + i * 0.016);
  add(frame, rbox(0.003, 0.005, 0.03, 0.0015), dark, 0.0135, 0.014, 0.03);            // slide stop
  add(frame, rbox(0.003, 0.004, 0.012, 0.0015), dark, 0.0135, 0.007, 0.065);          // takedown
  add(frame, rbox(0.004, 0.008, 0.008, 0.002), dark, -0.0145, -0.003, 0.012);         // mag release
  for (let i = 0; i < 4; i++) add(slide, new THREE.BoxGeometry(0.0255, 0.016, 0.0016), dark, 0, 0.031, 0.122 + i * 0.0045);
  add(slide, rbox(0.022, 0.003, 0.15, 0.001), steel, 0, 0.0435, 0.072);               // flat top
  add(slide, new THREE.SphereGeometry(0.0013, 8, 6), dotW, 0.0045, 0.047, -0.0108);
  add(slide, new THREE.SphereGeometry(0.0013, 8, 6), dotW, -0.0045, 0.047, -0.0108);
  add(slide, new THREE.SphereGeometry(0.0015, 8, 6), dotO, 0, 0.047, 0.1528);
  add(slide, rbox(0.012, 0.007, 0.024, 0.001), brass, -0.002, 0.04, 0.055);           // barrel hood in the port
  add(gun, cyl(0.0032, 0.006, 16), steel, 0, 0.009, 0.149, Math.PI / 2);             // guide rod

  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag, magWell };
}

// ---------------------------------------------------------------- long guns
// Same frame as the pistol: origin = the web of the shooting hand on the grip, +Z to the muzzle.
const WOODGRAIN = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#7a4a2a'; x.fillRect(0, 0, 64, 512);
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = `rgba(${40 + Math.random() * 30},${20 + Math.random() * 15},10,${0.15 + Math.random() * 0.3})`;
    x.lineWidth = 0.5 + Math.random() * 2;
    x.beginPath();
    let px = Math.random() * 64;
    x.moveTo(px, 0);
    for (let y = 0; y <= 512; y += 32) { px += (Math.random() - 0.5) * 4; x.lineTo(px, y); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, map: WOODGRAIN, roughness: 0.48, metalness: 0.02, bumpMap: WOODGRAIN, bumpScale: 0.3 });
const shellMat = new THREE.MeshStandardMaterial({ color: 0xa3241f, roughness: 0.5, metalness: 0.1 });
const cyl = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg);

export const RIFLE_MAG_LEN = 0.16;
export const RIFLE_MAG_AXIS = new THREE.Vector3(0, -Math.cos(0.18), Math.sin(0.18));
/** An AR magazine: origin at its top, curving down its local -Y. */
export function buildRifleMag(rounds = true) {
  const g = new THREE.Group();
  add(g, rbox(0.024, 0.09, 0.062, 0.004), steel, 0, -0.045, 0);
  const lower = add(g, rbox(0.024, 0.075, 0.06, 0.004), steel, 0, -0.118, 0.012, 0.28);
  lower.rotation.x = -0.28;
  add(g, rbox(0.027, 0.012, 0.066, 0.003), dark, 0, -RIFLE_MAG_LEN + 0.004, 0.024, -0.28);
  for (let i = 0; i < 3; i++) add(g, rbox(0.0255, 0.004, 0.05, 0.0015), dark, 0, -0.02 - i * 0.022, 0);
  if (rounds) add(g, cyl(0.0042, 0.05, 8), brass, 0, 0.003, 0.004, Math.PI / 2);
  return g;
}

export function buildRifle() {
  const gun = new THREE.Group();
  // upper and lower receiver
  add(gun, rbox(0.032, 0.05, 0.25, 0.004), dark, 0, 0.022, 0.06);
  add(gun, rbox(0.03, 0.012, 0.25, 0.003), steel, 0, 0.053, 0.06);                  // top rail
  add(gun, rbox(0.02, 0.03, 0.06, 0.003), dark, 0, 0.074, 0.02);                    // rear sight
  // pistol grip
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT;
  grip.position.set(0, 0.002, -0.008);
  gun.add(grip);
  add(grip, rbox(0.028, 0.095, 0.042, 0.006), polymer, 0, -0.048, 0);
  // trigger guard + trigger
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.02, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.008, 0.032, 0.25);
  // handguard, barrel, front sight
  add(gun, rbox(0.044, 0.048, 0.24, 0.01), polymer, 0, 0.024, 0.305);
  add(gun, cyl(0.009, 0.2), steel, 0, 0.03, 0.52, Math.PI / 2);
  add(gun, rbox(0.012, 0.05, 0.014, 0.002), dark, 0, 0.055, 0.44);
  add(gun, cyl(0.013, 0.04), dark, 0, 0.03, 0.62, Math.PI / 2);                     // flash hider
  // buffer tube and stock
  add(gun, cyl(0.015, 0.14), dark, 0, 0.03, -0.1, Math.PI / 2);
  add(gun, rbox(0.034, 0.08, 0.13, 0.008), polymer, 0, 0.012, -0.2);
  add(gun, rbox(0.036, 0.092, 0.02, 0.006), dark, 0, 0.01, -0.27);                  // butt pad
  // charging handle / bolt (the "slide": moves back when it cycles)
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.003, 0.014, 0.05, 0.001), steel, -0.017, 0.032, 0.09);
  add(slide, rbox(0.04, 0.008, 0.012, 0.002), dark, 0, 0.056, -0.04);
  // magazine
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.004, 0.085);
  magWell.rotation.x = -0.18;
  gun.add(magWell);
  const mag = buildRifleMag();
  magWell.add(mag);
  // detail: picatinny teeth along the top, vented handguard, dust cover, forward assist,
  // selector, a real trigger guard, an aperture on the rear sight, slots in the flash hider
  for (let i = 0; i < 14; i++) add(gun, rbox(0.032, 0.005, 0.008, 0.001), dark, 0, 0.061, -0.055 + i * 0.017);
  for (let i = 0; i < 12; i++) add(gun, rbox(0.03, 0.005, 0.008, 0.001), dark, 0, 0.051, 0.2 + i * 0.019);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) add(gun, rbox(0.004, 0.012, 0.03, 0.002), dark, s * 0.0215, 0.026, 0.215 + i * 0.042);
  add(gun, rbox(0.002, 0.022, 0.06, 0.001), steel, -0.0165, 0.026, 0.09);             // dust cover
  add(gun, cyl(0.006, 0.02, 16), steel, -0.018, 0.038, 0.0, 0.3);                     // forward assist
  add(gun, rbox(0.003, 0.004, 0.016, 0.0015), steel, 0.017, 0.008, 0.0);              // selector
  add(gun, rbox(0.012, 0.016, 0.02, 0.003), polymer, 0, -0.005, 0.11);                // mag well flare
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0028, 8, 20, Math.PI), dark);
  tg.rotation.set(0, Math.PI / 2, Math.PI); tg.position.set(0, -0.004, 0.04); tg.scale.set(1, 0.75, 1);
  gun.add(tg);
  const ap = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.002, 8, 16), steel);
  ap.position.set(0, 0.094, 0.01); gun.add(ap);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    add(gun, rbox(0.003, 0.003, 0.026, 0.001), polymer, Math.cos(a) * 0.0128, 0.03 + Math.sin(a) * 0.0128, 0.63);
  }
  add(gun, cyl(0.016, 0.012, 20), dark, 0, 0.03, -0.035, Math.PI / 2);               // castle nut
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag, magWell };
}

export function buildM1911() {
  const parts = buildPistol();
  for (const side of [-1, 1]) add(parts.gun, rbox(0.004, 0.072, 0.034, 0.004), wood, side * 0.016, -0.054, -0.005, 0.32);
  add(parts.gun, cyl(0.006, 0.025, 10), steel, 0, 0.023, -0.048, Math.PI / 2);
  return parts;
}

export function buildDeagle() {
  const parts = buildPistol();
  add(parts.slide, rbox(0.027, 0.03, 0.21, 0.004), steel, 0, 0.032, 0.074);
  add(parts.gun, cyl(0.009, 0.07, 12), steel, 0, 0.03, 0.205, Math.PI / 2);
  add(parts.gun, rbox(0.03, 0.015, 0.045, 0.004), steel, 0, 0.004, 0.03);
  return parts;
}

export function buildAK47() {
  const parts = buildRifle();
  add(parts.gun, rbox(0.046, 0.054, 0.19, 0.012), wood, 0, 0.024, 0.32);
  add(parts.gun, rbox(0.038, 0.084, 0.14, 0.012), wood, 0, 0.01, -0.2);
  add(parts.gun, cyl(0.015, 0.065, 12), dark, 0, 0.03, 0.66, Math.PI / 2);
  return parts;
}

export function buildAK74() {
  const parts = buildRifle();
  add(parts.gun, rbox(0.045, 0.052, 0.21, 0.008), polymer, 0, 0.024, 0.31);
  add(parts.gun, rbox(0.038, 0.078, 0.14, 0.008), polymer, 0, 0.012, -0.2);
  add(parts.gun, cyl(0.016, 0.095, 12), steel, 0, 0.03, 0.67, Math.PI / 2);
  return parts;
}

export const SHELL_GEO = cyl(0.0105, 0.064, 10);
const SHELL_GEO_SS = cyl(0.0105, 0.044, 16);
export const SHELL_MAT = shellMat;
/** A shotgun shell (for loading by hand; origin at its centre, axis along local Y). */
export function buildShell() {
  const g = new THREE.Group();
  add(g, SHELL_GEO, shellMat, 0, 0, 0);
  add(g, cyl(0.011, 0.014, 10), brass, 0, -0.028, 0);
  return g;
}

export function buildShotgun() {
  const gun = new THREE.Group();
  // receiver
  add(gun, rbox(0.036, 0.056, 0.2, 0.005), dark, 0, 0.022, 0.07);
  // trigger guard + trigger
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.022, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.01, 0.032, 0.25);
  // wooden stock: a wrist behind the grip, dropping to the butt
  const stock = new THREE.Group();
  stock.rotation.x = -0.16;
  stock.position.set(0, 0.012, -0.03);
  gun.add(stock);
  add(stock, rbox(0.032, 0.05, 0.09, 0.01), wood, 0, -0.012, -0.02);
  add(stock, rbox(0.036, 0.085, 0.24, 0.012), wood, 0, -0.014, -0.16);
  add(stock, rbox(0.038, 0.095, 0.02, 0.006), polymer, 0, -0.016, -0.285);
  // barrel and the tube magazine under it
  add(gun, cyl(0.011, 0.58), steel, 0, 0.034, 0.46, Math.PI / 2);
  add(gun, cyl(0.0095, 0.46), dark, 0, 0.008, 0.39, Math.PI / 2);
  add(gun, new THREE.SphereGeometry(0.0045, 8, 6), brass, 0, 0.047, 0.73);          // bead sight
  // the pump (the "slide": racks back and forward)
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.044, 0.042, 0.15, 0.012), wood, 0, 0.01, 0.35);
  for (let i = 0; i < 5; i++) add(slide, new THREE.BoxGeometry(0.046, 0.003, 0.004), dark, 0, 0.012, 0.3 + i * 0.024);
  // loading port under the receiver (shells go in here)
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.006, 0.09);
  gun.add(magWell);
  // detail: spare shells on a side saddle, a real trigger guard, muzzle ring, tube cap,
  // safety button, the loading port, sling stud
  add(gun, rbox(0.004, 0.034, 0.1, 0.002), polymer, 0.02, 0.026, 0.08);
  for (let i = 0; i < 4; i++) {
    add(gun, SHELL_GEO_SS, shellMat, 0.0255, 0.025, 0.04 + i * 0.026);
    add(gun, cyl(0.0108, 0.01, 16), brass, 0.0255, 0.003, 0.04 + i * 0.026);
  }
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.003, 8, 20, Math.PI), dark);
  tg.rotation.set(0, Math.PI / 2, Math.PI); tg.position.set(0, -0.006, 0.04); tg.scale.set(1, 0.75, 1);
  gun.add(tg);
  add(gun, cyl(0.0125, 0.012, 24), dark, 0, 0.034, 0.745, Math.PI / 2);              // muzzle ring
  add(gun, cyl(0.011, 0.016, 24), steel, 0, 0.008, 0.625, Math.PI / 2);              // tube cap
  add(gun, cyl(0.004, 0.04, 12), steel, 0, 0.0, 0.02).rotation.z = Math.PI / 2;      // cross-bolt safety
  add(gun, rbox(0.022, 0.003, 0.07, 0.001), dark, 0, -0.006, 0.1);                   // loading port
  add(gun, cyl(0.004, 0.012, 10), steel, 0, -0.005, 0.6);                            // sling stud
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag: null, magWell };
}

// ---- the big ones: a belt-box machine gun, a scoped marksman rifle, a bolt-action sniper ----
// straight box magazines (origin at the top, down local -Y)
export const MG_MAG_LEN = 0.11, SMG_MAG_LEN = 0.13, DMR_MAG_LEN = 0.12, SNIPER_MAG_LEN = 0.065;
export function buildSMGMag(rounds = true) {
  const g = new THREE.Group();
  add(g, rbox(0.024, 0.09, 0.058, 0.004), steel, 0, -0.045, 0);
  const lower = add(g, rbox(0.023, 0.075, 0.054, 0.004), steel, 0, -0.112, 0.01, 0.2);
  lower.rotation.x = -0.2;
  add(g, rbox(0.027, 0.012, 0.06, 0.003), dark, 0, -SMG_MAG_LEN + 0.004, 0.018, -0.2);
  if (rounds) add(g, cyl(0.0042, 0.05, 8), brass, 0, 0.003, 0.004, Math.PI / 2);
  return g;
}
export function buildMGMag(rounds = true) {
  // the belt box: a fat can hung under the gun, the belt feeding up out of it
  const g = new THREE.Group();
  add(g, rbox(0.075, MG_MAG_LEN, 0.1, 0.008), olive, 0.02, -MG_MAG_LEN / 2, 0);
  add(g, rbox(0.078, 0.012, 0.104, 0.004), dark, 0.02, -MG_MAG_LEN + 0.004, 0);
  if (rounds) for (let i = 0; i < 4; i++) add(g, cyl(0.0045, 0.05, 8), brass, 0.012 - i * 0.009, 0.004, 0.0, Math.PI / 2);
  return g;
}
export function buildDMRMag(rounds = true) {
  const g = new THREE.Group();
  add(g, rbox(0.026, DMR_MAG_LEN, 0.07, 0.004), steel, 0, -DMR_MAG_LEN / 2, 0);
  add(g, rbox(0.029, 0.012, 0.074, 0.003), dark, 0, -DMR_MAG_LEN + 0.004, 0);
  if (rounds) add(g, cyl(0.0048, 0.06, 8), brass, 0, 0.003, 0.004, Math.PI / 2);
  return g;
}
export function buildSniperMag(rounds = true) {
  const g = new THREE.Group();
  add(g, rbox(0.03, SNIPER_MAG_LEN, 0.09, 0.004), dark, 0, -SNIPER_MAG_LEN / 2, 0);
  if (rounds) add(g, cyl(0.0055, 0.075, 8), brass, 0, 0.003, 0.004, Math.PI / 2);
  return g;
}
const olive = new THREE.MeshStandardMaterial({ color: 0x4a4f36, roughness: 0.75, metalness: 0.15 });
const tan = new THREE.MeshStandardMaterial({ color: 0x8c7a58, roughness: 0.7, metalness: 0.05 });
const glass = new THREE.MeshStandardMaterial({ color: 0x1d3550, roughness: 0.08, metalness: 0.9 });

/** A scope on top: tube, bells at each end, turrets, glass. z0..z1 along the gun. */
function scope(gun, y, z0, z1, r = 0.017) {
  const len = z1 - z0, mid = (z0 + z1) / 2;
  add(gun, cyl(r * 0.72, len * 0.62), dark, 0, y, mid, Math.PI / 2);
  add(gun, new THREE.CylinderGeometry(r * 1.25, r * 0.72, len * 0.2, 14), dark, 0, y, z1 - len * 0.1, -Math.PI / 2);
  add(gun, new THREE.CylinderGeometry(r * 0.72, r, len * 0.18, 14), dark, 0, y, z0 + len * 0.09, -Math.PI / 2);
  add(gun, cyl(r * 1.15, 0.003, 14), glass, 0, y, z1 + 0.001, Math.PI / 2);
  add(gun, cyl(r * 0.9, 0.003, 14), glass, 0, y, z0 - 0.001, Math.PI / 2);
  add(gun, cyl(0.009, 0.018, 10), dark, 0, y + r * 0.9, mid);                       // elevation turret
  const w = add(gun, cyl(0.009, 0.018, 10), dark, -r * 0.9, y, mid);                // windage
  w.rotation.z = Math.PI / 2;
  for (const z of [mid - len * 0.2, mid + len * 0.2]) add(gun, rbox(0.03, y - 0.052, 0.018, 0.003), steel, 0, (y + 0.052) / 2, z); // rings
}

export function buildSMG() {
  const gun = new THREE.Group();
  // Compact stamped receiver, top sights, and a short ventilated handguard.
  add(gun, rbox(0.034, 0.05, 0.22, 0.005), dark, 0, 0.024, 0.075);
  add(gun, rbox(0.032, 0.01, 0.28, 0.003), steel, 0, 0.055, 0.12);
  add(gun, rbox(0.03, 0.038, 0.13, 0.007), polymer, 0, 0.024, 0.28);
  for (let i = 0; i < 4; i++) add(gun, rbox(0.034, 0.008, 0.009, 0.002), dark, 0, 0.026, 0.24 + i * 0.03);
  add(gun, cyl(0.009, 0.2), steel, 0, 0.03, 0.48, Math.PI / 2);
  add(gun, cyl(0.013, 0.035), dark, 0, 0.03, 0.59, Math.PI / 2);
  // Pistol grip and compact folding stock.
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT; grip.position.set(0, 0.002, -0.008);
  gun.add(grip);
  add(grip, rbox(0.028, 0.095, 0.042, 0.006), polymer, 0, -0.048, 0);
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.02, 0.04);
  add(gun, rbox(0.012, 0.018, 0.2, 0.003), steel, 0, 0.026, -0.12);
  add(gun, rbox(0.04, 0.065, 0.022, 0.005), polymer, 0, 0.025, -0.23);
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.006, 0.012, 0.05, 0.002), steel, -0.02, 0.027, 0.1);
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.004, 0.11);
  gun.add(magWell);
  const mag = buildSMGMag();
  magWell.add(mag);
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag, magWell };
}

export function buildMG() {
  const gun = new THREE.Group();
  // long receiver with a feed cover on top, carry handle
  add(gun, rbox(0.05, 0.068, 0.34, 0.006), dark, 0, 0.026, 0.1);
  add(gun, rbox(0.052, 0.018, 0.16, 0.005), olive, 0, 0.068, 0.07);                 // feed cover
  add(gun, rbox(0.012, 0.03, 0.1, 0.004), dark, 0, 0.1, 0.2);                       // carry handle
  add(gun, rbox(0.012, 0.026, 0.012, 0.003), dark, 0, 0.078, 0.16);
  add(gun, rbox(0.012, 0.026, 0.012, 0.003), dark, 0, 0.078, 0.245);
  // pistol grip, guard, trigger
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT; grip.position.set(0, 0.0, -0.008);
  gun.add(grip);
  add(grip, rbox(0.03, 0.1, 0.045, 0.006), polymer, 0, -0.05, 0);
  add(gun, rbox(0.006, 0.004, 0.065, 0.001), dark, 0, -0.022, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.01, 0.032, 0.25);
  // heavy barrel with a shroud, flash hider, front post; the bipod folded under it
  add(gun, rbox(0.05, 0.05, 0.2, 0.01), dark, 0, 0.03, 0.37);
  for (let i = 0; i < 5; i++) add(gun, rbox(0.052, 0.012, 0.018, 0.003), polymer, 0, 0.045, 0.3 + i * 0.035);
  add(gun, cyl(0.013, 0.36), steel, 0, 0.03, 0.62, Math.PI / 2);
  add(gun, cyl(0.017, 0.06), dark, 0, 0.03, 0.82, Math.PI / 2);
  add(gun, rbox(0.01, 0.05, 0.012, 0.002), dark, 0, 0.058, 0.76);
  for (const x of [1, -1]) add(gun, cyl(0.005, 0.24), steel, x * 0.012, 0.0, 0.62, Math.PI / 2 - 0.05);
  add(gun, rbox(0.04, 0.012, 0.02, 0.003), dark, 0, 0.005, 0.5);
  // skeleton stock
  add(gun, rbox(0.04, 0.03, 0.22, 0.006), polymer, 0, 0.034, -0.14);
  add(gun, rbox(0.036, 0.022, 0.2, 0.006), polymer, 0, -0.03, -0.15, 0.12);
  add(gun, rbox(0.042, 0.11, 0.022, 0.006), dark, 0, 0.0, -0.26);
  // charging handle (the "slide")
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.03, 0.012, 0.016, 0.003), steel, -0.03, 0.03, 0.2);
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.008, 0.12);
  gun.add(magWell);
  magWell.add(buildMGMag());
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag: magWell.children[0], magWell };
}

export function buildDMR() {
  const gun = new THREE.Group();
  // receiver, rail, and a long free-float handguard
  add(gun, rbox(0.034, 0.054, 0.26, 0.004), dark, 0, 0.022, 0.06);
  add(gun, rbox(0.03, 0.012, 0.5, 0.003), steel, 0, 0.055, 0.18);
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT; grip.position.set(0, 0.002, -0.008);
  gun.add(grip);
  add(grip, rbox(0.028, 0.095, 0.042, 0.006), tan, 0, -0.048, 0);
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.02, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.008, 0.032, 0.25);
  add(gun, rbox(0.046, 0.05, 0.34, 0.012), tan, 0, 0.024, 0.36);
  add(gun, cyl(0.01, 0.3), steel, 0, 0.03, 0.66, Math.PI / 2);
  add(gun, cyl(0.016, 0.07), dark, 0, 0.03, 0.83, Math.PI / 2);                    // muzzle brake
  // fixed stock with a cheek rest
  add(gun, cyl(0.016, 0.12), dark, 0, 0.03, -0.1, Math.PI / 2);
  add(gun, rbox(0.036, 0.085, 0.16, 0.008), tan, 0, 0.012, -0.22);
  add(gun, rbox(0.03, 0.02, 0.1, 0.006), tan, 0, 0.064, -0.2);
  add(gun, rbox(0.038, 0.096, 0.02, 0.006), dark, 0, 0.01, -0.305);
  scope(gun, 0.092, -0.04, 0.2, 0.017);
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.003, 0.014, 0.05, 0.001), steel, -0.018, 0.032, 0.09);
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.004, 0.085);
  gun.add(magWell);
  magWell.add(buildDMRMag());
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag: magWell.children[0], magWell };
}

export function buildSniper() {
  const gun = new THREE.Group();
  // one-piece stock: thumbhole grip behind, long forend, the barrel floating over it
  const stock = new THREE.Group();
  gun.add(stock);
  add(stock, rbox(0.042, 0.06, 0.5, 0.014), olive, 0, 0.004, 0.25);                // forend
  add(stock, rbox(0.04, 0.05, 0.12, 0.012), olive, 0, 0.0, -0.02);                 // wrist
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT; grip.position.set(0, 0.0, -0.01);
  stock.add(grip);
  add(grip, rbox(0.03, 0.095, 0.045, 0.01), olive, 0, -0.048, 0);
  add(stock, rbox(0.04, 0.11, 0.22, 0.012), olive, 0, -0.008, -0.18);              // butt
  add(stock, rbox(0.032, 0.025, 0.12, 0.008), olive, 0, 0.056, -0.17);             // cheek piece
  add(stock, rbox(0.042, 0.12, 0.02, 0.006), dark, 0, -0.008, -0.3);
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.024, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.012, 0.032, 0.25);
  // round action, heavy fluted barrel, suppressor-sized brake
  add(gun, cyl(0.018, 0.2), steel, 0, 0.042, 0.09, Math.PI / 2);
  add(gun, new THREE.CylinderGeometry(0.009, 0.013, 0.6, 12), steel, 0, 0.042, 0.49, -Math.PI / 2);
  add(gun, cyl(0.016, 0.08), dark, 0, 0.042, 0.83, Math.PI / 2);
  // bipod legs folded along the forend
  for (const x of [1, -1]) add(gun, cyl(0.005, 0.2), steel, x * 0.014, -0.03, 0.4, Math.PI / 2 + 0.04);
  scope(gun, 0.1, -0.05, 0.25, 0.022);
  // the bolt handle (the "slide": it's worked back after every shot)
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, cyl(0.004, 0.05, 8), steel, -0.03, 0.03, 0.02).rotation.set(0, 0, Math.PI / 2 - 0.4);
  add(slide, new THREE.SphereGeometry(0.009, 10, 8), dark, -0.055, 0.02, 0.02);
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.022, 0.08);
  gun.add(magWell);
  magWell.add(buildSniperMag());
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag: magWell.children[0], magWell };
}

// ---- launchers ----
// the rocket's warhead is the "magazine": it sits in the front of the tube, pointing out along
// the magazine's -Y (the well is turned so that's the muzzle's +Z); fired, it's gone
export const ROCKET_MAG_LEN = 0.2;
export function buildRocketMag(rounds = true) {
  const g = new THREE.Group();
  if (!rounds) return g;
  add(g, cyl(0.036, 0.06, 12), olive, 0, -0.03, 0);
  add(g, new THREE.ConeGeometry(0.042, 0.14, 12), olive, 0, -0.13, 0, Math.PI);
  add(g, cyl(0.008, 0.02, 8), dark, 0, -0.205, 0);
  return g;
}
export function buildRocketLauncher() {
  const gun = new THREE.Group();
  const Y = 0.1;
  // the tube, flared at the back; a pistol grip and a fore grip under it
  add(gun, cyl(0.042, 0.95, 16), olive, 0, Y, 0.08, Math.PI / 2);
  add(gun, new THREE.CylinderGeometry(0.058, 0.044, 0.1, 16, 1, true), dark, 0, Y, -0.44, Math.PI / 2);
  add(gun, cyl(0.046, 0.03, 16), dark, 0, Y, 0.54, Math.PI / 2);
  for (const z of [-0.2, 0.3]) add(gun, cyl(0.046, 0.02, 16), dark, 0, Y, z, Math.PI / 2);
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT; grip.position.set(0, 0.0, -0.008);
  gun.add(grip);
  add(grip, rbox(0.03, 0.1, 0.045, 0.006), polymer, 0, -0.045, 0);
  add(gun, rbox(0.03, 0.05, 0.08, 0.006), dark, 0, 0.045, 0.02);
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.018, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.008, 0.032, 0.25);
  add(gun, rbox(0.028, 0.09, 0.035, 0.006), polymer, 0, 0.02, 0.28);
  // the sight, up on the left
  add(gun, rbox(0.03, 0.05, 0.1, 0.004), dark, 0.05, Y + 0.04, 0.12);
  add(gun, cyl(0.012, 0.004, 10), glass, 0.05, Y + 0.05, 0.172, Math.PI / 2);
  const slide = new THREE.Group();
  gun.add(slide);
  const magWell = new THREE.Group();
  magWell.position.set(0, Y, 0.55);
  magWell.rotation.x = -Math.PI / 2;
  gun.add(magWell);
  magWell.add(buildRocketMag());
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag: magWell.children[0], magWell };
}
/** A pump-action 40 mm launcher: a fat barrel over a tube, a stock, loaded like the shotgun. */
export function buildGrenadeLauncher() {
  const gun = new THREE.Group();
  add(gun, rbox(0.044, 0.064, 0.2, 0.006), olive, 0, 0.024, 0.07);
  add(gun, rbox(0.006, 0.004, 0.06, 0.001), dark, 0, -0.022, 0.04);
  add(gun, rbox(0.007, 0.02, 0.006, 0.002), dark, 0, -0.01, 0.032, 0.25);
  const grip = new THREE.Group();
  grip.rotation.x = GRIP_TILT; grip.position.set(0, 0.0, -0.008);
  gun.add(grip);
  add(grip, rbox(0.03, 0.095, 0.044, 0.006), polymer, 0, -0.045, 0);
  add(gun, cyl(0.014, 0.16), dark, 0, 0.03, -0.12, Math.PI / 2);
  add(gun, rbox(0.04, 0.1, 0.03, 0.008), polymer, 0, 0.0, -0.21);
  // the fat barrel, a muzzle ring, a ladder sight
  add(gun, cyl(0.026, 0.42), dark, 0, 0.044, 0.38, Math.PI / 2);
  add(gun, cyl(0.03, 0.03, 16), olive, 0, 0.044, 0.58, Math.PI / 2);
  add(gun, cyl(0.011, 0.34), dark, 0, 0.0, 0.33, Math.PI / 2);
  add(gun, rbox(0.03, 0.04, 0.012, 0.002), steel, 0, 0.085, 0.16);
  const slide = new THREE.Group();
  gun.add(slide);
  add(slide, rbox(0.05, 0.046, 0.16, 0.012), polymer, 0, 0.008, 0.33);
  for (let i = 0; i < 5; i++) add(slide, new THREE.BoxGeometry(0.052, 0.003, 0.004), dark, 0, 0.01, 0.28 + i * 0.024);
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.006, 0.09);
  gun.add(magWell);
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { gun, slide, mag: null, magWell };
}

const BUILDERS = { rocket: buildRocketLauncher, gl: buildGrenadeLauncher, rifle: buildRifle, smg: buildSMG, shotgun: buildShotgun, mg: buildMG, dmr: buildDMR, sniper: buildSniper,
  deagle: buildDeagle, m1911: buildM1911, ak47: buildAK47, ak74: buildAK74 };
export function buildGun(type) {
  const parts = (BUILDERS[type] || buildPistol)();
  mergeParts(parts.gun);
  return parts;
}

/**
 * Every bit of a gun that moves together, one mesh per material: a detailed gun is dozens of
 * little parts, and each was a draw call of its own (twice over in a headset, once per eye).
 * The groups that move (slide, magazine well, magazine) keep their own merged meshes.
 */
function mergeParts(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (c.isMesh && !c.children.length && c.geometry?.attributes.position) {
      c.updateMatrix();
      let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.applyMatrix4(c.matrix);
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push({ c, geo });
    } else if (!c.isMesh) mergeParts(c);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) { list[0].geo.dispose(); continue; }
    const merged = mergeGeometries(list.map((l) => l.geo), false);
    for (const l of list) l.geo.dispose();
    if (!merged) continue;
    for (const l of list) group.remove(l.c);
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    group.add(m);
  }
}
