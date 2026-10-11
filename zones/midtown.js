import * as THREE from 'three';
import { Frame } from '../cityprops.js';
import { BOX, CYL, PLANE, worldMat } from '../cityparts.js';
import { gable } from './kit.js';

/*
  Midtown: the newer city blocks west of downtown, none of it brick walk-ups or stucco shops -
  art-deco setback towers, a parking garage, a stone church with a spire, a chrome diner with
  its car park, a cinema with a lit marquee, a fenced basketball court and a balcony slab of
  apartments. Each building sits in a slot across the block, in a Frame whose +u faces the
  main street between the two blocks.
*/

let mats = null;
function materials(ctx) {
  if (mats) return mats;
  const { env, batch, signTex, tex } = ctx;
  const neon = (text, bg, fg) => {
    const t = signTex(text, bg, fg);
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.5 });
  };
  const chain = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.strokeStyle = '#b8bcc0'; g.lineWidth = 2.2;
    for (let i = -256; i < 512; i += 12) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 256, 256); g.stroke();
      g.beginPath(); g.moveTo(i + 256, 0); g.lineTo(i, 256); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const vsign = (text, bg, fg) => {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96 * text.length;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = fg; g.font = '700 74px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...text].forEach((ch, i) => g.fillText(ch, 48, 96 * i + 52));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.1, roughness: 0.5 });
  };
  mats = {
    steel: batch('mtSteel', BOX, new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.9, roughness: 0.22, envMap: env, envMapIntensity: 1.2 })),
    steelC: batch('mtSteelC', CYL, new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.9, roughness: 0.22, envMap: env, envMapIntensity: 1.2 })),
    dark: batch('mtDark', BOX, new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9 })),
    chain: batch('mtChain', BOX, new THREE.MeshStandardMaterial({ map: chain, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 }), { cast: false }),
    court: batch('mtCourt', PLANE, new THREE.MeshStandardMaterial({ roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { cast: false }),
    lawn: batch('mtLawn', PLANE, Object.assign(worldMat({ map: tex.grass, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, 1 / 4), {}), { cast: false }),
    diner: batch('mtDiner', BOX, neon('DINER', '#1b1b1b', '#ff4f6d')),
    marquee: batch('mtMarquee', BOX, neon('NOW SHOWING', '#f3ecd8', '#1b1b1b')),
    parking: batch('mtParking', BOX, neon('PARKING', '#1f4f9a', '#ffffff')),
    cinema: batch('mtCinema', BOX, vsign('CINEMA', '#7a1616', '#ffd76a')),
    poster: ['#2a3f7a', '#7a2a4a', '#1f5a4a', '#8a5a1a'].map((c, i) => batch('mtPoster' + i, BOX, neon(['SPACE', 'ROMANCE', 'HEIST', 'WESTERN'][i], c, '#f5f0e0'))),
  };
  return mats;
}

export function buildMidtown(block, ctx) {
  const T = materials(ctx);
  const I = block.inner;
  const D = I.z1 - I.z0, cz = (I.z0 + I.z1) / 2;
  // the main street runs between the two midtown blocks: fronts face it
  const north = block.j === 1, yaw = north ? 0 : Math.PI;
  const slots = north
    ? [['church', 34], ['court', 28], ['deco', 34], ['apartments', 0]]
    : [['diner', 26], ['cinema', 28], ['deco', 34], ['garage', 0]];
  let x = I.x1;
  for (const [kind, w0] of slots) {
    const w = w0 || x - I.x0;
    const cx = x - w / 2;
    const F = new Frame(ctx.kit, cx, cz, yaw, 0);
    BUILD[kind](F, w, D, ctx, T, north);
    x -= w;
  }
}

const solid = (F, u0, u1, v0, v1, top) => { F.walk(u0, u1, v0, v1, top); F.phys(u0, u1, 0, top, v0, v1, { cam: true }); };

/** Glass skin with stone piers and spandrels round a box (u0..u1 x v0..v1, y0..y1). */
function skin(F, ctx, r, y0, y1, pier, pierCol, glassCol, floorH = 3.4) {
  const { B } = ctx;
  const d = r.u1 - r.u0, w = r.v1 - r.v0, cu = (r.u0 + r.u1) / 2, cv = (r.v0 + r.v1) / 2, h = y1 - y0, ym = (y0 + y1) / 2;
  F.put(B.glass, cu, ym, cv, d + 0.04, h - 0.4, w + 0.04, glassCol);
  const faces = [
    [w, (t) => [r.u1 + 0.12, cv + t], 'u'], [w, (t) => [r.u0 - 0.12, cv + t], 'u'],
    [d, (t) => [cu + t, r.v1 + 0.12], 'v'], [d, (t) => [cu + t, r.v0 - 0.12], 'v'],
  ];
  for (const [L, at, ax] of faces) {
    const n = Math.max(2, Math.round(L / pier));
    for (let i = 0; i <= n; i++) {
      const [u, v] = at(-L / 2 + (L * i) / n);
      F.put(B.trim, u, ym, v, ax === 'u' ? 0.3 : 0.36, h, ax === 'u' ? 0.36 : 0.3, pierCol);
    }
    for (let y = y0 + floorH; y < y1 - 0.5; y += floorH) {
      const [u, v] = at(0);
      F.put(B.conc, u, y, v, ax === 'u' ? 0.16 : L, 0.7, ax === 'u' ? L : 0.16, pierCol);
    }
  }
  F.put(B.trim, cu, y1 - 0.2, cv, d + 0.5, 0.45, w + 0.5, pierCol);
}

const BUILD = {
  // ------------------------------------------------ art-deco setback tower
  deco(F, W, D, ctx, T, north) {
    const { B, R } = ctx;
    const stone = north ? 0xd8cdb4 : 0xc9c2b8, pier = north ? 0xe8dfc8 : 0xdad4ca, glass = north ? 0x3a4a58 : 0x46505a;
    const h = north ? R.range(70, 80) : R.range(56, 64);
    const fw = W - 4, fd = Math.min(D - 8, 30);
    const u1 = D / 2 - 5, u0 = u1 - fd;
    const tiers = [[0, 14, 0], [14, h * 0.62, 2.2], [h * 0.62, h * 0.8, 4.6], [h * 0.8, h * 0.92, 7.2]];
    for (const [y0, y1, inset] of tiers) {
      const r = { u0: u0 + inset, u1: u1 - inset, v0: -fw / 2 + inset, v1: fw / 2 - inset };
      F.put(B.conc, (r.u0 + r.u1) / 2, (y0 + y1) / 2, 0, r.u1 - r.u0, y1 - y0, r.v1 - r.v0, stone);
      if (y0 === 0) {
        // the base: tall stone piers and big windows, a portal in the middle
        for (let i = 0; i <= 8; i++) F.put(B.trim, r.u1 + 0.15, 7, r.v0 + (fw * i) / 8, 0.4, 14, 0.9, pier);
        F.put(B.glass, r.u1 + 0.03, 5.5, 0, 0.04, 9, fw - 1, glass);
        F.put(B.trim, r.u1 + 0.3, 12.8, 0, 0.8, 1.2, fw + 0.6, pier);
        F.put(B.trim, r.u1 + 0.5, 5.2, 0, 1, 10.4, 7, stone);
        F.put(B.glass, r.u1 + 1.02, 3.2, 0, 0.04, 5.6, 4.6, 0xb7c6cf);
        F.put(B.metal, r.u1 + 1.04, 3.2, 0, 0.05, 5.6, 0.1, 0x8a7a4a);
        F.put(B.metal, r.u1 + 1.04, 5.9, 0, 0.05, 0.1, 4.6, 0x8a7a4a);
        // sunburst over the portal
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI / 2 + ((k + 0.5) / 7) * Math.PI;
          F.put(B.metal, r.u1 + 1.05, 7.6 + Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.04, 1.6, 0.14, 0xc9a13a, 0, -a);
        }
        F.put(B.metal, r.u1 + 2.2, 6.6, 0, 3.4, 0.25, 8, 0x2a2622);
        F.put(ctx.B.lamp, r.u1 + 2.2, 6.46, 0, 3, 0.03, 7.4);
      } else skin(F, ctx, r, y0, y1, 1.8, pier, glass);
    }
    // crown: stepped fins and a mast
    let y = h * 0.92, s = fw - 16;
    for (let k = 0; k < 3; k++) {
      const th = (h - y) / (3 - k) * 0.6;
      F.put(B.trim, (u0 + u1) / 2, y + th / 2, 0, Math.max(2, s * 0.9), th, Math.max(2, s), pier);
      y += th; s *= 0.62;
    }
    F.put(B.metalC, (u0 + u1) / 2, y + 7, 0, 0.35, 14, 0.35, 0x9aa0a4);
    F.put(B.lamp, (u0 + u1) / 2, y + 14.1, 0, 0.5, 0.3, 0.5, 0xff8866);
    solid(F, u0, u1, -fw / 2, fw / 2, 14);
    F.phys(u0 + 2.2, u1 - 2.2, 14, h, -fw / 2 + 2.2, fw / 2 - 2.2, { cam: true });
    // forecourt: granite paving strip, two flagpoles, planters
    const pu = u1 + 0.1;
    for (const sv of [-1, 1]) {
      const v = sv * (fw / 2 - 2);
      F.put(B.metalC, pu + 3, 5, v, 0.14, 10, 0.14, 0xcfd3d6);
      F.put(ctx.B.fabric, pu + 3, 9, v + sv * 0.8, 0.02, 1, 1.5, sv < 0 ? 0x2a4d8f : 0xb0302a);
      ctx.solidCyl(...F.p(pu + 3, v), 0.1, 10);
      F.put(B.trim, pu + 2.2, 0.35, v - sv * 5, 1.4, 0.7, 3, 0xb5aca0);
      for (const b of [ctx.B.shrubNear, ctx.B.shrubFar]) F.put(b, pu + 2.2, 0.85, v - sv * 5, 1.2, 0.6, 2.8, 0x4f7a3a);
      F.walk(pu + 1.5, pu + 2.9, v - sv * 5 - 1.5, v - sv * 5 + 1.5, 0.7);
      F.phys(pu + 1.5, pu + 2.9, 0, 0.7, v - sv * 5 - 1.5, v - sv * 5 + 1.5);
    }
  },

  // ------------------------------------------------ open-deck parking garage
  garage(F, W, D, ctx, T) {
    const { B, R } = ctx;
    const w = W - 2, d = D - 2, levels = 5, LH = 3.1, h = levels * LH + 1.1;
    const u0 = -d / 2, u1 = d / 2, v0 = -w / 2, v1 = w / 2;
    F.put(T.dark, 0, h / 2, 0, d - 0.6, h, w - 0.6, 0x1a1b1d);
    const conc = 0xc7c3bb;
    for (let k = 0; k <= levels; k++) {
      const y = k * LH;
      // slab edge + parapet (the ground level stays open)
      if (k > 0) {
        F.put(B.conc, 0, y + 0.18, 0, d, 0.36, w, conc);
        F.put(B.conc, 0, y + 0.5 + 0.55, 0, d + 0.02, 0.9, w + 0.02, conc);
        F.put(T.dark, 0, y + 0.37, 0, d - 0.3, 0.02, w - 0.3, 0x2c2d2f);
      }
    }
    // columns round the edge
    for (const [L, fixed, along] of [[w, u1, 'v'], [w, u0, 'v'], [d, v1, 'u'], [d, v0, 'u']]) {
      const n = Math.round(L / 7.5);
      for (let i = 0; i <= n; i++) {
        const t = -L / 2 + (L * i) / n;
        const [u, v] = along === 'v' ? [fixed, t] : [t, fixed];
        F.put(B.conc, u, (levels * LH) / 2, v, 0.6, levels * LH, 0.6, conc);
      }
    }
    // stair tower on a corner, entry ramp with a barrier arm, the sign
    F.put(B.stucco, u1 - 2.5, (h + 3) / 2, v0 + 2.5, 5, h + 3, 5, 0x6f7b86);
    F.put(B.glass, u1 + 0.03, (h + 3) / 2, v0 + 2.5, 0.04, h + 1, 1.2, 0x7f92a2);
    F.put(T.parking, u1 + 0.35, 3.9, 4, 0.1, 1.1, 6.5, 0xffffff);
    F.put(B.plain, u1 - 0.8, 0.5, 4, 0.4, 1, 0.4, 0xd8d4c8);
    F.put(B.paint, u1 - 0.8, 1, 4 + 1.8, 0.08, 0.08, 3.4, 0xc0392b);
    F.put(B.plain, u1 - 0.3, 0.01, 4, 6, 0.02, 7, 0x2b2c2e);
    // light poles on the roof
    for (const sv of [-1, 1]) for (const su of [-1, 1]) {
      F.put(B.metalC, su * d * 0.25, h + 2.3, sv * w * 0.25, 0.14, 4.6, 0.14, 0x5a6068);
      F.put(B.lamp, su * d * 0.25, h + 4.6, sv * w * 0.25, 0.8, 0.12, 0.4);
    }
    solid(F, u0, u1, v0, v1, h);
    void R;
  },

  // ------------------------------------------------ stone church and spire
  church(F, W, D, ctx, T) {
    const { B, X, R } = ctx;
    const nw = 14, nl = Math.min(32, D - 10), wh = 11, rise = 7.5;
    const u1 = D / 2 - 6, u0 = u1 - nl, cu = (u0 + u1) / 2;
    const stoneCol = 0xcfc8ba, slate = 0x3e4448;
    // lawn and a path to the doors
    lawn(F, T, -D / 2 + 0.5, D / 2, -W / 2 + 0.5, W / 2 - 0.5);
    court(F, T, u1, D / 2 + 0.2, -1.5, 1.5, 0xbdb6aa);
    F.put(X.stone, cu, wh / 2, 0, nl, wh, nw, stoneCol);
    const [gx, gz] = F.p(cu, 0);
    const G = new Frame(ctx.kit, gx, gz, F.yaw + Math.PI / 2, 0);
    gable(G, { roof: X.roof, gable: X.stoneGable }, 0, 0, nw, nl, wh, rise, stoneCol, slate, 0.5);
    // buttresses and tall windows down both sides
    const bays = Math.floor(nl / 4.4);
    for (let i = 0; i <= bays; i++) {
      const u = u0 + (nl * i) / bays;
      for (const s of [-1, 1]) {
        F.put(X.stone, u, 3.8, s * (nw / 2 + 0.5), 1, 7.6, 1, stoneCol);
        F.put(X.stone, u, 7.9, s * (nw / 2 + 0.35), 0.8, 0.6, 0.7, stoneCol);
        if (i < bays) {
          const wu = u + nl / bays / 2;
          const col = R.pick([0x3a4f8a, 0x8a2a2a, 0xb8902a, 0x2e6b4a]);
          F.put(B.glass, wu, 5.6, s * (nw / 2 + 0.02), 1.3, 5, 0.04, col);
          F.put(B.glass, wu, 8.35, s * (nw / 2 + 0.02), 0.92, 0.92, 0.04, col, Math.PI / 4);
          F.put(B.trimD, wu, 3, s * (nw / 2 + 0.05), 1.7, 0.15, 0.2, 0xe8e2d4);
        }
      }
    }
    // front: rose window, arched doors, steps
    F.put(B.trim, u1 + 0.06, 13.5, 0, 0.14, 3.4, 3.4, 0xe8e2d4);
    F.put(X.disc, u1 + 0.12, 13.5, 0, 3, 0.05, 3, 0x6a3a8a, Math.PI / 2, 0);
    for (let k = 0; k < 8; k++) F.put(B.trimD, u1 + 0.16, 13.5, 0, 0.04, 2.9, 0.1, 0xe8e2d4, 0, (k * Math.PI) / 8);
    F.put(B.trim, u1 + 0.1, 2.3, 0, 0.3, 4.6, 3.6, 0xe8e2d4);
    F.put(B.wood, u1 + 0.28, 2, 0, 0.08, 4, 2.6, 0x5a3520);
    F.put(B.wood, u1 + 0.28, 4.3, 0, 0.08, 1.4, 1.4, 0x5a3520, 0, Math.PI / 4);
    F.put(B.metal, u1 + 0.34, 2, 0, 0.04, 4, 0.06, 0x2a2622);
    for (let k = 0; k < 3; k++) {
      const top = 0.18 * (3 - k);
      F.put(X.stone, u1 + 0.6 + k * 0.45, top / 2, 0, 0.45, top, 5.2 - k * 0.2, 0xd8d2c6);
      F.walk(u1 + 0.38 + k * 0.45, u1 + 0.83 + k * 0.45, -2.6, 2.6, top, { noSeat: true });
    }
    // bell tower on the front corner: belfry openings, spire, cross
    const tv = nw / 2 + 3.2, tu = u1 - 3.5, th = 24;
    F.put(X.stone, tu, th / 2, tv, 7, th, 7, stoneCol);
    for (const y of [8, 15]) F.put(B.trim, tu, y, tv, 7.3, 0.3, 7.3, 0xe8e2d4);
    for (const [du, dv, su, sv] of [[3.52, 0, 0.04, 1.6], [-3.52, 0, 0.04, 1.6], [0, 3.52, 1.6, 0.04], [0, -3.52, 1.6, 0.04]]) {
      F.put(T.dark, tu + du, 20.5, tv + dv, su, 4, sv, 0x151515);
      F.put(B.glass, tu + du * 1.001, 10.5, tv + dv, su, 3, sv, 0x3a4f8a);
    }
    F.put(B.trim, tu, th + 0.2, tv, 7.6, 0.4, 7.6, 0xe8e2d4);
    F.put(X.slate, tu, th + 6.4, tv, 6.4, 12.4, 6.4, slate);
    F.put(B.metal, tu, th + 13.5, tv, 0.14, 2.2, 0.14, 0xc9a13a);
    F.put(B.metal, tu, th + 13.9, tv, 0.14, 0.14, 1.1, 0xc9a13a);
    solid(F, u0, u1, -nw / 2 - 1, nw / 2 + 1, wh + rise);
    solid(F, tu - 3.5, tu + 3.5, tv - 3.5, tv + 3.5, th);
    // a noticeboard and a couple of trees on the lawn
    F.put(B.wood, D / 2 - 2, 0.7, -W / 2 + 5, 0.12, 1.4, 0.12, 0x5a3a24);
    F.put(B.wood, D / 2 - 2, 1.6, -W / 2 + 5, 0.1, 1, 1.8, 0x2a3a2a);
    for (const [u, v] of [[D / 2 - 4, W / 2 - 4], [u0 - 3, -W / 2 + 5], [u0 - 4, W / 2 - 6]]) {
      const [x, z] = F.p(u, v);
      if (ctx.free(x, z, 1.5)) ctx.tree(x, z, 0, 1.2);
    }
  },

  // ------------------------------------------------ chrome diner and its car park
  diner(F, W, D, ctx, T) {
    const { B, R } = ctx;
    const len = 15, dep = 6.6, h = 3.6;
    const cu = D / 2 - 4 - dep / 2, v = -W / 2 + len / 2 + 2;
    // car park surface + bays
    court(F, T, -D / 2 + 0.5, D / 2 - 0.5, -W / 2 + 0.5, W / 2 - 0.5, 0x3d3f43);
    for (let k = 0; k < 6; k++) {
      const bv = W / 2 - 3 - k * 2.8;
      court(F, T, -D / 2 + 2, -D / 2 + 7.5, bv - 0.06, bv + 0.06, 0xe9e7e0);
    }
    // body: chrome shell, rounded ends, a barrel roof
    F.put(T.steel, cu, 0.3 + h / 2, v, dep, h, len - dep, 0xffffff);
    for (const s of [-1, 1]) F.put(T.steelC, cu, 0.3 + h / 2, v + s * (len - dep) / 2, dep, h, dep, 0xffffff);
    F.put(B.plain, cu, 0.15, v, dep + 0.1, 0.3, len + 0.1, 0x8f8a82);
    F.put(T.steelC, cu, 0.3 + h, v, dep * 0.98, len - dep, 1.1, 0xffffff, 0, Math.PI / 2);
    // window band (lit), red stripes
    F.put(B.glass, cu + dep / 2 + 0.01, 2.2, v, 0.04, 1.3, len - dep - 0.6, 0xf0dca0);
    for (let k = 0; k < 7; k++) F.put(B.frame, cu + dep / 2 + 0.04, 2.2, v - (len - dep) / 2 + 0.3 + k * (len - dep - 0.6) / 6, 0.04, 1.3, 0.07, 0xcfd3d6);
    for (const y of [1.2, 3.1]) {
      F.put(B.paint, cu + dep / 2 + 0.02, y, v, 0.04, 0.22, len - dep, 0xc0202e);
    }
    // vestibule and door
    F.put(T.steel, cu + dep / 2 + 1, 1.55, v + 2, 2, 2.5, 2.4, 0xffffff);
    F.put(B.glass, cu + dep / 2 + 2.02, 1.4, v + 2, 0.04, 2.1, 1, 0xb7c6cf);
    F.put(B.conc, cu + dep / 2 + 2.4, 0.1, v + 2, 0.8, 0.2, 2, 0xa8a49b);
    F.walk(cu + dep / 2 + 2, cu + dep / 2 + 2.8, v + 1, v + 3, 0.2, { noSeat: true });
    // neon sign on the roof
    for (const s of [-1, 1]) F.put(B.metal, cu, 0.3 + h + 1, v + s * 2.2, 0.1, 1.6, 0.1, 0x303438);
    F.put(T.diner, cu + 0.1, 0.3 + h + 1.9, v, 0.15, 1.2, 5.6, 0xffffff);
    solid(F, cu - dep / 2, cu + dep / 2, v - len / 2, v + len / 2, 0.3 + h + 0.6);
    solid(F, cu + dep / 2, cu + dep / 2 + 2, v + 0.8, v + 3.2, 2.8);
    // a lamp in the lot
    F.put(B.metalC, -D / 2 + 9, 3.5, W / 2 - 3, 0.16, 7, 0.16, 0x5a6068);
    F.put(B.lamp, -D / 2 + 9, 7, W / 2 - 3, 0.9, 0.12, 0.5);
    ctx.solidCyl(...F.p(-D / 2 + 9, W / 2 - 3), 0.1, 7);
    void R;
  },

  // ------------------------------------------------ cinema with a marquee and blade sign
  cinema(F, W, D, ctx, T) {
    const { B } = ctx;
    const w = W - 2, d = D - 4, h = 13;
    const u1 = D / 2 - 2, u0 = u1 - d;
    const col = 0xe6cfa6, band = 0x7a1616;
    F.put(B.stucco, (u0 + u1) / 2, h / 2, 0, d, h, w, col);
    // stepped deco parapet
    F.put(B.stucco, u1 - 1, h + 1, 0, 2, 2, w * 0.6, col);
    F.put(B.stucco, u1 - 1, h + 2.4, 0, 2, 0.8, w * 0.3, col);
    for (const y of [h - 0.4, 6.2]) F.put(B.paint, u1 + 0.05, y, 0, 0.1, 0.4, w, band);
    for (let i = 0; i < 6; i++) F.put(B.trim, u1 + 0.1, 9.7, -w / 2 + 2 + i * (w - 4) / 5, 0.2, 6.2, 0.5, 0xf2e6cc);
    // marquee: a lit box over the doors, bulbs underneath
    F.put(B.metal, u1 + 1.8, 5.2, 0, 3.6, 0.35, w * 0.7, 0x2a2622);
    F.put(T.marquee, u1 + 3.62, 5.9, 0, 0.08, 1.1, w * 0.62, 0xffffff);
    F.put(B.paint, u1 + 1.8, 5.9, 0, 3.5, 1.2, w * 0.68, 0xf3ecd8);
    for (let k = 0; k < 18; k++) F.put(B.lamp, u1 + 3.5, 5, -w * 0.33 + (k * w * 0.66) / 17, 0.08, 0.08, 0.08, 0xffffff);
    // blade sign up the front corner
    F.put(T.cinema, u1 + 1.2, 9.5, w / 2 - 1.5, 2, 6, 0.3, 0xffffff);
    F.put(B.metal, u1 + 0.3, 9.5, w / 2 - 1.5, 0.6, 0.2, 0.2, 0x303438);
    // glass doors, a box office, posters
    F.put(B.glass, u1 + 0.03, 1.5, 0, 0.04, 2.8, w * 0.5, 0x9fb3c0);
    for (let k = 0; k <= 6; k++) F.put(B.frame, u1 + 0.06, 1.5, -w * 0.25 + (k * w * 0.5) / 6, 0.04, 2.8, 0.07, 0xc9a13a);
    F.put(B.glass, u1 + 1.6, 1.3, 0, 1.4, 2.2, 1.6, 0xb7c6cf);
    F.put(B.paint, u1 + 1.6, 2.5, 0, 1.5, 0.2, 1.7, band);
    F.walk(u1 + 0.9, u1 + 2.3, -0.8, 0.8, 2.6, { noSeat: true });
    F.phys(u1 + 0.9, u1 + 2.3, 0, 2.6, -0.8, 0.8);
    for (let k = 0; k < 4; k++) {
      const pv = (k < 2 ? -1 : 1) * (w * 0.3 + (k % 2) * 2.2);
      F.put(T.poster[k], u1 + 0.08, 2, pv, 0.1, 2.6, 1.6, 0xffffff);
      F.put(B.frame, u1 + 0.05, 2, pv, 0.06, 2.8, 1.8, 0xc9a13a);
    }
    solid(F, u0, u1, -w / 2, w / 2, h + 3);
  },

  // ------------------------------------------------ fenced basketball court
  court(F, W, D, ctx, T) {
    const { B } = ctx;
    const cw = Math.min(16, W - 6), cl = Math.min(28, D - 8);
    const g = 2;
    court(F, T, -cl / 2 - g, cl / 2 + g, -cw / 2 - g, cw / 2 + g, 0x2f5f4a);
    court(F, T, -cl / 2, cl / 2, -cw / 2, cw / 2, 0x3f7a5c);
    const line = (u0, u1, v0, v1) => court(F, T, u0, u1, v0, v1, 0xf2f2f2);
    line(-cl / 2, cl / 2, -cw / 2, -cw / 2 + 0.08); line(-cl / 2, cl / 2, cw / 2 - 0.08, cw / 2);
    line(-cl / 2, -cl / 2 + 0.08, -cw / 2, cw / 2); line(cl / 2 - 0.08, cl / 2, -cw / 2, cw / 2);
    line(-0.04, 0.04, -cw / 2, cw / 2);
    for (const s of [-1, 1]) {
      // key, free-throw line, hoop on a pole
      const e = s * cl / 2;
      line(Math.min(e, e - s * 5.8), Math.max(e, e - s * 5.8), -2.45, -2.37); line(Math.min(e, e - s * 5.8), Math.max(e, e - s * 5.8), 2.37, 2.45);
      line(e - s * 5.8 - 0.04, e - s * 5.8 + 0.04, -2.45, 2.45);
      const pu = e + s * 0.9;
      F.put(B.metalC, pu, 1.7, 0, 0.16, 3.4, 0.16, 0x2b4a6a);
      F.put(B.metal, pu - s * 0.5, 3.35, 0, 1, 0.1, 0.1, 0x2b4a6a);
      F.put(B.plain, e - s * 0.2, 3.45, 0, 0.05, 1.05, 1.8, 0xf4f4f4);
      F.put(B.plain, e - s * 0.18, 3.25, 0, 0.06, 0.45, 0.6, 0xc0392b);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, rr = 0.23;
        F.put(B.paint, e - s * 0.45 + Math.cos(a) * rr, 3.05, Math.sin(a) * rr, 0.18, 0.02, 0.03, 0xe0602a, 0, 0);
      }
      ctx.solidCyl(...F.p(pu, 0), 0.1, 3.4);
    }
    // chain-link fence: posts, top rail and mesh, a gate gap on the front
    const fu = cl / 2 + g, fv = cw / 2 + g, H = 3;
    const run = (ua, va, ub, vb, gap = false) => {
      const L = Math.hypot(ub - ua, vb - va), n = Math.max(1, Math.round(L / 3));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const u = ua + (ub - ua) * (t0 + t1) / 2, v = va + (vb - va) * (t0 + t1) / 2;
        const along = ua === ub ? 'v' : 'u';
        if (gap && Math.abs(i - (n - 1) / 2) < 0.6) continue;
        F.put(T.chain, u, H / 2, v, along === 'u' ? L / n : 0.02, H, along === 'v' ? L / n : 0.02, 0xffffff);
        F.put(B.metalC, ua + (ub - ua) * t0, H / 2, va + (vb - va) * t0, 0.07, H, 0.07, 0x8a9096);
        const [a0, a1, b0, b1] = along === 'u'
          ? [ua + (ub - ua) * t0, ua + (ub - ua) * t1, v - 0.04, v + 0.04]
          : [u - 0.04, u + 0.04, va + (vb - va) * t0, va + (vb - va) * t1];
        F.walk(Math.min(a0, a1), Math.max(a0, a1), Math.min(b0, b1), Math.max(b0, b1), H, { noSeat: true });
      }
      F.put(B.metalC, ub, H / 2, vb, 0.07, H, 0.07, 0x8a9096);
    };
    run(fu, -fv, fu, fv, true); run(-fu, -fv, -fu, fv); run(-fu, -fv, fu, -fv); run(-fu, fv, fu, fv);
    // benches outside the gate
    for (const s of [-1, 1]) ctx.bench(...F.p(fu + 1.4, s * 4), F.yaw + Math.PI, 0);
  },

  // ------------------------------------------------ balcony apartments
  apartments(F, W, D, ctx) {
    const { B, R } = ctx;
    const w = W - 3, d = Math.min(16, D - 12), floors = 8, FH = 3;
    const u1 = D / 2 - 7, u0 = u1 - d, h = 1 + floors * FH;
    const col = 0xe9e6df;
    F.put(B.conc, (u0 + u1) / 2, h / 2, 0, d, h, w, col);
    F.put(B.plain, (u0 + u1) / 2, h + 0.3, 0, d + 0.3, 0.6, w + 0.3, 0x55595c);
    // ground floor lobby glass, then a balcony per bay per floor
    F.put(B.glass, u1 + 0.02, 1.7, 0, 0.04, 2.8, w - 2, 0x9fb3c0);
    const bays = Math.round(w / 4.2), bw = w / bays;
    for (let f = 0; f < floors; f++) {
      const y = 1 + f * FH + FH;
      for (let i = 0; i < bays; i++) {
        const v = -w / 2 + (i + 0.5) * bw;
        const lit = R() < 0.12;
        F.put(B.glass, u1 + 0.02, y - FH / 2 + 0.1, v, 0.04, 2.3, bw - 1.2, lit ? 0xe6d2a0 : 0x7f92a2);
        F.put(B.conc, u1 + 0.75, y - FH + 0.1, v, 1.5, 0.2, bw - 0.3, col);
        F.put(B.glass, u1 + 1.48, y - FH + 0.7, v, 0.03, 1, bw - 0.35, 0xb9cad4); // opaque glass balustrade (no transparent sort/blend)
        F.put(B.metalD, u1 + 1.48, y - FH + 1.22, v, 0.05, 0.05, bw - 0.3, 0x3b4046);
        if (R() < 0.3) F.put(ctx.B.shrubNear, u1 + 1.1, y - FH + 0.5, v - bw / 2 + 0.6, 0.6, 0.6, 0.6, 0x4f7a3a); // balcony pot: up close only
      }
      // back and sides: plain punched windows
      for (let i = 0; i < bays; i++) F.put(B.glass, u0 - 0.02, y - FH / 2 + 0.2, -w / 2 + (i + 0.5) * bw, 0.04, 1.4, 1.8, 0x7f92a2);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) F.put(B.glass, u0 + (k + 0.5) * d / 3, y - FH / 2 + 0.2, s * (w / 2 + 0.02), 1.6, 1.4, 0.04, 0x7f92a2);
    }
    F.put(B.metal, u1 + 1.5, 3.2, 0, 3, 0.2, 6, 0x303438);
    solid(F, u0, u1, -w / 2, w / 2, h);
    // a strip of lawn and trees out front
    lawn(F, { lawn: mats.lawn }, u1 + 2, D / 2 - 0.5, -w / 2, w / 2);
    for (let v = -w / 2 + 3; v < w / 2 - 2; v += 7) { const [x, z] = F.p(u1 + 4.5, v); if (ctx.free(x, z, 1.4)) ctx.tree(x, z, 0, 1); }
  },
};

function court(F, T, u0, u1, v0, v1, c) {
  const [x0, x1, z0, z1] = F.rect(u0, u1, v0, v1);
  T.court.add((x0 + x1) / 2, 0.006, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, c);
}
function lawn(F, T, u0, u1, v0, v1) {
  const [x0, x1, z0, z1] = F.rect(u0, u1, v0, v1);
  T.lawn.add((x0 + x1) / 2, 0.003, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, 0xffffff);
}
