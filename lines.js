/*
  Everything people say out loud. line(kind, about) picks a line; `about` is whoever/whatever
  the line is aimed at, so roasts can go after their height, weight, shirt or car.
*/

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// closest plain colour name for a hex colour
const NAMES = [
  ['red', 0xc4403a], ['maroon', 0x6e2230], ['pink', 0xe08aa8], ['orange', 0xe07b39], ['yellow', 0xd9b440],
  ['beige', 0xc9b48a], ['brown', 0x7a5230], ['olive', 0x7a7f45], ['green', 0x4f8a50], ['teal', 0x3f9a98],
  ['blue', 0x3d6fb6], ['navy', 0x1f3050], ['purple', 0x7a4a98], ['white', 0xf0f0ee], ['grey', 0x8a8e94],
  ['black', 0x1e1f22], ['baby blue', 0x9fb7c9], ['gold', 0xc9a13a], ['silver', 0xb8bcc2],
];
export function colorName(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  let best = 'grey', bd = Infinity;
  for (const [n, c] of NAMES) {
    const d = (r - ((c >> 16) & 255)) ** 2 + (g - ((c >> 8) & 255)) ** 2 + (b - (c & 255)) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

const L = {
  // ---- roasting a person ----
  roast: [
    "Nice outfit. Did you lose a bet?", "You walk like you're buffering.", "Who dressed you, a raccoon?",
    "I've seen better posture on a folding chair.", "You look like a before picture.",
    "Is that your face or are you testing it for someone?", "Walk it off, NPC.", "Big main character energy, zero plot.",
    "You got a face for radio.", "Even your shadow is embarrassed.", "Are you lost or just like that?",
    "You look like you get lost in revolving doors.", "Bro skipped leg day, arm day, and every other day.",
    "Keep walking, fashion disaster.", "You smell like a wet sidewalk.", "Who let you out without supervision?",
  ],
  tall: ["How's the weather up there, lamp post?", "Duck, skyscraper, you'll hit a bird.", "Somebody water you too much?"],
  short: ["Hey, you dropped your booster seat.", "Can you even see over the curb?", "Fun size, zero fun."],
  heavy: ["Bus stop's that way, big guy.", "Save some sidewalk for the rest of us.", "You block the sun when you walk by."],
  heavyF: ["Save some sidewalk for the rest of us.", "Careful, you'll crack the pavement, sweetie."],
  skinny: ["Eat a sandwich, noodle.", "A strong breeze would end you.", "Is that a person or a coat hanger?"],
  bald: ["Your head's blinding me, cue ball.", "Nice head. Very... aerodynamic."],
  shirt: ["That {c} shirt is a crime.", "Who wears {c} on purpose?", "{C}? Bold choice. Wrong, but bold.", "My grandma has curtains in that {c}."],
  bleeding: ["You're leaking, champ.", "Rough day? Looks like it.", "You look like you lost a fight with a blender."],
  armed: ["Put that thing away before you hurt yourself.", "Oh no, a tough guy with a toy.", "Compensating much?"],

  // ---- roasting a car (and the driver) ----
  car: [
    "Nice car. Did it come with a tetanus shot?", "Learn to drive, clown!", "Where'd you get your license, a cereal box?",
    "That thing runs on hopes and prayers.", "My blender has more horsepower.", "Park it in a river!",
    "Signal, you absolute walnut!", "Are you driving or doing a crime?", "Get off the road, grandpa!",
  ],
  carColor: ["A {c} car? Seriously?", "Who paints a car {c}?", "That {c} paint job looks like soup."],
  taxi: ["Yo taxi, you're a menace!", "Five stars for almost killing me!", "Meter's running and so am I!"],
  hatch: ["Cute little clown car.", "Is that a car or a shoe?", "Hatchback? Hatch-whack."],
  sedan: ["Dad car detected.", "Boring car for a boring person.", "Minivan energy."],
  wrecked: ["Your car looks like you drive with your eyes shut.", "Nice dents. Collect them all?"],
  nearMiss: ["WATCH IT!", "Are you blind?!", "I'm WALKING here!", "You almost hit me, idiot!", "Slow down, maniac!"],
  runOver: ["MY LEGS!", "You hit me with your car!", "HIT AND RUN! HIT AND RUN!", "I'm calling my lawyer!"],

  // ---- being messed with ----
  bumped: ["Watch where you're going.", "Excuse YOU.", "Hey! Eyes up.", "Rude.", "Do you mind?", "Personal space, pal."],
  angry: ["You wanna go?!", "Oh, you're DEAD!", "Say that to my face!", "Come here, tough guy!", "Big mistake!",
    "Wrong person, buddy!", "I'm gonna fold you like laundry!", "Square up!", "That's it!"],
  glare: ["Try that again. I dare you.", "Real brave.", "You got a problem?", "Keep walking.", "Unbelievable."],
  wave: ["Get outta here!", "Go on, beat it!", "Yeah, keep walking!", "Idiot!", "Shoo!"],
  scared: ["AAAH!", "Help! HELP!", "Don't shoot!", "I don't want any trouble!", "Somebody call the cops!", "Run!!", "Not today!"],
  hurt: ["Ow! OW!", "My ribs...", "I think it's broken!", "Oof.", "That's gonna bruise."],
  gotUp: ["Is that all you got?", "Cheap shot!", "I'm fine. I'm FINE.", "That's gonna cost you."],
  won: ["Stay down!", "And STAY down.", "That's what I thought.", "Next!", "Learn some manners."],
  jacked: ["MY CAR!", "Hey! That's my car!", "Give it back!", "I just washed that!"],

  // ---- crimes ----
  mug: ["Wallet. Now.", "Empty your pockets!", "Gimme the cash!", "This is a robbery!", "Run the money!", "Don't make this hard."],
  mugged: ["Take it! Just take it!", "Okay okay okay!", "Please, I have kids!", "Help! I'm being robbed!", "Not again..."],
  mugRefuse: ["Not a chance.", "Try me.", "You picked the wrong one.", "Nah."],
  mugDone: ["Pleasure doing business.", "Thanks, sucker.", "Easy money.", "Cha-ching."],
  robbedAfter: ["Thief! THIEF!", "Somebody stop him!", "My wallet!", "Cops! COPS!"],
  witness: ["Whoa, whoa!", "Somebody do something!", "Oh my god!", "Fight! FIGHT!", "I'm filming this!", "Not my problem..."],
  vandal: ["Nice car. Would be a shame...", "Oops.", "That's for parking there!"],
  gunOut: ["I'm not playing around!", "Back off!", "Get on the ground!", "Don't make me do it!"],

  // ---- people roasting each other / chit chat heard in passing ----
  chat: ["Did you see the game?", "My landlord is a lizard, I swear.", "I'm SO tired.", "Crazy weather.",
    "They closed the good taco place.", "Honestly? Same.", "No way.", "That's what I told her!", "Wild.",
    "I'm starting a podcast.", "My cat hates me.", "Rent's going up again.", "You look great!"],
  banter: ["Is that your hair or a pet?", "Lol, look at your shoes.", "You still owe me twenty bucks.",
    "You call that a sandwich?", "Your mom called, she wants her shirt back.", "Nice haircut. Self-done?"],
  banterBack: ["Says you.", "Wow. Okay.", "At least I have friends.", "Rude!", "I'll remember that.", "Ha. Ha. Ha."],

  // ---- pain: where it hurts ({s}: "left"/"right") ----
  painHead: ["AGH! My HEAD!", "My head... ohh, my head...", "Ow! My FACE!", "Everything's spinning...", "My nose! You broke my nose!", "OW! Right in the skull!"],
  painChest: ["OOF! My chest!", "Can't... breathe...", "My ribs! AGH!", "Right in the chest, oh god...", "I think you cracked a rib!"],
  painGut: ["OOF! My stomach!", "Right in the gut...", "Ugh... I'm gonna be sick...", "My belly! AGH!", "Oh, that's low!"],
  painArm: ["AAGH! My {s} arm!", "My arm! My ARM!", "I can't feel my {s} arm!", "OW! My elbow!", "My {s} arm, oh god!", "Ah! My wrist!"],
  painLeg: ["AGH! My {s} leg!", "My LEG! My leg!", "My knee! OW!", "I can't stand on it!", "My {s} leg, it's- AGH!", "Ow, my shin!"],
  painFoot: ["OW! My foot!", "My {s} foot! AGH!", "My toes!"],
  shotHead: ["...", "AGH-"],
  shotChest: ["I'm SHOT! I'm shot!", "It went through my chest... help...", "I can't breathe! I'm shot!"],
  shotGut: ["I'm shot! In the stomach!", "Oh god, I'm bleeding... my stomach...", "Somebody help! I'm shot!"],
  shotArm: ["AAH! My {s} arm! I'm shot!", "You shot my arm!", "My arm! There's a hole in my arm!"],
  shotLeg: ["AAAGH! My {s} leg! I'm shot!", "You shot me in the leg!", "My leg! I can't walk!"],
  shotFoot: ["My FOOT! You shot my foot!", "AGH! My {s} foot!"],
  lostArm: ["MY ARM! WHERE'S MY ARM?!", "AAAAAH! MY ARM!", "MY {S} ARM! IT'S GONE!", "No no no no- MY ARM!"],
  lostHand: ["MY HAND! MY HAND!", "AAAAH! Where's my hand?!", "My {s} hand! It's- it's gone!"],
  lostLeg: ["MY LEG!! AAAAAH!", "WHERE'S MY LEG?!", "My {s} leg! OH GOD!", "I can't- MY LEG!"],
  brokeLeg: ["It's broken! My {s} leg's broken!", "I heard it snap! My leg!", "AGH! My knee went the wrong way!"],
  brokeArm: ["My arm! It's broken!", "AGH! I think my {s} arm's broken!"],
  hurtBad: ["I need a doctor...", "Help me... please...", "I'm bleeding so much...", "Somebody... call an ambulance..."],

  // ---- seeing it happen ----
  horror: ["OH MY GOD!", "He's DEAD! He's dead!", "No no no no no!", "Somebody call 911!", "What did you DO?!", "Is he breathing?!", "Oh god, oh god, oh god..."],
  horrorF: ["OH MY GOD!", "She's DEAD! She's dead!", "No no no no no!", "Somebody call 911!", "What did you DO?!", "Is she breathing?!"],
  gore: ["OH GOD! His- his ARM!", "I'm gonna throw up...", "THAT'S A LEG! THAT'S A LEG ON THE GROUND!", "What the hell?! WHAT THE HELL?!", "Oh no. Oh no no no.", "Is that- is that a HAND?!"],
  murderer: ["MURDERER!", "You KILLED him!", "You monster!", "Stay away from me!", "KILLER! Somebody stop him!", "You're gonna pay for that!"],
  murdererF: ["MURDERER!", "You KILLED her!", "You monster!", "Stay away from me!", "KILLER! Somebody stop them!"],
  avenge: ["You killed my friend!", "That was my FRIEND!", "You'll pay for that!", "I'm gonna end you!", "Nobody does that and walks away!"],
  grief: ["No... please... wake up...", "Why... why him...", "Come on, get up... please get up...", "I'm so sorry...", "Somebody help him, please...", "Don't leave me...", "This can't be happening..."],
  griefF: ["No... please... wake up...", "Why... why her...", "Come on, get up... please get up...", "I'm so sorry...", "Somebody help her, please...", "Don't leave me..."],
  griefPart: ["Oh god... that was his...", "Who would do this...", "I can't look at it... I can't...", "This is someone's arm... someone's...", "Poor guy..."],
  sob: ["*sob*", "*sniff*... why...", "*crying*", "Hhh... hhh...", "*sniffle*"],
  mourn: ["Rest in peace.", "He didn't deserve that.", "What a world.", "I knew him, you know. Kind of.", "Somebody should cover him up."],
  mournF: ["Rest in peace.", "She didn't deserve that.", "What a world.", "Somebody should cover her up."],
  stillShaking: ["I'm still shaking...", "I can't stop seeing it...", "Did that really just happen?", "I need to go home."],
  seeKiller: ["It's HIM! The killer!", "Stay back! I saw what you did!", "Keep away from me, psycho!", "You! I saw you!"],

  // ---- clothes ----
  newClothes: ["New {c} shirt? Trying to blend in?", "Changed your shirt, huh? Hiding something?", "Oh, NOW you're wearing {c}.", "Nice change. The last one was worse.", "Didn't you just have a different shirt on?", "Costume change? Who are you hiding from?"],
  newClothesKiller: ["Changing your shirt won't hide it, killer!", "New clothes, same murderer.", "I know it's you. {C} shirt or not."],
  bloodyShirt: ["Is that... blood on your shirt?", "Your shirt is covered in blood, man.", "Whose blood is that?!", "You look like you walked out of a slaughterhouse.", "Why are you all bloody?!"],
  bloodyWhite: ["That WAS a white shirt, huh?", "Blood on a white shirt. Great look, psycho.", "Why is your white shirt RED?", "You're gonna need a new white shirt.", "Bleach isn't getting THAT out."],
  whiteShirt: ["White shirt? Brave. Real brave, around here.", "Crisp white shirt. Don't spill anything.", "Look at Mr. Clean over here.", "A white shirt in this city? Bold."],
  copColors: ["Nice navy. You a cop or something?", "Dressed like a cop. Not a cop though, right?", "Is that a uniform? You undercover?"],
  redShirt: ["Red shirt. Hides the blood, smart.", "Wearing red? Planning something?"],
  blackShirt: ["All black, huh? Going to a funeral?", "Black shirt. Very mysterious.", "Dressed for a heist?"],
  pinkShirt: ["Pink! Confident. I respect that.", "Love the pink, honestly."],
  matching: ["Hey, we're twins!", "Nice shirt. Great taste.", "Did you copy my outfit?", "Stop dressing like me."],
};

/** A line of `kind`, dressed up for `about` ({ look } for a person, { kind, color, dmg } for a car). */
export function line(kind, about) {
  let pool = L[kind] || L.chat;
  const lk = about?.look;
  if (kind === 'roast' && lk && Math.random() < 0.55) {
    const opts = [];
    if (lk.height > 1.05) opts.push(L.tall);
    if (lk.height < 0.92) opts.push(L.short);
    if (lk.build > 1.25) opts.push(lk.sex === 'f' ? L.heavyF : L.heavy);
    if (lk.build < 0.9) opts.push(L.skinny);
    if (lk.hairStyle === 'bald' || lk.hairStyle === 'buzz') opts.push(L.bald);
    if (lk.top != null) opts.push(L.shirt);
    if (about.bleeding) opts.push(L.bleeding);
    if (about.armed) opts.push(L.armed, L.armed);
    if (opts.length) pool = pick(opts);
    if (pool === L.shirt) return fill(pick(pool), colorName(lk.top));
  }
  if (kind === 'car' && about && Math.random() < 0.6) {
    const opts = [L.carColor];
    if (L[about.kind]) opts.push(L[about.kind]);
    if (about.wrecked) opts.push(L.wrecked, L.wrecked);
    pool = pick(opts);
    if (pool === L.carColor) return fill(pick(pool), colorName(about.color ?? 0x888888));
  }
  return pick(pool);
}
const fill = (s, c) => s.replaceAll('{c}', c).replaceAll('{C}', c[0].toUpperCase() + c.slice(1));

const PART_WORD = { head: 'Head', chest: 'Chest', spine: 'Gut', pelvis: 'Gut', upper: 'Arm', fore: 'Arm', thigh: 'Leg', shin: 'Leg', foot: 'Foot' };
/**
 * A cry of pain for a hit on body part `part` (a ragdoll part name: 'foreL', 'head'...).
 * how: 'pain' (struck) | 'shot' | 'lost' (cut off) | 'broke'. Left/right filled in.
 */
export function painLine(part, how = 'pain') {
  const kind = part.replace(/[LR]$/, ''), side = part.endsWith('L') ? 'left' : part.endsWith('R') ? 'right' : '';
  let key;
  if (how === 'lost') key = kind === 'fore' ? 'lostHand' : kind === 'upper' ? 'lostArm' : kind === 'thigh' || kind === 'shin' ? 'lostLeg' : null;
  else if (how === 'broke') key = kind === 'upper' || kind === 'fore' ? 'brokeArm' : 'brokeLeg';
  else key = (how === 'shot' ? 'shot' : 'pain') + (PART_WORD[kind] || 'Chest');
  const pool = L[key] || L.hurt;
  let s = pick(pool);
  // (no side to name: drop the word)
  s = side ? s.replaceAll('{s}', side).replaceAll('{S}', side.toUpperCase()) : s.replaceAll('{s} ', '').replaceAll('{S} ', '');
  return s;
}
/** A line of `kind` with a colour name filled in (clothes remarks). */
export function colorLine(kind, hex) { return fill(pick(L[kind] || L.chat), colorName(hex)); }
/** A gendered variant if there is one ('horror' -> 'horrorF' for a woman). */
export function lineFor(kind, female) { return line(female && L[kind + 'F'] ? kind + 'F' : kind); }
