/*
  Bloodline multiplayer relay - a Cloudflare Worker whose realtime half is one Durable Object
  per room. A "room" is a level, so everyone on the same map is together (the host simulates
  that map's pedestrians and parked cars, and the NPC indices in a snapshot only mean anything
  to someone on the same map).

  The Worker owns no game logic - it is a relay with three small jobs:
    1. hand out a connection id and tell a newcomer who else is here (and who the host is);
    2. tell everyone else when someone joins, leaves, or changes outfit / name;
    3. arbitrate who is driving which car (first to sit at the wheel gets it).

  Everything else (snapshots `p` / `w`, events `e`) is passed straight through to the others,
  tagged with the sender's id, so the clients can puppet each other.

  It uses the Durable Object *hibernation* API (`state.acceptWebSocket`) - while nothing is
  being sent a room costs nothing to keep open, which is what makes the free plan go a long
  way. Per-socket state lives in the socket's attachment (it survives hibernation) and car
  claims live in the object's storage. Rooms are SQLite-backed, which is what the free plan
  requires.

  Deploy: see cloudflare/README.md. Client side: multiplayer/net.js (the URL constant there).
*/

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

// Only these pages may open a room (the relay is public, so it is worth knowing who is using it):
// the game's own site, plus localhost while developing.
const ORIGINS = [
  'https://nottrashgames-hue.github.io',
];
function originOk(origin, url) {
  if (!origin) return true;                 // (a WebSocket from a sandboxed page can have none)
  if (ORIGINS.includes(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    if (h === 'localhost' || h === '127.0.0.1') return true;
    if (h.endsWith('.workers.dev')) return true;
  } catch (e) { /* not a URL: refuse below */ }
  return false;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/ws' || url.pathname === '/') {
      const upgrade = req.headers.get('Upgrade') || '';
      if (!upgrade.toLowerCase().includes('websocket')) {
        return json({ ok: true, service: 'bloodline-mp', hint: 'connect a WebSocket to /ws?level=<name>' });
      }
      if (!originOk(req.headers.get('Origin'), url)) {
        return new Response('forbidden origin', { status: 403, headers: CORS });
      }
      const level = roomName(url.searchParams.get('level'));
      const id = env.ROOMS.idFromName(level);
      return env.ROOMS.get(id).fetch(req);
    }

    return json({ ok: true, service: 'bloodline-mp' });
  },
};

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });
}
/** A level name -> a stable room name (one Durable Object per room). */
function roomName(level) {
  const s = String(level || 'menu').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return s || 'menu';
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._cars = null;   // car index -> player id (loaded from storage on first use)
  }

  // ---- the socket ----
  async fetch(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID().slice(0, 8);
    // (not in the room until it says hello: a socket that never does is never announced)
    const att = { id, name: null, look: null, joined: false, at: Date.now() };
    server.serializeAttachment(att);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    let m;
    try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const att = ws.deserializeAttachment() || {};
    if (m.t === 'hello') return this.hello(ws, att, m);
    if (!att.joined) return;                       // nothing else counts before hello

    switch (m.t) {
      case 'name': {
        const name = clean(m.name, 16) || att.name;
        this.setAtt(ws, { ...att, name });
        this.broadcast({ t: 'name', id: att.id, name }, att.id);
        return;
      }
      case 'claim': return this.claim(ws, att, m);
      case 'release': return this.release(att, m);
      case 'rtc': {
        // voice / WebRTC signalling: to one player only (never broadcast)
        const to = String(m.to ?? '');
        const s = JSON.stringify({ t: 'rtc', from: att.id, sdp: m.sdp, ice: m.ice });
        for (const other of this.state.getWebSockets()) {
          const o = other.deserializeAttachment() || {};
          if (o.joined && o.id === to) { try { other.send(s); } catch (e) { /* dropped */ } return; }
        }
        return;
      }
      case 'p': case 'e': {
        const out = { ...m, id: att.id };
        if (m.t === 'e') out.from = att.id;        // (the game reads m.from for events)
        this.broadcast(out, att.id);
        return;
      }
      case 'w': {
        if (this.hostId() !== att.id) return;      // only the host runs the world
        this.broadcast({ ...m, id: att.id }, att.id);
        return;
      }
      case 'lobbies': {
        this.send(ws, { t: 'lobbies', list: [], online: this.count(), cap: 16 });
        return;
      }
      default: return;
    }
  }

  async webSocketClose(ws) { return this.leave(ws); }
  async webSocketError(ws) { return this.leave(ws); }

  // ---- the protocol ----
  async hello(ws, att, m) {
    const first = !att.joined;
    const name = clean(m.name, 16) || att.name || 'Player';
    const look = m.look ?? att.look ?? null;
    const next = { ...att, name, look, joined: true };
    if (first) next.at = Date.now();               // (join order decides the host)
    this.setAtt(ws, next);

    const players = [];
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const o = other.deserializeAttachment() || {};
      if (o.joined) players.push({ id: o.id, name: o.name, look: o.look });
    }
    const cars = await this.cars();
    this.send(ws, {
      t: 'welcome', you: att.id, host: this.hostId(null, next),
      players, owners: Object.entries(cars).map(([c, id]) => [Number(c), id]),
      lobby: 0, code: null, cap: 16,
    });

    if (first) this.broadcast({ t: 'join', player: { id: att.id, name, look } }, att.id);
    else this.broadcast({ t: 'look', id: att.id, look }, att.id);
  }

  async claim(ws, att, m) {
    const cars = await this.cars();
    const car = Number(m.car);
    if (!Number.isInteger(car)) return;
    const held = cars[car];
    if (held && held !== att.id) { this.send(ws, { t: 'deny', car }); return; }
    cars[car] = att.id;
    await this.state.storage.put('cars', cars);
    this.broadcast({ t: 'own', car, id: att.id });   // (the claimer included: it's a confirmation)
  }

  async release(att, m) {
    const cars = await this.cars();
    const car = Number(m.car);
    if (cars[car] === att.id) delete cars[car];
    await this.state.storage.put('cars', cars);
    this.broadcast({ t: 'own', car, id: null, s: m.s });
  }

  async leave(ws) {
    const att = ws.deserializeAttachment() || {};
    if (!att.id) return;
    const before = this.hostId();
    try { ws.close(); } catch (e) { /* already gone */ }
    // a car they were driving goes back to the room (the host picks it up again)
    const cars = await this.cars();
    let changed = false;
    for (const [c, id] of Object.entries(cars)) {
      if (id === att.id) { delete cars[c]; this.broadcast({ t: 'own', car: Number(c), id: null }); changed = true; }
    }
    if (changed) await this.state.storage.put('cars', cars);
    if (att.joined) this.broadcast({ t: 'left', id: att.id });
    const after = this.hostId();
    if (after && after !== before) this.broadcast({ t: 'host', id: after });
  }

  // ---- helpers ----
  setAtt(ws, att) { ws.serializeAttachment(att); }
  /** The host is whoever has been here longest (so it survives hibernation in the attachments). */
  hostId(skip = null, extra = null) {
    let best = null, bestAt = Infinity;
    for (const ws of this.state.getWebSockets()) {
      const a = ws === skip ? extra : (ws.deserializeAttachment() || null);
      if (!a || !a.joined) continue;
      const at = a.at ?? Infinity;
      if (at < bestAt || (at === bestAt && best && String(a.id) < String(best))) { best = a.id; bestAt = at; }
    }
    return best;
  }
  count() {
    let n = 0;
    for (const ws of this.state.getWebSockets()) if ((ws.deserializeAttachment() || {}).joined) n++;
    return n;
  }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch (e) { /* dropped */ } }
  broadcast(m, exceptId = null) {
    const s = JSON.stringify(m);
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (!a.joined || a.id === exceptId) continue;
      try { ws.send(s); } catch (e) { /* dropped */ }
    }
  }
  async cars() {
    if (!this._cars) this._cars = (await this.state.storage.get('cars')) || {};
    return this._cars;
  }
}

function clean(s, n) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
}
