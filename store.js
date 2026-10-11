import * as THREE from 'three';
import { fakeLit } from './citystore.js';
import { buildGun } from './gunmodel.js';
import { GUNS } from './gun.js';
import { WEAPONS } from './melee.js';
import { THROWABLES } from './throwables.js';

/*
  The gun store's stock and till: display models in the counter case, price tags, some
  decoration on the pegboard, and "stand in front of it + E" buying. What you buy is handed to
  you straight out of the case (main.js makes the real weapon).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function tagTex(name, price) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#f3ecd8'; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#8a1f1f'; g.lineWidth = 4; g.strokeRect(5, 5, 246, 86);
  g.fillStyle = '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 26px Georgia, serif'; g.fillText(name.toUpperCase(), 128, 32);
  g.fillStyle = '#8a1f1f'; g.font = '700 34px Georgia, serif'; g.fillText(`$${price}`, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Model + pose of a weapon lying on its side on a surface at `at` (turned `yaw`). */
export function lyingPose(type, at, yaw) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, -Math.PI / 2, 'YXZ'));
  // (a gun's origin is its grip: slide a long gun along so it lies centred on the spot)
  if (GUNS[type]) return { pos: at.clone().setY(at.y + GUNS[type].lie).sub(GUNS[type].offset.clone().applyQuaternion(q).setY(0)), quat: q };
  const T = THROWABLES[type];
  if (T) {
    const len = T.len ??= T.build().userData.len;
    return { pos: V(at.x, at.y + 0.036, at.z).sub(V(0, len / 2, 0).applyQuaternion(q).setY(0)), quat: q };
  }
  const W = WEAPONS[type];
  const pos = V(at.x, at.y + W.rest, at.z).sub(W.off.clone().applyQuaternion(q).setY(0));
  return { pos, quat: q };
}
const model = (type) => (GUNS[type] ? buildGun(type).gun : THROWABLES[type] ? THROWABLES[type].build() : WEAPONS[type].build());

export class Store {
  constructor(scene, info) {
    this.spots = info.spots;
    this.room = info.room;
    this.el = document.getElementById('prompt');
    // the room's lamp is baked into materials (citystore.js): give the displays their own lit copies
    const litCache = new Map();
    const lit = (o) => {
      if (info.lamp) o.traverse((c) => {
        if (!c.isMesh || !c.material?.isMeshStandardMaterial) return;
        if (!litCache.has(c.material)) litCache.set(c.material, fakeLit(c.material, info.lamp));
        c.material = litCache.get(c.material);
      });
      return o;
    };
    for (const s of this.spots) {
      const m = model(s.type);
      const { pos, quat } = lyingPose(s.type, s.lie, s.type === 'pistol' ? Math.PI / 2 + 0.3 : Math.PI / 2);
      m.position.copy(pos); m.quaternion.copy(quat);
      scene.add(lit(m));
      s.display = m;
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshStandardMaterial({ map: tagTex(s.name, s.price), roughness: 0.8 }));
      tag.position.copy(s.tag);
      scene.add(lit(tag));
    }
    // on the pegboard: pistols hung side-on, blades and bars upright
    const deco = ['pistol', 'machete', 'pistol', 'crowbar', 'pistol', 'bat'];
    info.wallRack.forEach((p, i) => {
      const t = deco[i], m = model(t);
      if (t === 'pistol') { m.position.copy(p).add(V(0, 0, 0.03)); m.rotation.set(0, -Math.PI / 2, 0); }
      else { m.position.copy(p).add(V(0, -0.35, 0.05)); m.rotation.set(0, Math.PI / 2, 0.12 * (i % 2 ? 1 : -1)); }
      scene.add(lit(m));
    });
    this.near = null;
  }

  inside(p) { const r = this.room; return p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1; }

  /** The stock you're standing in front of (or null), and the prompt for it. */
  update(heroPos, canBuy, cash) {
    let best = null, bd = 0.85;
    if (canBuy && this.inside(heroPos)) {
      for (const s of this.spots) {
        const d = Math.hypot(heroPos.x - s.stand.x, heroPos.z - s.stand.z);
        if (d < bd) { bd = d; best = s; }
      }
    }
    this.near = best;
    if (this.el) {
      this.el.classList.toggle('on', !!best);
      if (best) {
        const short = cash < best.price;
        this.el.innerHTML = `<b>E</b> Buy ${best.name} <span class="${short ? 'bad' : ''}">$${best.price}</span>`;
      }
    }
    return best;
  }
}
