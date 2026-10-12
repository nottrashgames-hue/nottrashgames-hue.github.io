/*
  Multiplayer relay for the street sandbox. Everyone in the same lobby of a level shares one world.
  Each client simulates its own player; the HOST of a level (whoever has been there longest)
  also simulates the shared world - pedestrians, traffic, every car nobody is driving - and
  streams it to the others. A car being driven by a player belongs to that player. This room
  keeps the roster per level, picks each level's host, hands car ownership out one driver at
  a time, and relays state and events between the clients on a level.
*/

/*
  Lobbies: each level is split into numbered lobbies of at most LOBBY_CAP players, each its own
  world (its own host, its own cars). A player's `level` below is really their lobby's key,
  "city#2"; `map` is the level and `lobby` the number. Someone arriving without a pick goes to
  the fullest lobby of their level that still has room (so they fill up instead of scattering),
  or a fresh one when they're all full; empty lobbies just stop existing. Anyone can ask for the
  list of lobbies ({t:'lobbies'}) and move to another one, or a new empty one (a hello naming it).
*/
const LOBBY_CAP = 16;
const keyOf = (map, n) => `${map}#${n}`;
// private lobbies: invite code -> { map }. Their level key is `${map}#p:${code}`; they're never
// listed, never auto-picked, and only reachable with the code (or an invite from inside)
const privates = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!privates.has(c)) return c;
  }
}
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const inviteT = new Map(); // `${from}>${to}` -> last invite time (one per 8s)
const players = new Map(); // conn.id -> { id, name, level (the lobby key), map, lobby, joined }
const levels = new Map();  // level -> { host, owners: Map(car index -> conn.id) }
let seq = 0;

// the admins (keep in step with admin.js ADMINS)
const ADMINS = ['rick_deckard', 'awebb55', 'memetemple', 'happyhamster', 'kotsoft', 'greenthelee'];
// who may nuke (keep in step with admin.js: ADMINS minus NO_NUKE)
const NUKERS = ['rick_deckard', 'awebb55', 'happyhamster', 'kotsoft', 'greenthelee'];

const nameOf = (conn) => conn.username || `guest${String(conn.id).slice(-4)}`;
const lvl = (name) => {
  let L = levels.get(name);
  if (!L) levels.set(name, L = { host: null, owners: new Map() });
  return L;
};
const on = (level) => [...players.values()].filter((p) => p.level === level);

/** To everyone on `level` except `skip` (a conn id). */
function toLevel(room, level, m, skip = null) {
  const except = [];
  for (const p of players.values()) if (p.level !== level || p.id === skip) except.push(p.id);
  // (players who haven't said hello yet aren't anywhere)
  room.broadcast(m, { except: [...except, ...pending] });
}
const pending = new Set(); // connected, no level yet

function pickHost(room, level) {
  const L = lvl(level);
  let best = null;
  // (the longest there - but someone who's actually playing over someone whose tab is hidden)
  for (const p of on(level)) if (!best || (!!p.away === !!best.away ? p.joined < best.joined : !p.away)) best = p;
  L.host = best ? best.id : null;
  if (!best) { levels.delete(level); return; }
  L.hostT = Date.now();
  toLevel(room, level, { t: 'host', id: L.host });
}

/*
  The host runs the world for everyone: a host whose tab is hidden draws no frames (the world
  stops for everyone), and one running slowly runs it in slow motion. Clients report how they're
  running ({t:'st', away, fps}); the world goes to someone better placed - not too often, since
  every hand-over is a hitch of its own.
*/
const REHOST_AWAY = 3000, REHOST_SLOW = 20000; // ms since the last pick before another
const SLOW_FPS = 20;
function checkHost(room, level) {
  const L = levels.get(level);
  const cur = L && players.get(L.host);
  if (!cur || cur.level !== level) return;
  const since = Date.now() - (L.hostT || 0);
  const others = on(level).filter((p) => p.id !== cur.id && !p.away);
  if (!others.length) return;
  // (the fastest of them; not reported yet counts as middling, and the longest there breaks ties)
  const rate = (p) => (typeof p.fps === 'number' ? p.fps : 30);
  const best = others.reduce((a, b) => (rate(b) > rate(a) || (rate(b) === rate(a) && b.joined < a.joined) ? b : a));
  let to = null;
  if (cur.away) {
    if (since < REHOST_AWAY) return;
    to = best;
  } else if (typeof cur.fps === 'number' && cur.fps < SLOW_FPS) {
    if (since < REHOST_SLOW) return;
    if (typeof best.fps === 'number' && best.fps >= Math.max(30, cur.fps * 1.5)) to = best;
  }
  if (!to) return;
  L.host = to.id;
  L.hostT = Date.now();
  toLevel(room, level, { t: 'host', id: L.host });
}

/** How many are in each lobby of `map` (by number), leaving out `skip`. */
function counts(map, skip = null) {
  const c = new Map();
  for (const p of players.values()) if (p.map === map && p.level && !p.priv && p.id !== skip) c.set(p.lobby, (c.get(p.lobby) || 0) + 1);
  return c;
}
/** The lowest lobby number of `map` nobody is in. */
function freeLobby(map, skip) {
  const c = counts(map, skip);
  let n = 1;
  while (c.has(n)) n++;
  return n;
}
/** Where someone arriving on `map` goes: the fullest lobby with room, else a new one. */
function autoLobby(map, skip) {
  let best = null, bestN = -1;
  for (const [n, k] of counts(map, skip)) if (k < LOBBY_CAP && (k > bestN || (k === bestN && n < best))) { best = n; bestN = k; }
  return best ?? freeLobby(map, skip);
}
/** Every lobby going, with who's in it (for the lobby menu). */
function lobbyList() {
  const L = new Map();
  for (const p of players.values()) {
    if (!p.level || p.priv) continue;
    let e = L.get(p.level);
    if (!e) L.set(p.level, e = { map: p.map, n: p.lobby, count: 0, cap: LOBBY_CAP, names: [] });
    e.count++;
    if (e.names.length < 24) e.names.push(p.name);
  }
  return [...L.values()].sort((a, b) => (a.map < b.map ? -1 : a.map > b.map ? 1 : a.n - b.n));
}

function leave(room, p) {
  const L = levels.get(p.level);
  if (!L) return;
  const level = p.level;
  p.level = null;
  for (const [c, id] of L.owners) if (id === p.id) { L.owners.delete(c); toLevel(room, level, { t: 'own', car: c, id: null }); }
  toLevel(room, level, { t: 'left', id: p.id });
  if (L.host === p.id) pickHost(room, level);
  else if (!on(level).length) levels.delete(level);
  // (a private lobby with nobody left in it: its code is done)
  if (p.priv && !on(level).length) privates.delete(p.priv);
  p.priv = null;
}
/** Everyone playing (for the invite list): id, name, where. */
function peopleList() {
  const out = [];
  for (const p of players.values()) if (p.level && out.length < 80) out.push({ id: p.id, name: p.name, map: p.map, lobby: p.priv ? null : p.lobby, priv: !!p.priv });
  return out;
}

export const room = {
  async onConnect(conn) {
    pending.add(conn.id);
    players.set(conn.id, { id: conn.id, name: nameOf(conn).slice(0, 24), level: null, joined: 0 });
  },

  async onMessage(conn, message, room) {
    const me = players.get(conn.id);
    if (!me) return;
    let m;
    try { m = typeof message === 'string' ? JSON.parse(message) : message; } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    // the lobby menu: every lobby going (and how many are playing in all)
    if (m.t === 'lobbies') {
      conn.send({ t: 'lobbies', list: lobbyList(), people: peopleList(), online: [...players.values()].filter((p) => p.level).length, cap: LOBBY_CAP });
      return;
    }
    if (m.t === 'hello') {
      const map = String(m.level || 'baseplate').replace(/#/g, '').slice(0, 24);
      // which lobby: the one asked for if it has room ('new': a fresh one), else the auto pick.
      // (asked for a full one on purpose - a swap - is refused, and they stay where they are)
      // a private lobby: a new one ('priv: new'), or one by its code
      let priv = null;
      if (m.priv === 'new') { priv = newCode(); privates.set(priv, { map }); }
      else if (m.priv) {
        const code = cleanCode(m.priv), P = privates.get(code);
        if (!P) {
          // (back after the room restarted: the lobby we were in comes back under its code)
          if (m.rejoin && code.length === 6) privates.set(code, { map });
          else { conn.send({ t: 'badCode', code }); return; }
        } else if (P.map !== map) { conn.send({ t: 'codeMap', code, map: P.map }); return; }
        else if (on(keyOf(map, 'p:' + code)).filter((p) => p.id !== conn.id).length >= LOBBY_CAP) { conn.send({ t: 'lobbyFull', code }); return; }
        priv = code;
      }
      let n = null;
      if (priv) n = 0;
      else if (m.lobby === 'new') n = freeLobby(map, conn.id);
      else if (Number.isInteger(m.lobby) && m.lobby > 0 && m.lobby < 1000) {
        if ((counts(map, conn.id).get(m.lobby) || 0) < LOBBY_CAP) n = m.lobby;
        else if (m.swap && me.level) { conn.send({ t: 'lobbyFull', lobby: m.lobby }); return; }
      }
      if (n === null) n = autoLobby(map, conn.id);
      const level = priv ? keyOf(map, 'p:' + priv) : keyOf(map, n);
      if (me.level) leave(room, me);
      me.priv = priv;
      pending.delete(conn.id);
      me.name = room.censor(me.name);
      me.map = map;
      me.lobby = n;
      me.level = level;
      me.joined = ++seq;
      me.look = cleanLook(m.look); // (what they look like: everyone builds their body from it)
      const L = lvl(level);
      if (!L.host || !players.has(L.host)) { L.host = conn.id; L.hostT = Date.now(); }
      conn.send({ t: 'welcome', you: conn.id, host: L.host, players: on(level), owners: [...L.owners], map, lobby: priv ? null : n, code: priv, cap: LOBBY_CAP });
      toLevel(room, level, { t: 'join', player: me }, conn.id);
      return;
    }
    // an invite: someone playing asked over to where we are (a toast with a Join button)
    if (m.t === 'invite') {
      const to = [...players.values()].find((p) => String(p.id) === String(m.to));
      if (!me.level || !to?.level || to.id === conn.id || to.level === me.level) return;
      const k = conn.id + '>' + to.id, now = Date.now();
      if (now - (inviteT.get(k) || 0) < 8000) return;
      inviteT.set(k, now);
      if (inviteT.size > 2000) inviteT.clear();
      room.broadcast({ t: 'invite', from: me.name, map: me.map, lobby: me.priv ? null : me.lobby, code: me.priv || null },
        { except: [...players.keys()].filter((id) => id !== to.id) });
      conn.send({ t: 'invited', name: to.name });
      return;
    }
    // an admin's message across the top of everyone's screen, in every lobby, for s seconds
    if (m.t === 'announce') {
      const who = String(conn.username || '');
      if (!ADMINS.includes(who.toLowerCase())) return;
      const text = String(m.text || '').trim().slice(0, 200);
      if (!text) return;
      const s = Math.min(600, Math.max(3, Math.round(+m.s || 10)));
      room.broadcast({ t: 'announce', text, s, from: who }, { except: [...pending] });
      return;
    }
    const level = me.level;
    if (!level) return;
    const L = lvl(level);
    switch (m.t) {
      // continuous state: a player's own body (and car); the host's world
      case 'p':
        m.id = conn.id;
        toLevel(room, level, m, conn.id);
        return;
      case 'w':
        if (conn.id !== L.host) return;
        toLevel(room, level, m, conn.id);
        return;
      // how this player is running (mp.js status): hidden tab, framerate
      case 'st':
        me.away = !!m.away;
        me.fps = typeof m.fps === 'number' && Number.isFinite(m.fps) ? Math.max(0, Math.min(1000, m.fps)) : null;
        checkHost(room, level);
        return;
      // taking the wheel: one driver per car
      case 'claim': {
        const c = m.car | 0, cur = L.owners.get(c);
        if (cur && cur !== conn.id && players.get(cur)?.level === level) { conn.send({ t: 'deny', car: c }); return; }
        L.owners.set(c, conn.id);
        toLevel(room, level, { t: 'own', car: c, id: conn.id });
        return;
      }
      case 'release': {
        const c = m.car | 0;
        if (L.owners.get(c) !== conn.id) return;
        L.owners.delete(c);
        toLevel(room, level, { t: 'own', car: c, id: null, s: m.s });
        return;
      }
      // a change of outfit (the wardrobe, the FUN menu): remembered for anyone who joins later
      case 'look':
        me.look = cleanLook(m.look);
        toLevel(room, level, { t: 'look', id: conn.id, look: me.look }, conn.id);
        return;
      // one-off events (a shot, a blow, a prop smashed, a line said): relayed as they are
      case 'e':
        m.from = conn.id;
        if (m.k === 'nade') {
          // (who threw it is who sent it - never taken on the sender's word)
          m.by = String(conn.id);
          // a nuke only from an account that's allowed one (admin.js canNuke), by its real username
          if (m.a === 'n' && !NUKERS.includes(String(conn.username || '').toLowerCase())) return;
        }
        if (m.k === 'say' && typeof m.x === 'string') m.x = room.censor(m.x.slice(0, 200));
        toLevel(room, level, m, conn.id);
        return;
    }
  },

  async onClose(conn, room) {
    const p = players.get(conn.id);
    pending.delete(conn.id);
    if (p) leave(room, p);
    players.delete(conn.id);
  },
};

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
