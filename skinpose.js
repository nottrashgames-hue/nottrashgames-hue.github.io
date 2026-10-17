import * as THREE from 'three';

/*
  Fast bulk skinning on the CPU: where every vertex of a skinned mesh is in its current pose
  (mesh-local) - the same arithmetic as three's SkinnedMesh.applyBoneTransform, operation for
  operation, so the result is identical, but with each bone's matrix worked out once per call
  instead of once per vertex per influence, and no per-vertex objects.
*/

const _bm = new THREE.Matrix4();

// v' = v.applyMatrix4(e) (three's own formula, w divide included), from (x, y, z) into o[k..k+2]
function apply(e, x, y, z, o, k) {
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
  o[k] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  o[k + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  o[k + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
}

/** Each bone's skinning matrix (bone.matrixWorld x its inverse), as arrays, for this call. */
function boneMats(m) {
  const { bones, boneInverses } = m.skeleton;
  return bones.map((b, i) => _bm.multiplyMatrices(b.matrixWorld, boneInverses[i]).elements.slice());
}

/**
 * Posed positions of m's geometry (Float32Array, mesh-local) - and, with normals, the posed
 * normals as slice.js has always taken them: the point 1 cm out along the normal, posed, minus
 * the posed point, normalised.
 */
export function posePositions(m, normals = false) {
  const geo = m.geometry, P = geo.attributes.position, N = normals ? geo.attributes.normal : null;
  const SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const n = P.count, pp = new Float32Array(n * 3), pn = N ? new Float32Array(n * 3) : null;
  const B = boneMats(m), bind = m.bindMatrix.elements, inv = m.bindMatrixInverse.elements;
  const base = [0, 0, 0], t = [0, 0, 0], acc = [0, 0, 0], res = [0, 0, 0];
  const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0];
  // one point through the skinning (applyBoneTransform), into res
  const pose = (x, y, z) => {
    apply(bind, x, y, z, base, 0);
    acc[0] = acc[1] = acc[2] = 0;
    for (let j = 0; j < 4; j++) {
      const w = wt[j];
      if (w === 0) continue;
      apply(B[idx[j]], base[0], base[1], base[2], t, 0);
      acc[0] += t[0] * w; acc[1] += t[1] * w; acc[2] += t[2] * w;
    }
    apply(inv, acc[0], acc[1], acc[2], res, 0);
  };
  for (let i = 0; i < n; i++) {
    idx[0] = SI.getX(i); idx[1] = SI.getY(i); idx[2] = SI.getZ(i); idx[3] = SI.getW(i);
    wt[0] = SW.getX(i); wt[1] = SW.getY(i); wt[2] = SW.getZ(i); wt[3] = SW.getW(i);
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    pose(x, y, z);
    const ax = res[0], ay = res[1], az = res[2];
    pp[i * 3] = ax; pp[i * 3 + 1] = ay; pp[i * 3 + 2] = az;
    if (pn) {
      // (b = n * 0.01 + a, as Vector3 multiplyScalar then add)
      pose(N.getX(i) * 0.01 + x, N.getY(i) * 0.01 + y, N.getZ(i) * 0.01 + z);
      const dx = res[0] - ax, dy = res[1] - ay, dz = res[2] - az;
      const k = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
      pn[i * 3] = dx * k; pn[i * 3 + 1] = dy * k; pn[i * 3 + 2] = dz * k;
    }
  }
  return { pp, pn };
}
