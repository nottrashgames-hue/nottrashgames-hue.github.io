/*
  One-off bodies for particular websim users, seen by everyone: the look extras are applied
  by username, on your own machine for yourself and on everyone else's for your remote body.
  Whatever a special look sets is fixed (the wardrobe and saved outfits can't change it).
    gold: solid gold skin, glowing blue eyes      costume 'suit': tie, tactical vest, hockey mask
    cat 'cute' | 'sleek': anthro cats             toon: cel-shaded, black outlines
    costume 'baldi': one curly hair, wide eyes, thin smile      costume 'scout': cap, headset, bag, hand wraps
    blood: the colour they bleed (inks.js)      costume 'hoodie': hood down, pocket, drawstrings
    ears: false - no human ears      costume 'slugcat': Rain World's Saint (with glowEyes: lit eye glow)
    blood 'rainbow': pearly rainbow blood, changing colour as it dries      costume 'psy': living fractal skin, mandala halo
    blood 'none': never bleeds, sprays, stains or pools      costume 'papyrus': skull, battle body, scarf, trunks, boots
    costume 'hev': Gordon Freeman's hazard suit, glasses, goatee
    costume 'fallen': a red line-drawn devil-angel - halo, bladed wings, spiral tail
    silver: polished silver skin      blood 'prism': a random vivid colour per injury, shifting hue as it dries
    costume 'greyoli': red spiked hair, blue/red headphones, split black/orange shirt, striped trousers
    costume 'birch': a black silhouette, box head with a doodled pastel screen face, long ragged robe
    costume 'spider': a black widow - chitin, eight eyes, fangs, hourglass abdomen, four walking spider legs
    costume 'mj': Michael Jackson - fedora, curls, white shirt in a black jacket, one sequined glove, white socks
    costume 'goldsuit' (with goldSuit: gold metallic cloth): a gold suit, white shirt, black tie
    costume 'flowery': closed happy eyes, a smile, yellow hair, green/orange shirt, white collar with a black bow
    costume 'rat': a pale pink rat - round ears, snout, whiskers, closed smiling eyes, a heart-shaped tail
    costume 'fatboy': Fatboy (The Battle Bricks), blocky - deathFx 'explode': blows up on death, harming no one
    costume 'slime': a glossy green slime with a little top hat, drooling
    blood 'gunmetal': dark cool grey (not the toon 'grey')
    cat 'scratch': Scratch Cat      blood 'matrix': falling green code (shader-drawn)
    costume 'jason': Jason Voorhees, see looks2.js
    costume 'bee': a queen bee, see bee.js (queenBee: the stinger and lunge, queen.js; noGuns: can't hold one)
    costume 'false' / 'figure': see figures.js      blood 'figure': bleeds its own matte orange-red flesh
  A user can have several (an array, each with a name): picked between in the FUN menu.
*/

// Scratch Cat: orange all over, a white muzzle and belly, big white eyes, a wide toothy grin, a
// curling tail - and matrix blood: falling green code. Worn by two people (greesy, kat_gaming)
const SCRATCH = {
  name: 'Scratch Cat',
  cat: 'scratch', blood: 'matrix', build: 1.15, height: 0.86, limb: 1.12, headSize: 1.38, ears: false,
  skin: 0xf9a11b, hair: 0xf9a11b, hairStyle: 'bald', beard: null,
  top: 0xf9a11b, shorts: 0xf9a11b, shoe: 0xf9a11b, sleeves: 'tank', legs: 'long',
};

// (a new body here: add its owner to SKINS in server.js too, so they're told it's ready)
const SPECIAL = {
  // two of them: solid gold, and Dracula - a vampire (look.vampire, vampire.js): an unbreakable
  // grip, a bite that drains the blood out of whoever he's holding, faster, stronger, steadier,
  // hurt less and never inside
  rick_deckard: [
    { name: 'Gold', gold: true, blood: 'blue', build: 1.5, height: 1.08 },
    {
      name: 'Dracula',
      costume: 'dracula', vampire: true, blood: 'red', sex: 'm', build: 1.12, height: 1.1, ears: true,
      skin: 0xe8e0dc, hair: 0x0a0909, hairStyle: 'short', beard: null,
      top: 0x0c0c0e, shorts: 0x0c0c0e, shoe: 0x070708, sleeves: 'long', legs: 'long',
    },
  ],
  awebb55: {
    costume: 'suit', blood: 'gold',
    top: 0x141518, shorts: 0x141518, shoe: 0x0b0b0c, sleeves: 'long', legs: 'long',
  },
  // two of them (a pick in the FUN menu): the cat in a hoodie, and Scratch Cat (shared with greesy)
  kat_gaming: [
    {
      name: 'Hoodie Cat',
      cat: 'cute', blood: 'red', build: 0.95, height: 0.95, ears: false, costume: 'hoodie',
      skin: 0xf0a868, hair: 0xf0a868, hairStyle: 'bald', beard: null,
      top: 0x121214, shorts: 0x2a4f9c, shoe: 0x0c0c0e, sleeves: 'long', legs: 'long',
    },
    SCRATCH,
  ],
  // (hold Space: a charged super jump - main.js superJump)
  absolutely_aaden123: {
    toon: true, blood: 'grey', superJump: true,
    skin: 0xffffff, hair: 0xffffff, top: 0xffffff, shorts: 0xffffff, shoe: 0xffffff,
  },
  // a smiley blond kid: closed happy eyes and a smile, yellow hair, a green shirt with orange
  // bands, a small white collar with a black bow, black-brown trousers (costume 'flowery')
  baldibasic: {
    costume: 'flowery', blood: 'red', build: 0.9, height: 0.97,
    skin: 0xf3d2b4, hair: 0xf4d23c, hairStyle: 'short', beard: null,
    top: 0x3f9a3e, shorts: 0x2a1d16, shoe: 0x121013, sleeves: 'short', legs: 'long',
  },
  // the Scout: red tee, ball cap and headset, bag strap across the chest, knee-length trousers
  scoutsolete_gaming: {
    costume: 'scout', blood: 'red', build: 0.88, height: 1.0,
    skin: 0xe8b28c, hair: 0x4a2f1c, hairStyle: 'buzz', beard: null,
    top: 0xc23b3b, shorts: 0x4b4838, shoe: 0x18181a, sleeves: 'short', legs: 'short',
  },
  // Saint from Rain World: a slugcat, green glowing to orange at the feet, with a long tongue
  saint_rainworld: {
    costume: 'slugcat', glowEyes: true, blood: 'red', build: 1.05, height: 0.9, ears: false,
    skin: 0x7ed63a, hair: 0x7ed63a, hairStyle: 'bald', beard: null,
    top: 0x7ed63a, shorts: 0x86d63a, shoe: 0xf08a24, sleeves: 'long', legs: 'long',
  },
  // three of them (a pick in the FUN menu): Scratch Cat too (shared with kat_gaming), and
  // Papyrus: a tall skeleton in his battle body - red scarf, gloves and boots, blue trunks. No blood.
  // Michael Jackson: black fedora, black jacket over a white shirt, one sequined white glove,
  // high-water trousers showing white socks, black loafers (costume 'mj')
  greesy: [
    {
      name: 'Papyrus',
      costume: 'papyrus', blood: 'none', build: 0.82, height: 1.14, ears: false,
      skin: 0x7e2430, hair: 0x7e2430, hairStyle: 'bald', beard: null,
      top: 0xf4f1ea, shorts: 0x7e2430, shoe: 0xc4302b, sleeves: 'short', legs: 'long',
    },
    {
      name: 'Michael Jackson',
      costume: 'mj', blood: 'red', build: 0.8, height: 1.02, limb: 1.04,
      skin: 0xc8946c, hair: 0x0c0a0a, hairStyle: 'short', beard: null,
      top: 0x121214, shorts: 0x121214, shoe: 0x0a0a0b, sleeves: 'long', legs: 'long',
    },
    SCRATCH,
  ],
  // a trip: a living fractal all over, a mandala halo, lit eyes, rainbow blood
  lighthorus: {
    costume: 'psy', glowEyes: true, blood: 'rainbow', build: 0.95, height: 1.02,
    hairStyle: 'short', beard: null, sleeves: 'long', legs: 'long',
    skin: 0xffffff, hair: 0xffffff, top: 0xffffff, shorts: 0xffffff, shoe: 0xffffff,
  },
  // Gordon Freeman in the HEV suit: orange and grey armour, black gloves, glasses, goatee
  bnolb: {
    costume: 'hev', blood: 'red', build: 1.05, height: 1.03,
    skin: 0xe2b594, hair: 0x4a2c18, hairStyle: 'short', beard: null,
    top: 0xd2681c, shorts: 0x44484c, shoe: 0x1a1b1d, sleeves: 'long', legs: 'long',
  },
  // a fallen thing drawn in red light: glowing eyes, horns, a halo, bladed wings, a spiral tail
  jel_manz: {
    costume: 'fallen', blood: 'red', build: 0.9, height: 1.04, ears: false,
    skin: 0x5a0a0e, hair: 0x4a080b, hairStyle: 'bald', beard: null,
    top: 0x4a080b, shorts: 0x4a080b, shoe: 0x30050a, sleeves: 'long', legs: 'long',
  },
  // two of them (a pick in the FUN menu): red spiked hair, blue/red headphones, a black-and-orange
  // split shirt, striped trousers, pink shoes - and a red ball cap, a black shirt with a big red G
  grayoli1313: [
    {
      name: 'Headphones',
      costume: 'greyoli', blood: 'red', build: 1.0, height: 1.0,
      skin: 0xa8683f, hair: 0xb0140e, hairStyle: 'bald', beard: null,
      top: 0xee7a1c, shorts: 0x141416, shoe: 0xf2a6ea, sleeves: 'short', legs: 'long',
    },
    {
      name: 'Red G',
      costume: 'gcap', blood: 'red', build: 1.0, height: 1.0,
      skin: 0xe2b594, hair: 0x2a1c14, hairStyle: 'buzz', beard: null,
      top: 0x121214, shorts: 0x2b3a55, shoe: 0x141416, sleeves: 'short', legs: 'long',
    },
  ],
  // two of them (a pick in the FUN menu): polished silver, long golden hair, all in black - and
  // prism blood: every injury its own colour; and Virginia (after Sons of the Forest's): a woman
  // with three arms and three legs (costume 'threefold' - the third of each keeps up with the body
  // by itself), a blonde ponytail and a one-piece swimsuit, barefoot
  happyhamster: [
    {
      name: 'Silver',
      silver: true, blood: 'prism',
      skin: 0xd9dde3, hair: 0xe8b830, hairStyle: 'long', beard: null,
      top: 0x121214, shorts: 0x121214, shoe: 0x0b0b0c, sleeves: 'long', legs: 'long',
    },
    {
      name: 'Virginia',
      costume: 'threefold', sex: 'f', blood: 'red',
      skin: 0xe6b99a, hair: 0xe9cf7e, hairStyle: 'ponytail', beard: null,
      top: 0x1d6f7d, shorts: 0x1d6f7d, shoe: 0xd9a888, sleeves: 'tank', legs: 'short',
    },
  ],
  // a tall thin black silhouette: a box head with a scribbled pastel screen for a face, a ragged robe
  // two of them (a pick in the FUN menu): the silhouette, and a black widow - a glossy black
  // chitin body, eight red eyes and fangs, a bulbous hourglass abdomen, four long spider legs
  // off the back that walk on their own (costume 'spider'), and black blood
  // and Seek (DOORS): glossy dripping black ink, one huge staring eye - and blood with eyes in it
  // and Fatboy (The Battle Bricks): big, blocky, dark navy, a white grinning face in a black
  // helmet, a lit bomb held up over his head - that goes off when he dies (it hurts nobody else).
  // Gunmetal-grey blood
  birch_tree: [
    {
      name: 'Silhouette',
      costume: 'birch', blood: 'red', build: 0.78, height: 1.1, limb: 0.8, armLen: 1.1, ears: false,
      skin: 0x09090b, hair: 0x09090b, hairStyle: 'bald', beard: null,
      top: 0x09090b, shorts: 0x09090b, shoe: 0x09090b, sleeves: 'long', legs: 'long',
    },
    {
      name: 'Spider',
      costume: 'spider', blood: 'black', build: 0.86, height: 1.06, limb: 0.9, armLen: 1.05, ears: false,
      skin: 0x0c0b0e, hair: 0x0c0b0e, hairStyle: 'bald', beard: null,
      top: 0x0c0b0e, shorts: 0x0c0b0e, shoe: 0x0c0b0e, sleeves: 'long', legs: 'long',
    },
    {
      name: 'Seek',
      costume: 'seek', blood: 'seek', build: 0.84, height: 1.12, limb: 0.95, armLen: 1.12, ears: false,
      skin: 0x070607, hair: 0x070607, hairStyle: 'bald', beard: null,
      top: 0x070607, shorts: 0x070607, shoe: 0x070607, sleeves: 'long', legs: 'long',
    },
    {
      name: 'Fatboy',
      costume: 'fatboy', blood: 'gunmetal', deathFx: 'explode', build: 1.38, height: 1.15, limb: 1.1, headSize: 1.35, ears: false,
      skin: 0x1c2336, hair: 0x0b0c10, hairStyle: 'bald', beard: null,
      top: 0x26314b, shorts: 0x1f2840, shoe: 0x161c2c, sleeves: 'long', legs: 'long',
    },
    // The Figure (DOORS): tall, thin, long-armed, faceted orange-red flesh gone blue-black at its
    // edges, a round glowing mouth of teeth for a face, lit ribs - and it bleeds its own flesh
    {
      name: 'Figure',
      costume: 'figure', blood: 'figure', build: 0.82, height: 1.3, limb: 0.95, armLen: 1.22, legLen: 1.04, headSize: 1.08,
      handSize: 1.35, footSize: 1.2, ears: false,
      skin: 0xc4461f, hair: 0xc4461f, hairStyle: 'bald', beard: null,
      top: 0xc4461f, shorts: 0xc4461f, shoe: 0xc4461f, sleeves: 'long', legs: 'long',
    },
    // The Queen Bee: big, banded yellow and black, a gold crown, buzzing wings, a long abdomen -
    // and a stinger (queen.js): hold I to pull it, click to sting (a little damage and venom -
    // and she dies soon after, as bees do). No guns; double-tap R to lunge (stinger out: a sting)
    {
      name: 'Queen Bee',
      costume: 'bee', queenBee: true, noGuns: true, lungeK: 1.8, blood: 'stark', build: 1.3, height: 1.2, limb: 0.95, headSize: 1.15, ears: false,
      skin: 0xf2b418, hair: 0x141210, hairStyle: 'bald', beard: null,
      top: 0xf2b418, shorts: 0x141210, shoe: 0x141210, sleeves: 'long', legs: 'long',
    },
  ],
  // a green alien: a long head, huge swirling green-and-black eyes, a beanie (coloured like hair,
  // in the wardrobe), silver earrings and a chain - the clothes are the wearer's own; galaxy blood
  // (@GentVR - this account was grumpymongoose0879546 when the skin was made: skins go by username)
  gentvr: {
    costume: 'alien', blood: 'galaxy', ears: false,
    skin: 0x74cc3c, hairStyle: 'bald', beard: null,
  },
  // the store manager: white short-sleeved shirt and tie, MANAGER badge, lanyard, glasses, khakis
  kotsoft: {
    costume: 'manager', blood: 'red', sex: 'm', build: 1.08, height: 1.0,
    skin: 0xe6b996, hair: 0x5a3e28, hairStyle: 'short', beard: null,
    top: 0xf6f6f2, shorts: 0xb9a57c, shoe: 0x17130f, sleeves: 'short', legs: 'long',
  },
  // a chubby, happy pale pink rat: big round ears, a pointed snout and whiskers, closed smiling
  // eyes, a long pink tail curled into a heart - and stark green blood (costume 'rat')
  greenthelee: {
    costume: 'rat', blood: 'stark', build: 1.3, height: 0.86, headSize: 1.1, ears: false,
    skin: 0xf8e0f0, hair: 0xf8e0f0, hairStyle: 'bald', beard: null,
    top: 0xf8e0f0, shorts: 0xf8e0f0, shoe: 0xf2b4dc, sleeves: 'long', legs: 'long',
  },
  // a dude in a shining gold suit: white shirt, black tie, black shoes - and bright gold blood
  uglysail8737642: {
    costume: 'goldsuit', goldSuit: true, blood: 'brightgold', build: 1.0, height: 1.02,
    skin: 0xdcae8c, hair: 0x2e1f14, hairStyle: 'short', beard: null,
    top: 0xf2c23c, shorts: 0xf2c23c, shoe: 0x0e0e10, sleeves: 'long', legs: 'long',
  },
  // a glossy green slime: a soft dome of a head, closed eyes, a flat grin, blue drool, a little
  // black top hat with a red-white-red band, goo dripping off it - and green blood (costume 'slime')
  '99aka69r9': {
    costume: 'slime', blood: 'green', build: 1.2, height: 0.95, limb: 1.15, ears: false,
    skin: 0x37946e, hair: 0x37946e, hairStyle: 'bald', beard: null,
    top: 0x37946e, shorts: 0x37946e, shoe: 0x37946e, sleeves: 'tank', legs: 'long',
  },
  // a guy in a sharp dark suit with a big yellow smiley emoji for a head - and hot pink blood
  // (costume 'emoji', looks2.js)
  memetemple: {
    costume: 'emoji', blood: 'hotpink', build: 1.0, height: 1.02, ears: false,
    skin: 0xffc62e, hair: 0xffc62e, hairStyle: 'bald', beard: null,
    top: 0x23262d, shorts: 0x23262d, shoe: 0x0c0c0e, sleeves: 'long', legs: 'long',
  },
  // an anthro raccoon: grey fur, the black bandit mask, red eyes, a bushy ringed tail - and down on
  // all fours when he sprints flat out (double-tap Shift: main.js fourLegs)
  ketchupdev: {
    costume: 'raccoon', blood: 'red', build: 1.05, height: 0.92, headSize: 1.12, ears: false, allFours: true,
    skin: 0x7d7a7c, hair: 0x7d7a7c, hairStyle: 'bald', beard: null,
    top: 0x7d7a7c, shorts: 0x6a676a, shoe: 0x2a282c, sleeves: 'long', legs: 'long',
  },
  // a figure of separate black pieces outlined in glowing red and white: a "no" sign for a face,
  // a bar chart on the chest, beaded arms, square arches for hands (costume 'false', figures.js)
  false: {
    costume: 'false', blood: 'red', build: 0.9, height: 1.06, limb: 0.62, ears: false,
    skin: 0x060607, hair: 0x060607, hairStyle: 'bald', beard: null,
    top: 0x060607, shorts: 0x060607, shoe: 0x060607, sleeves: 'long', legs: 'long',
  },
  // Jason Voorhees: the old hockey mask, a bald lumpy scalp, a worn olive work jacket, grey work
  // trousers and brown boots - big and tall (costume 'jason', looks2.js)
  kaleb: {
    costume: 'jason', blood: 'red', sex: 'm', build: 1.32, height: 1.12, limb: 1.08, ears: false,
    skin: 0xb9a48c, hair: 0x2a2118, hairStyle: 'bald', beard: null,
    top: 0x3e4533, shorts: 0x4d4b45, shoe: 0x33261a, sleeves: 'long', legs: 'long',
  },
  tok3n: {
    cat: 'sleek', blood: 'purple', build: 0.9, height: 1.05,
    skin: 0x1fb3ad, hair: 0x1fb3ad, hairStyle: 'bald', beard: null,
    top: 0x178f8a, shorts: 0x12706c, shoe: 0x0d5552,
  },
  me67or: {
    name: 'me67or', costume: 'neon', blood: 'green', height: 1.02, build: 1.0, ears: false,
    skin: 0x2da449, hair: 0x2da449, hairStyle: 'bald', beard: null,
    top: 0x2da449, shorts: 0x2da449, shoe: 0x2da449, sleeves: 'long', legs: 'long',
  },
  itsmeagain: {
    name: 'Glitch', costume: 'glitch', glowEyes: 'neon', blood: 'purple', height: 1.04, build: 0.92, headSize: 1.06,
    skin: 0x101426, hair: 0x37206a, hairStyle: 'spiky', beard: null,
    top: 0x111424, shorts: 0x101222, shoe: 0x090b16, sleeves: 'long', legs: 'long',
  },
  realcray: {
    name: 'Radiant', costume: 'radiant', glowEyes: 'yellow', blood: 'gold', invincible: true, height: 1.0, build: 1.0,
    skin: 0xffffff, hair: 0xffffff, hairStyle: 'spiky', beard: null,
    top: 0xf7f8ff, shorts: 0xf7f8ff, shoe: 0xf7f8ff, sleeves: 'long', legs: 'long',
  },
  sillyguirt50: { costume: 'prismaticWings', wingFlight: true },
};

/** Baldi (Baldi's Basics): not anyone's body - an NPC for the spawn menu, never without his ruler. */
export const BALDI = {
  costume: 'baldi', blood: 'red', height: 1.12, build: 0.9, headSize: 1.08,
  skin: 0xf3cda6, hair: 0x2a1a10, hairStyle: 'bald', beard: null,
  top: 0x3f9b3c, shorts: 0x2c4f9e, shoe: 0x3b2a1e, sleeves: 'long', legs: 'long',
};

/** Every username with a body of their own. */
export const SPECIAL_NAMES = Object.keys(SPECIAL);

/** The names of the skins this username can pick between (one or more), or null. */
export function specialSkins(name) {
  const S = name && SPECIAL[String(name).toLowerCase()];
  if (!S) return null;
  return Array.isArray(S) ? S.map((v) => v.name) : [null];
}

/**
 * The extras for this username (merged over a look), or null. Someone with more than one skin:
 * `variant` picks which (it goes out with their look, so everyone builds the same one).
 */
export function specialLook(name, variant = 0) {
  let S = name && SPECIAL[String(name).toLowerCase()];
  if (!S) return null;
  let i = 0;
  if (Array.isArray(S)) {
    i = Math.min(S.length - 1, Math.max(0, variant | 0));
    const { name: _, ...v } = S[i];
    S = v;
  }
  return { ...S, variant: i, fixed: [...Object.keys(S), 'variant'] };
}

/**
 * A special body worn with its owner's own proportions (the FUN menu's sliders): each one scales
 * the special's own value (a tall skin made 120% is 120% of its tall). `base` keeps the special's
 * values; the proportions stay in `fixed` so what's saved is the owner's own slider, not the product.
 */
export const SPECIAL_SHAPE = ['height', 'build', 'limb', 'armLen', 'legLen', 'headSize', 'handSize', 'footSize', 'neckLen', 'eyeSize'];
export function wearSpecial(own, S) {
  if (!S) return own;
  const out = { ...own, ...S }, base = {};
  for (const k of SPECIAL_SHAPE) {
    base[k] = S[k] ?? 1;
    out[k] = base[k] * (+own?.[k] || 1);
  }
  out.base = base;
  out.fixed = [...new Set([...(S.fixed || []), ...SPECIAL_SHAPE, 'base'])];
  return out;
}
