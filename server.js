// (the old realtime multiplayer room - lobbies, hosts, relaying - is gone: see multiplayer/GUIDE.md)

// saved progress per signed-in player: the wallet and the outfit; who might want to hear from
// us (seen: every signed-in visitor - websim itself decides who actually subscribed); which
// skin notices and update notices have gone out
export const schema = `
  CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, username TEXT, cash INTEGER NOT NULL DEFAULT 0, look TEXT, updated INTEGER);
  CREATE TABLE IF NOT EXISTS seen (user_id TEXT PRIMARY KEY, username TEXT, last INTEGER);
  CREATE TABLE IF NOT EXISTS skin_news (username TEXT NOT NULL, what TEXT NOT NULL, user_id TEXT, done INTEGER NOT NULL DEFAULT 0, tried INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (username, what));
  CREATE TABLE IF NOT EXISTS releases (version TEXT PRIMARY KEY, sent INTEGER);
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, username TEXT, content TEXT, credits INTEGER NOT NULL DEFAULT 0, created TEXT, done INTEGER NOT NULL DEFAULT 0, seen INTEGER);
`;
// the character requests list (requests.js): Rick_Deckard's alone - the owner, or him by name
const isRick = (request) => {
  const id = request.headers.get('x-websim-user-id');
  return !!id && ((request.headers.get('x-websim-username') || '').toLowerCase() === 'rick_deckard' || id === request.headers.get('x-websim-project-owner-id'));
};

/*
  Notifications (opt-in from the game: Settings -> Notifications, or the Donate panel).
    - A skin: add its owner to SKINS (the same body goes in special.js). The next time anyone
      plays, its owner is told it's ready - as soon as they've opted in, however long that takes.
    - An update: bump VERSION and say what's new in UPDATE. The next visit after it's
      published sends it once to everyone who's opted in.
*/
const VERSION = '2026-09-28d';
const UPDATE = 'New special skins: Seek from DOORS with blood full of eyes (@Birch_tree), a green alien with galaxy blood (@grumpymongoose0879546) and a store manager (@kotsoft).';
// websim username (exact case) -> what they were given
const SKINS = {
  rick_deckard: 'two skins: a solid gold body, and Dracula - a vampire who drinks blood (hold someone with E, click to bite)', awebb55: 'the suit and hockey mask', kat_gaming: 'two skins: a cat in a hoodie, and Scratch Cat with blood of falling green code',
  absolutely_aaden123: 'a cel-shaded toon body', baldibasic: 'a smiley blond kid - closed eyes, yellow hair, green and orange shirt', scoutsolete_gaming: 'the Scout',
  saint_rainworld: 'Saint the slugcat', tok3n: 'a sleek cat', greesy: 'three skins: Papyrus, Michael Jackson, and Scratch Cat with blood of falling green code', LightHorus: 'a psychedelic fractal body',
  Bnolb: 'Gordon Freeman\'s HEV suit', Jel_manz: 'a red fallen angel', Grayoli1313: 'two skins: red spiked hair with headphones, and a red cap with a black shirt and a red G', HappyHamster: 'two skins: silver skin, golden hair and prism blood, and Virginia - three arms, three legs, a blonde ponytail and a one-piece swimsuit (pick her in the FUN menu)',
  Birch_tree: 'five skins: the silhouette, a black widow spider with walking legs, Seek - with blood full of eyes, Fatboy - who blows up when he dies, and the Figure - who bleeds its own flesh',
  Kaleb: 'Jason Voorhees - the hockey mask, the work jacket and the boots',
  false: 'a figure of black pieces outlined in glowing red and white, with a no sign for a face',
  uglysail8737642: 'a shining gold suit and bright gold blood',
  GentVR: 'a green alien with swirling eyes, a beanie, earrings and galaxy blood - your clothes and beanie colour are still yours to pick',
  kotsoft: 'the store manager: shirt and tie, name badge, lanyard and glasses',
  greenthelee: 'a happy pink rat with a heart-shaped tail and green blood',
  '99aka69R9': 'a drooling green slime in a little top hat',
  me67or: 'an all-green body with green blood and a white lowercase m on the face',
  itsmeagain: 'a glowing glitch skin with shifting scanlines, chromatic fragments and bright eyes',
  realcray: 'an invincible radiant white body with blazing yellow eyes',
  sillyguirt50: 'glowing color-shifting wings and double-jump flight',
  MemeTemple: 'a guy in a suit with a smiley emoji for a face, and hot pink blood',
  ketchupdev: 'an anthro raccoon with red eyes - double-tap Shift while running to sprint on all fours (it keeps going until you press Shift again or stop)',
};

async function notify(env, msg) {
  try { return await env.NOTIFICATIONS.send(msg); } catch { return null; } // (over the cap, or not available: drop it)
}

/** The websim user id for a username: from our own visitors first, else websim's API. */
async function userIdOf(env, name) {
  const row = await env.DB.prepare('SELECT user_id FROM seen WHERE lower(username) = lower(?) UNION SELECT user_id FROM profiles WHERE lower(username) = lower(?) LIMIT 1').bind(name, name).first();
  if (row?.user_id) return row.user_id;
  try {
    const r = await fetch(`https://websim.com/api/v1/users/${encodeURIComponent(name)}`);
    if (r.ok) return (await r.json())?.user?.id || null;
  } catch { /* offline */ }
  return null;
}

/** Anything still owed: skin owners not yet told (retried every 10 min till it lands), this VERSION's notice. */
async function sendPending(env) {
  const now = Date.now();
  const rows = (await env.DB.prepare('SELECT username, what, user_id, done, tried FROM skin_news').all()).results || [];
  const known = new Map(rows.map((r) => [r.username.toLowerCase() + '|' + r.what, r]));
  for (const [name, what] of Object.entries(SKINS)) {
    const r = known.get(name.toLowerCase() + '|' + what);
    if (r?.done || (r && now - r.tried < 10 * 60e3)) continue;
    await env.DB.prepare('INSERT INTO skin_news (username, what, tried) VALUES (?, ?, ?) ON CONFLICT(username, what) DO UPDATE SET tried = excluded.tried').bind(name, what, now).run();
    const id = r?.user_id || await userIdOf(env, name);
    if (!id) continue;
    if (!r?.user_id) await env.DB.prepare('UPDATE skin_news SET user_id = ? WHERE username = ? AND what = ?').bind(id, name, what).run();
    const res = await notify(env, {
      recipients: [id],
      title: 'Your custom character is ready!',
      body: `You've been given ${what}. Jump in and play as it - everyone sees it on you.`,
      path: '/',
      idempotencyKey: `skin:${name.toLowerCase()}:${what}`.slice(0, 190),
    });
    if (res && (res.delivered > 0 || res.skipped?.duplicate > 0)) {
      await env.DB.prepare('UPDATE skin_news SET done = 1 WHERE username = ? AND what = ?').bind(name, what).run();
    }
  }
  // the update notice: claimed by exactly one request, released again if sending failed
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO releases (version, sent) VALUES (?, ?)').bind(VERSION, now).run();
  if (!claim.meta?.changes) return;
  const ids = ((await env.DB.prepare('SELECT user_id FROM seen UNION SELECT user_id FROM profiles').all()).results || []).map((r) => r.user_id);
  let ok = true;
  for (let i = 0; i < ids.length; i += 100) {
    const res = await notify(env, {
      recipients: ids.slice(i, i + 100), title: 'New update is out', body: UPDATE, path: '/',
      idempotencyKey: `release:${VERSION}`,
    });
    if (!res) { ok = false; break; }
  }
  if (!ok) await env.DB.prepare('DELETE FROM releases WHERE version = ?').bind(VERSION).run();
}

const LOOK_KEYS = ['top', 'shorts', 'shoe', 'hair', 'skin', 'hairStyle', 'sleeves', 'legs', 'beard', 'owned',
  'sex', 'height', 'build', 'limb', 'armLen', 'legLen', 'headSize', 'plain', 'variant',
  'handSize', 'footSize', 'neckLen', 'eyeSize', 'eyeColor', 'hairSize'];
// body proportions (the FUN menu): fractional, kept in a sane range
const SHAPE_RANGE = { height: [0.3, 2.6], build: [0.35, 3], limb: [0.3, 3], armLen: [0.35, 2.6], legLen: [0.35, 2.6], headSize: [0.35, 3.2],
  handSize: [0.4, 3], footSize: [0.4, 3], neckLen: [0.2, 4], eyeSize: [0.4, 2.6], hairSize: [0.6, 2.2] };
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const out = {};
  for (const k of LOOK_KEYS) {
    const v = l[k];
    if (typeof v === 'number' && Number.isFinite(v) && SHAPE_RANGE[k]) out[k] = Math.round(Math.min(SHAPE_RANGE[k][1], Math.max(SHAPE_RANGE[k][0], v)) * 1000) / 1000;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v | 0;
    else if (typeof v === 'string' && v.length < 16) out[k] = v;
    else if (v === null) out[k] = null;
    else if (k === 'owned' && Array.isArray(v)) out[k] = v.filter((s) => typeof s === 'string' && s.length < 24).slice(0, 64);
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // a frame that threw in someone's game (main.js): into the logs, to find what froze it
    if (url.pathname === '/api/clienterror' && request.method === 'POST') {
      const t = (await request.text()).slice(0, 4000);
      console.error('client frame error', request.headers.get('x-websim-username') || '?', t);
      return Response.json({ ok: true });
    }
    // a visit: remember who's been here, then send whatever notices are owed
    if (url.pathname === '/api/notify/sync' && request.method === 'POST') {
      const userId = request.headers.get('x-websim-user-id');
      if (userId) {
        await env.DB.prepare('INSERT INTO seen (user_id, username, last) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, last = excluded.last')
          .bind(userId, request.headers.get('x-websim-username') || null, Date.now()).run();
      }
      await sendPending(env);
      return Response.json({ ok: true, version: VERSION });
    }
    // donation requests: the list (GET), newly found ones from a comment scan (POST), checked off (POST done)
    if (url.pathname === '/api/requests' || url.pathname === '/api/requests/done') {
      if (!isRick(request)) return Response.json({ error: 'not yours' }, { status: 403 });
      if (request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT id, username, content, credits, created, done FROM requests ORDER BY credits DESC, created ASC').all();
        return Response.json({ items: results });
      }
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
      if (url.pathname === '/api/requests/done') {
        await env.DB.prepare('UPDATE requests SET done = ? WHERE id = ?').bind(body.done ? 1 : 0, String(body.id || '')).run();
        return Response.json({ ok: true });
      }
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const st = env.DB.prepare('INSERT INTO requests (id, username, content, credits, created, seen) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET content = excluded.content, credits = MAX(requests.credits, excluded.credits)');
      const now = Date.now();
      const batch = items.filter((it) => it && typeof it.id === 'string').map((it) => st.bind(
        it.id.slice(0, 64), String(it.username || '').slice(0, 64), String(it.content || '').slice(0, 2000),
        Math.max(0, Math.min(1e6, Math.floor(+it.credits || 0))), String(it.created || '').slice(0, 40), now));
      if (batch.length) await env.DB.batch(batch);
      return Response.json({ ok: true, added: batch.length });
    }
    if (url.pathname === '/api/profile') {
      const userId = request.headers.get('x-websim-user-id');
      if (!userId) return Response.json({ error: 'signed out' }, { status: 401 });
      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT cash, look, updated FROM profiles WHERE user_id = ?').bind(userId).first();
        if (!row) return Response.json({ found: false });
        let look = null;
        try { look = row.look ? JSON.parse(row.look) : null; } catch { /* bad row */ }
        return Response.json({ found: true, cash: row.cash, look, updated: row.updated || 0 });
      }
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
        const cash = Math.max(0, Math.min(1e9, Math.floor(+body.cash || 0)));
        const look = cleanLook(body.look);
        const username = request.headers.get('x-websim-username') || null;
        await env.DB.prepare(
          'INSERT INTO profiles (user_id, username, cash, look, updated) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, cash = excluded.cash, look = COALESCE(excluded.look, profiles.look), updated = excluded.updated'
        ).bind(userId, username, cash, look ? JSON.stringify(look) : null, Date.now()).run();
        return Response.json({ ok: true });
      }
    }
    return new Response('Not found', { status: 404 });
  },
};
