/*
  The connection to the multiplayer room (server.js): join / leave, send, and message
  handlers by type. Everything game-side lives in mp.js.
*/

// connection ids as strings everywhere (a bare number means a pedestrian, see mp.js ref())
const S = (x) => (x === null || x === undefined ? null : String(x));
function norm(m) {
  switch (m.t) {
    case 'welcome':
      m.you = S(m.you); m.host = S(m.host);
      for (const p of m.players || []) p.id = S(p.id);
      m.owners = (m.owners || []).map(([c, id]) => [c, S(id)]);
      break;
    case 'join': m.player.id = S(m.player.id); break;
    case 'host': case 'left': case 'own': case 'p': case 'look': m.id = S(m.id); break;
    case 'e': m.from = S(m.from); break;
  }
}

export class Net {
  constructor() {
    this.room = null;
    this.id = null;
    this.host = null;
    this.handlers = {};
    this.live = false;
    this.lobby = null;     // the lobby number we're in (server.js)
    this.wantLobby = null; // where to go when we connect
    this.code = null;      // a private lobby's invite code, when we're in one (server.js)
    this.wantCode = null;  // a private lobby to go into when we connect
  }

  get isHost() { return !this.live || this.host === this.id; }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, m) { for (const fn of this.handlers[type] || []) fn(m); }

  async connect(level) {
    this.level = level;
    if (this.room || !window.WebsimSocket?.joinRoom) return false;
    try {
      this.room = await window.WebsimSocket.joinRoom();
    } catch (e) {
      console.warn('multiplayer: could not join', e);
      this.room = null;
      return false;
    }
    this.room.onmessage = (ev) => {
      let m;
      try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (!m || !m.t) return;
      norm(m);
      if (m.t === 'welcome') { this.id = m.you; this.host = m.host; this.live = true; this.lobby = m.lobby ?? null; this.code = m.code || null; this.cap = m.cap ?? null; }
      else if (m.t === 'host') this.host = m.id;
      this.emit(m.t, m);
    };
    // the room restarted or the transport dropped: a fresh welcome follows
    this.room.onreconnect = () => { this.live = false; this.emit('reset', {}); if (this.code) this.goPrivate(this.code, true); else this.hello(); };
    this.room.onclose = (ev) => { this.live = false; this.room = null; this.emit('closed', ev); };
    if (this.wantCode) this.goPrivate(this.wantCode);
    else this.hello();
    return true;
  }
  /**
   * Into the world: the lobby we were in (back after a dropped connection), else the one picked
   * before the page loaded (a lobby on another level, from the lobby menu), else the server's pick.
   */
  hello(lobby = this.lobby ?? this.wantLobby ?? null, swap = false) {
    try { this.room?.send({ t: 'hello', level: this.level, look: this.lookFn?.() || null, lobby, swap }); } catch { /* retried on reconnect */ }
  }
  /** Every lobby going: resolves { list: [{ map, n, count, cap, names }], online, cap }, or null. */
  lobbies() {
    if (!this.room) return Promise.resolve(null);
    return new Promise((res) => {
      const done = (m) => { clearTimeout(t); this.handlers.lobbies = (this.handlers.lobbies || []).filter((f) => f !== done); res(m); };
      const t = setTimeout(() => done(null), 4000);
      this.on('lobbies', done);
      try { this.room.send({ t: 'lobbies' }); } catch { done(null); }
    });
  }
  /** Over to lobby n of this level ('new': a fresh, empty one). A full one answers 'lobbyFull'. */
  swap(n) { this.hello(n, true); }
  /**
   * Into a private lobby: 'new' opens one (the welcome carries its code), else the one with this
   * code. Answers: 'badCode' (no such lobby), 'codeMap' (it's on another level), 'lobbyFull'.
   */
  goPrivate(code, rejoin = false) {
    try { this.room?.send({ t: 'hello', level: this.level, look: this.lookFn?.() || null, priv: code, rejoin, swap: true }); } catch { /* retried on reconnect */ }
  }
  /** Ask someone playing (a conn id) over to where we are. */
  invite(id) { this.send({ t: 'invite', to: id }); }

  send(m) {
    if (!this.live || !this.room) return;
    try { this.room.send(m); } catch { /* dropped */ }
  }

  close() {
    const r = this.room;
    this.room = null;
    this.live = false;
    this.id = this.host = null;
    try { r?.close?.(); } catch { /* already gone */ }
    this.emit('reset', {});
  }
}
