/*
  Who's out on the street: random looks (sex, skin, hair, build, clothes) and a personality
  (temper, toughness, a criminal streak, whatever they're carrying).
*/

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wpick = (pairs) => {
  let r = Math.random() * pairs.reduce((s, p) => s + p[1], 0);
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};
const rnd = (a, b) => a + Math.random() * (b - a);

// very fair -> very deep, spread over the range people come in, with cool/pink, neutral,
// golden/olive and warm/red undertones at each depth
export const SKINS = [
  0xfbe3d6, 0xf7dcc8, 0xf2d3b8, 0xefc9ad, 0xeac39a, 0xe6b893, 0xe0b98c, 0xdba57f,
  0xd3a676, 0xcf946c, 0xc79c6b, 0xc0825a, 0xb4865a, 0xad6f49, 0xa1683f, 0x98603c,
  0x8a5a35, 0x80502f, 0x74472a, 0x6b4126, 0x5f3a22, 0x57331d, 0x4a2b18, 0x432616, 0x3a2114,
];
const HAIR_DARK = [0x16110d, 0x221812, 0x2e2018, 0x3a2618];
const HAIR_LIGHT = [0x5a3a22, 0x7a5230, 0x9a6a3a, 0xc59a5c, 0xe0c283, 0x8c3f1f, 0xa8532a];
const HAIR_GREY = [0x8d8a86, 0xb9b5ae, 0xd8d4cc];
const TOPS = [0x3d6fb6, 0xc4553d, 0x5a8f55, 0xd9b440, 0x8a5aa8, 0xe8e4dc, 0x2b2d33, 0xd27a9a, 0x4aa3a0,
  0x9a6b44, 0xb03a48, 0x6f8fb0, 0xf0f0ee, 0x1f3b5c, 0x7a7f45, 0xe07b39, 0x5b2d4e, 0x9fb7c9];
const BOTTOMS = [0x2a2a30, 0x3b3f4a, 0x6b5a45, 0x2c3442, 0x33302e, 0x5a6470, 0x8a7a60, 0x1e2a44,
  0x2f4a6e, 0x46607f, 0xb9ab8a, 0x55463a];
const SHOES = [0x40454d, 0x1b1b1d, 0xe9e7e2, 0x6b4a33, 0x8a2a2a, 0x2c3a58];

export function makeLook(sexOverride = null) {
  const sex = sexOverride || (Math.random() < 0.5 ? 'f' : 'm');
  // index on the old 12-step scale (for hair odds), from the finer palette
  const sk = Math.floor(Math.random() * SKINS.length);
  const si = Math.floor(sk / SKINS.length * 12);
  const old = Math.random() < 0.14;
  const hair = old ? pick(HAIR_GREY)
    : si >= 6 ? (Math.random() < 0.92 ? pick(HAIR_DARK) : pick(HAIR_LIGHT.slice(0, 3)))
      : Math.random() < 0.5 ? pick(HAIR_DARK) : pick(HAIR_LIGHT);
  const hairStyle = sex === 'f'
    ? wpick([['long', 4], ['ponytail', 3], ['bob', 3], ['bun', 2], ['afro', si >= 6 ? 2 : 0.3], ['short', 1], ['buzz', 0.3]])
    : wpick([['short', 5], ['buzz', 3], ['bald', old ? 3 : 1], ['afro', si >= 6 ? 1.5 : 0.2], ['long', 0.5], ['ponytail', 0.3]]);
  // weight: skinny .. average .. heavy .. very heavy
  const build = wpick([[rnd(0.8, 0.9), 2], [rnd(0.9, 1.05), 5], [rnd(1.05, 1.2), 3.5], [rnd(1.2, 1.38), 2], [rnd(1.38, 1.55), 0.8]]);
  // height (1 = ~1.78 m): women a little shorter on average, a few very short or very tall
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
  const height = Math.max(0.86, Math.min(1.1, (sex === 'f' ? 0.955 : 1.0) + gauss() * 0.035));
  return {
    sex, skin: SKINS[sk], hair, hairStyle, build, height,
    beard: sex === 'm' && Math.random() < 0.3 ? (Math.random() < 0.5 ? 'full' : 'short') : null,
    top: pick(TOPS), shorts: pick(BOTTOMS), shoe: pick(SHOES),
    legs: Math.random() < 0.55 ? 'long' : 'short',
    sleeves: Math.random() < 0.3 ? 'long' : 'short',
  };
}

/**
 * temper   - how easily they get angry (0..1)
 * tough    - fights back instead of running (0..1)
 * crook    - chance per few minutes of committing a crime
 * weapon   - null | 'bat' | 'crowbar' | 'machete' | 'pistol'
 * mouth    - how often they run their mouth at people
 */
export function makePersona() {
  const crook = Math.random() < 0.22;
  const tough = Math.min(1, Math.random() * 0.9 + (crook ? 0.35 : 0));
  const weapon = Math.random() < (crook ? 0.7 : 0.12)
    ? wpick([['bat', 3], ['crowbar', 2], ['machete', 1.5], ['pistol', crook ? 1.6 : 0.6]])
    : null;
  return {
    temper: Math.min(1, Math.random() * 0.8 + (crook ? 0.3 : 0)),
    tough,
    crook,
    weapon,
    mouth: 0.3 + Math.random() * 0.7,
  };
}
