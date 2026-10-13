import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { groups, G_WORLD, G_BODY, G_QUERY, G_CAR } from './physics.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const RANGE = 120;
const REACH = 2.2; // m: no part of a body is further than this from its pelvis
const _c = V(), _d = V();

// bullet hole: dark core, scorched soft ring
const holeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(10,10,10,1)');
  r.addColorStop(0.18, 'rgba(15,14,13,1)');
  r.addColorStop(0.3, 'rgba(40,36,32,0.7)');
  r.addColorStop(1, 'rgba(40,36,32,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const holeMat = new THREE.MeshStandardMaterial({
  map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9,
});
const dustMat = new THREE.MeshBasicMaterial({ color: 0xcfc6b8, transparent: true, depthWrite: false });
const dustGeo = new THREE.SphereGeometry(1, 6, 4);

export class Shots {
  constructor(scene, world, RAPIER, actors, sfx) {
    this.scene = scene;
    this.world = world;
    this.R = RAPIER;
    this.actors = actors;
    this.sfx = sfx;
    this.rc = new THREE.Raycaster();
    // every layer: a VR player's own body is drawn on a layer of its own (vr.js hideBody), and
    // it still has to be hittable
    this.rc.layers.enableAll();
    this.holes = [];
    this.puffs = [];
    // rapier body handle -> { actor, part }
    this.partOf = new Map();
    // three mesh -> { actor, part } for people on their feet
    this.meshOf = new Map();
    for (const a of actors) this.register(a);
    // world meshes to put holes in (static level geometry)
    this.worldMeshes = [];
    scene.traverse((o) => { if (o.isMesh && !this.meshOf.has(o) && o.geometry?.type?.match(/Box|Cylinder|Plane/)) this.worldMeshes.push(o); });
  }

  /** Someone new who can be shot (people joining later: other players). */
  register(a) {
    for (const n of a.rd.names) this.partOf.set(a.rd.parts[n].body.handle, { actor: a, part: n });
    for (const [n, p] of Object.entries(a.wounds.parts)) for (const m of p.meshes) this.meshOf.set(m, { actor: a, part: n });
  }

  /** What's under a ray (for the crosshair aim point): world, ragdolls and people, not `self`. */
  pick(origin, dir, self, range = RANGE) {
    const R = this.R;
    const ray = new R.Ray(origin, dir);
    const exclude = (c) => {
      const b = c.parent();
      if (!b) return true;
      const o = this.partOf.get(b.handle);
      return !(o && o.actor === self);
    };
    let best = null;
    const hit = this.world.castRayAndGetNormal(ray, range, true, undefined, groups(G_QUERY, G_WORLD | G_BODY | G_CAR), undefined, undefined, exclude);
    if (hit) {
      const t = hit.timeOfImpact ?? hit.toi;
      const b = hit.collider.parent();
      const o = b && this.partOf.get(b.handle);
      best = {
        t, point: origin.clone().addScaledVector(dir, t), normal: V(hit.normal.x, hit.normal.y, hit.normal.z),
        actor: o?.actor || null, part: o?.part || null, body: b,
      };
    }
    // people on their feet: exact mesh hits
    this.rc.set(origin, dir);
    this.rc.far = best ? best.t : range;
    const meshes = this._meshes || (this._meshes = []);
    meshes.length = 0;
    // mesh -> { actor, part }, gathered from the wounds' current lists (a cut swaps in stump
    // meshes that were never registered: a sliced puppet in MP still stands and gets tested)
    const seen = this._seen || (this._seen = new Map());
    seen.clear();
    const cast = this.rc.ray, far = this.rc.far;
    for (const a of this.actors) {
      if (a === self || a.mode === 'ragdoll') continue;
      // nobody the ray can't come within reach of (every part of a body is within
      // REACH of its pelvis) needs mesh tests
      const c = a.hero.hips.getWorldPosition(_c);
      const t = _d.subVectors(c, cast.origin).dot(cast.direction);
      if (t < -REACH || t > far + REACH || cast.distanceSqToPoint(c) > REACH * REACH) continue;
      for (const n in a.wounds.parts) for (const m of a.wounds.parts[n].meshes) if (!seen.has(m)) { seen.set(m, this.meshOf.get(m) || { actor: a, part: n }); meshes.push(m); }
    }
    const mh = meshes.length ? this.rc.intersectObjects(meshes, false)[0] : null;
    if (mh) {
      const o = seen.get(mh.object);
      const part = mh.object.isSkinnedMesh ? o.actor.wounds.torsoPart(mh.point) : o.part;
      best = { t: mh.distance, point: mh.point.clone(), normal: mh.face.normal.clone().transformDirection(mh.object.matrixWorld), actor: o.actor, part };
    }
    return best;
  }

  /** A round leaves `origin` along `dir`, fired by `shooter`. */
  fire(origin, dir, shooter, visual = false, range = RANGE) {
    const hit = this.pick(origin, dir, shooter, range);
    if (!hit) return null;
    if (hit.actor) {
      // someone else's shot, replayed for the look of it: their client lands the hit
      if (!visual) hit.actor.shot(hit.part, hit.point, dir, this.weapon || null);
      this.sfx?.('flesh', 0.8);
    } else {
      // anything loose it hits (a bin, a chair) takes the round's push - and wakes up
      if (hit.body?.isDynamic()) hit.body.applyImpulseAtPoint({ x: dir.x * 2.5, y: dir.y * 2.5, z: dir.z * 2.5 }, hit.point, true);
      this.hole(hit.point, hit.normal, origin);
      this.sfx?.('impact', 0.55);
    }
    return hit;
  }

  hole(p, n, from) {
    // a small dust puff kicked back out of the surface
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(dustGeo, dustMat.clone());
      m.position.copy(p).addScaledVector(n, 0.01);
      m.scale.setScalar(rnd(0.01, 0.02));
      const v = n.clone().multiplyScalar(rnd(0.6, 1.6)).add(V(rnd(-0.5, 0.5), rnd(-0.2, 0.6), rnd(-0.5, 0.5)));
      this.scene.add(m);
      this.puffs.push({ m, v, t: 0 });
    }
    // decal into whatever level mesh is right there
    this.rc.set(p.clone().addScaledVector(n, 0.05), n.clone().negate());
    this.rc.far = 0.1;
    const h = this.rc.intersectObjects(this.worldMeshes, false)[0];
    if (!h) return;
    let target = h.object;
    if (target.isInstancedMesh) {
      // decal against just the instance that was hit
      const one = new THREE.Mesh(target.geometry);
      target.getMatrixAt(h.instanceId, one.matrixWorld);
      one.matrixWorld.premultiply(target.matrixWorld);
      target = one;
    }
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    const e = new THREE.Euler().setFromQuaternion(q);
    e.z = Math.random() * Math.PI * 2;
    const s = rnd(0.035, 0.05);
    const geo = new DecalGeometry(target, h.point, e, V(s, s, 0.05));
    if (!geo.attributes.position?.count) { geo.dispose(); return; }
    const m = new THREE.Mesh(geo, holeMat);
    m.renderOrder = 1;
    m.receiveShadow = true;
    this.scene.add(m);
    this.holes.push(m);
    if (this.holes.length > 80) { const o = this.holes.shift(); o.removeFromParent(); o.geometry.dispose(); }
  }

  /** Bullet holes and dust gone. */
  clear() {
    for (const m of this.holes) { m.removeFromParent(); m.geometry.dispose(); }
    for (const P of this.puffs) { P.m.removeFromParent(); P.m.material.dispose(); }
    this.holes.length = this.puffs.length = 0;
  }

  update(dt) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const P = this.puffs[i];
      P.t += dt;
      P.v.multiplyScalar(Math.exp(-4 * dt));
      P.v.y += 0.3 * dt;
      P.m.position.addScaledVector(P.v, dt);
      P.m.scale.multiplyScalar(1 + dt * 2.5);
      P.m.material.opacity = 0.55 * Math.max(0, 1 - P.t / 0.7);
      if (P.t > 0.7) { P.m.removeFromParent(); P.m.material.dispose(); this.puffs.splice(i, 1); }
    }
  }
}
