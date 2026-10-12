import RAPIER from '@dimforge/rapier3d-compat';

export const G_WORLD = 1;
export const G_PROXY = 128;      // kinematic capsules standing in for animated characters
export const G_BODY = 2 | 4 | 8 | 16 | 32 | 64; // all ragdoll part categories
export const G_QUERY = 0x8000;  // scene queries (rays, grab probes)
export const G_DEBRIS = 256;     // casings, magazines, dropped guns (world, cars + each other only)
export const G_CAR = 512;        // vehicle chassis
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

let ready = null;
export function initRapier() {
  return (ready ||= RAPIER.init().then(() => RAPIER));
}

/** Rapier world with the static level geometry. */
export function createPhysics(solids = []) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 240;
  world.integrationParameters.numSolverIterations = 8;

  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (desc) => {
    desc.setFriction(0.9).setRestitution(0.02).setCollisionGroups(groups(G_WORLD, 0xffff));
    return world.createCollider(desc, staticBody);
  };
  world.groundCollider = add(RAPIER.ColliderDesc.cuboid(440, 0.5, 440).setTranslation(0, -0.5, 0));
  world.levelStatic = { body: staticBody, add, cols: [] };
  // colliders that the camera can't pass through (walls, buildings)
  world.camBlockers = new Set();
  setLevelSolids(world, solids);
  return { world, RAPIER };
}

/** The level's static geometry in the world: whatever was there before goes (switching maps in place). */
export function setLevelSolids(world, solids = []) {
  const S = world.levelStatic;
  for (const c of S.cols) world.removeCollider(c, false);
  S.cols.length = 0;
  world.camBlockers.clear();
  // (the ragdolls' cached list of static colliders - ragdoll.js depenetrate - is stale now: touching
  // a removed collider panics Rapier, and every physics call after that fails: the game froze)
  world._staticBounds = null;
  world._staticGen = (world._staticGen || 0) + 1;
  for (const s of solids) {
    const c = s.type === 'box'
      ? S.add(RAPIER.ColliderDesc.cuboid(s.w / 2, s.h / 2, s.d / 2).setTranslation(s.x, s.y, s.z))
      : S.add(RAPIER.ColliderDesc.cylinder(s.h / 2, s.r).setTranslation(s.x, s.y, s.z));
    S.cols.push(c);
    if (s.cam) world.camBlockers.add(c.handle);
  }
}
