import * as THREE from 'three';

/*
  The city lives around the player. People and traffic that drift (or get left) far away, out
  of sight, are taken off and put back somewhere nearer - still out of sight - so the streets
  you're on stay populated: pedestrians rehomed along a pavement, the dead healed and walking
  again elsewhere, a traffic car and its driver back on the road at a fresh stretch of lane.
  Litter and loose debris stream themselves (litter.stream, debris.radius).
*/

const PED_FAR = 105;     // m: a pedestrian further than this is up for recycling
const CAR_FAR = 130;     // a traffic car
const NEAR = 42, FAR = 92; // where the recycled reappear
const SCAN = 0.5;        // s between passes

const _fr = new THREE.Frustum(), _pv = new THREE.Matrix4(), _s = new THREE.Sphere(new THREE.Vector3(), 2);

export class Streamer {
  /** w: { level, npcs, drivers, traffic, vehicles, props, camera, hero, focus() } */
  constructor(w) {
    this.w = w;
    this.t = SCAN;
    this.others = [];
  }

  /** In our view - or near enough another player (multiplayer) that they might be looking. */
  seen(p, r = 2) {
    _s.center.set(p.x, p.y + 1, p.z);
    _s.radius = r;
    if (_fr.intersectsSphere(_s)) return true;
    for (const o of this.others) if (Math.hypot(o.x - p.x, o.z - p.z) < NEAR + r) return true;
    return false;
  }

  /** A pavement point in the ring round the player, out of the camera's view (or null). */
  pedSpot(f) {
    const L = this.w.level;
    for (let i = 0; i < 30; i++) {
      const p = L.npcSpot();
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < NEAR || d > FAR || this.seen(p)) continue;
      if (this.w.npcs.some((n) => n.actor.hero.pos.distanceToSquared(p) < 4)) continue;
      return p;
    }
    return null;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = SCAN;
    const { camera, npcs, drivers, level, hero } = this.w;
    if (!level.npcSpot) return;
    camera.updateMatrixWorld();
    _fr.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // everyone playing keeps the streets round them alive; the recycled come back round one of them
    this.others = this.w.others?.() || [];
    const all = [this.w.focus(), ...this.others];
    const f = all[Math.floor(Math.random() * all.length)];
    const far = (p, R) => all.every((o) => Math.hypot(p.x - o.x, p.z - o.z) > R);
    let moved = 0;
    for (const n of npcs) {
      if (moved >= 2) break; // (a respawn costs a pose solve: spread them out)
      const A = n.actor;
      if (n.car || A.seat || n.convo || A === hero || n.post || n.duty || n.chasing) continue;
      const p = A.mode === 'ragdoll' ? A.state.pos : A.hero.pos;
      if (!far(p, PED_FAR) || this.seen(p)) continue;
      const q = this.pedSpot(f);
      if (!q) continue;
      q.y = level.colliders?.groundAt?.(q.x, q.z, q.y + 0.3) ?? q.y;
      n.home.copy(q);
      n.reset();
      n.cashDropped = false;
      moved++;
    }
    this.cars(f, far);
    this.w.props?.recycle(f, PED_FAR, (p) => this.seen(p));
  }

  /** Traffic out of range: car and driver back on a stretch of lane nearer the player. */
  cars(f, far) {
    const { drivers, traffic, vehicles, hero, level } = this.w;
    if (!traffic) return;
    for (const n of drivers) {
      const car = n.car, A = n.actor;
      if (!car || car.seats.some((s) => s.occ === hero || s.occ?.netId) || this.w.claimed?.(car)) continue;
      // the driver has to be out of the way too (at the wheel, or wandering far off)
      const withCar = A.seat?.car === car;
      if (!far(car.p, CAR_FAR) || this.seen(car.p, 3)) continue;
      if (!withCar && (!far(A.hero.pos, PED_FAR) || this.seen(A.hero.pos) || n.convo)) continue;
      const sp = traffic.spawns(10).find((s) => {
        const d = Math.hypot(s.pos.x - f.x, s.pos.z - f.z);
        return d > NEAR + 8 && d < FAR + 20 && !this.seen(s.pos, 4) && vehicles.cars.every((c) => c === car || c.p.distanceToSquared(s.pos) > 144);
      });
      if (!sp) continue;
      for (const s of car.seats) if (s.occ && s.occ !== A) vehicles.exit(s.occ);
      if (!withCar) { if (A.seat) vehicles.exit(A); n.reset(); }
      car.home = { pos: sp.pos.clone().setY(-0.02), yaw: sp.yaw };
      car.spawn = sp;
      car.reset();
      if (!withCar) { vehicles.enter(A, car, 0); A.postSnap = null; }
      traffic.attach(car, sp);
      n.home.copy(level.npcSpot());
      return; // one per pass
    }
  }
}
