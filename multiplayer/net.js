/*
  The connection to the multiplayer room (the relay in cloudflare/worker.js: a Cloudflare
  Worker with one Durable Object per room). Join / leave, send, and message handlers by type.
  Everything game-side lives in session.js.

  A "room" is a level: everyone on the same map is in the same room, which is what the game's
  simulation wants (the host runs that map's pedestrians and parked cars, and the NPC indices
  in a snapshot only mean anything to someone on the same map).

  The wire protocol is the same one the game has always spoken (see multiplayer/GUIDE.md and
  the old websim net.js this replaces):

    out: { t:'hello', level, name, look }   first thing on the socket
         { t:'p', ts, a:[state], c:[[car,state]] }   our body, ~20 Hz
         { t:'w', ts, n, c, sig }                   the host's world, ~12 Hz
         { t:'e', k, ... }                          an event (hit, fire, emote, cash, ...)
         { t:'claim'|'release', car, s }            a car we're getting into / out of
    in:  { t:'welcome', you, host, players, owners, cap }
         { t:'join'|'left'|'host'|'look'|'own'|'deny'|'name' }
         { t:'p'|'w'|'e' }  relayed, tagged with the sender
*/

// connection ids as strings everywhere (a bare number means a pedestrian, see session.js ref())
const S = (x) => (x === null || x === undefined ? null : String(x));
function norm(m) {
  switch (m.t) {
    case 'welcome':
      m.you = S(m.you); m.host = S(m.host);
      for (const p of m.players || []) p.id = S(p.id);
      m.owners = (m.owners || []).map(([c, id]) => [c, S(id)]);
      break;
    case 'join': m.player.id = S(m.player.id); break;
    case 'host': case 'left': case 'own': case 'deny': case 'p': case 'look': case 'name': m.id = S(m.id); break;
    case 'e': case 'rtc': m.from = S(m.from); break;
  }
}

// Where the relay lives. A local test (node serve.js on 127.0.0.1) talks to `wrangler dev`.
// Anything else talks to the deployed Worker - set the real one in MP_URL below, or override
// at runtime with localStorage 'mpUrl' (handy for testing).
const MP_URL = 'wss://bloodline-mp.bloodlinevr.workers.dev/ws';
function relayUrl() {
  try {
    const over = localStorage.getItem('mpUrl');
    if (over) return over;
  } catch (e) { /* private mode */ }
  const h = location.hostname;
  if (h === '127.0.0.1' || h === 'localhost') return 'ws://127.0.0.1:8787/ws';
  return MP_URL;
}

const NAMES = ['Ash', 'Bones', 'Cinder', 'Dust', 'Ember', 'Fang', 'Ghost', 'Hollow', 'Ivory', 'Jinx',
  'Knell', 'Lark', 'Marrow', 'Nettle', 'Onyx', 'Pitch', 'Quill', 'Rust', 'Soot', 'Thorn', 'Vex', 'Wisp'];
function pickName() {
  try {
    const s = localStorage.getItem('mpName');
    if (s) return s;
  } catch (e) { /* private mode */ }
  // deterministic-ish but different for everyone at the table: the tab's own randomness
  const a = NAMES[Math.floor(Math.random() * NAMES.length)];
  return `${a}-${Math.floor(Math.random() * 90 + 10)}`;
}

export class Net {
  constructor() {
    this.room = null;      // the live WebSocket
    this.id = null;        // our conn id, from the welcome
    this.host = null;      // the room's host conn id
    this.handlers = {};
    this.live = false;     // we're in the room, and so is everyone else's state
    this.level = null;     // the room we're in (a level name)
    this.lobby = null;
    this.code = null;
    this.cap = null;
    this.wantLobby = null;
    this.wantCode = null;  // (rooms are per level now: no private codes, kept so callers don't break)
    this.lookFn = null;    // the game sets this: our outfit, sent with every hello
    this.name = pickName();
    this.want = false;     // the player asked to be online
    this.retry = 0;
    this.timer = null;
  }

  get isHost() { return !this.live || this.host === this.id; }
  /** 'off' | 'connecting' | 'online' | 'offline' - for the menu's status line. */
  get status() {
    if (!this.want) return 'off';
    if (this.live) return 'online';
    return this.room ? 'connecting' : 'offline';
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, m) { for (const fn of this.handlers[type] || []) fn(m); }
  /** Anything that changes the status line (connected, count, error) re-emits 'status'. */
  changed() { this.emit('status', { status: this.status, count: this.players?.size ?? null }); }

  /** Open (or re-open, if we've moved to another level) the room for `level`. */
  connect(level) {
    const changed = this.level && level && this.level !== level;
    this.level = level || this.level || 'menu';
    this.want = true;
    if (changed && this.room) this.drop();
    if (this.room) return true;
    this.open();
    return true;
  }

  /** Drop the socket (a map change: the new room is somewhere else) - the game hears 'reset'. */
  drop() {
    const r = this.room;
    this.room = null;
    this.live = false;
    this.id = this.host = null;
    if (r) { try { r.close(); } catch (e) { /* already gone */ } }
    this.emit('reset', {});
  }

  open() {
    clearTimeout(this.timer);
    let url;
    try { url = new URL(relayUrl()); } catch (e) { this.retryOpen(); return; }
    url.searchParams.set('level', this.level);
    let ws;
    try { ws = new WebSocket(url.toString()); } catch (e) { this.retryOpen(); return; }
    this.room = ws;
    this.changed();

    ws.onopen = () => { this.retry = 0; this.hello(); };
    ws.onmessage = (ev) => {
      let m;
      try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
      if (!m || !m.t) return;
      norm(m);
      if (m.t === 'welcome') {
        this.id = m.you; this.host = m.host; this.live = true;
        this.lobby = m.lobby ?? null; this.code = m.code || null; this.cap = m.cap ?? null;
      } else if (m.t === 'host') this.host = m.id;
      this.emit(m.t, m);
      this.changed();
    };
    // (only retry for the socket that's still ours: a map change closes the old one on purpose)
    ws.onclose = () => {
      if (this.room !== ws) return;
      const was = this.live;
      this.room = null; this.live = false; this.id = this.host = null;
      if (was) this.emit('reset', {});
      if (this.want) this.retryOpen(); else { this.changed(); this.emit('closed', {}); }
    };
    ws.onerror = () => { /* onclose always follows: nothing to do but wait for it */ };
  }

  retryOpen() {
    clearTimeout(this.timer);
    this.changed();
    if (!this.want) return;
    const wait = Math.min(15, 1 + this.retry * 1.5); // s: 1, 2.5, 4, ... 15
    this.retry++;
    this.timer = setTimeout(() => { if (this.want) this.open(); }, wait * 1000);
  }

  /** Into the world: our name, our outfit, and the level's room. */
  hello() {
    this.raw({ t: 'hello', level: this.level, name: this.name, look: this.lookFn?.() || null });
  }

  /** Set our name (from the multiplayer panel). The room hears about it at once. */
  setName(name) {
    const n = String(name || '').trim().slice(0, 16);
    if (!n || n === this.name) return;
    this.name = n;
    try { localStorage.setItem('mpName', n); } catch (e) { /* private mode */ }
    if (this.live) this.raw({ t: 'name', name: n });
    this.changed();
  }

  raw(m) {
    const ws = this.room;
    if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(m)); } catch (e) { /* dropped */ } }
  }
  send(m) { if (this.live) this.raw(m); }

  /** Leaving for good (the panel's Leave button): no retry, the game hears 'closed'. */
  close() {
    this.want = false;
    clearTimeout(this.timer);
    this.drop();
    this.changed();
    this.emit('closed', {});
  }

  // (rooms are per level: no lobbies, no private codes - these keep any old call site harmless)
  lobbies() { return Promise.resolve(null); }
  swap() { this.hello(); }
  goPrivate() {}
  invite() {}
}
