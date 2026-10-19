# Multiplayer guide (for whoever networks this next)

This game has **no working multiplayer right now**, on purpose. The old websim-realtime system
(`mp.js`, `net.js`, `itemsync.js`, `lobby.js` and the `room` export in `server.js`) was
removed. **Do not use websim's multiplayer / `WebsimSocket`.** Bring your own transport.

What *is* here is the seam: every place in the game that needs to tell other players something
already calls a method on one object, `mp`, built from `multiplayer/session.js`. Today
`Session` is the single-player version (`live = false`, `isHost = true`, every send a no-op).
Your job is a networked `Session` with the same methods. Switch `main.js` over at:

```js
// main.js (search "mp = new Session(")
mp = new Session({ scene, world, levelName, level, hero, npcs, vehicles, shots, props, ... });
```

The object passed in (`this.g`) holds everything you need: `scene`, `world` (Rapier),
`hero` (the local player's Actor), `npcs`, `addActor(actor, fresh)` / `removeActor(actor)`
(register / unregister a body with blood, shots, threats), `makeItem(type)` (a gun or melee by
type), `heldOf(actor)`, `itemMesh(code)`, `onRemoteFire`, `onRemoteEmote`, `look()` (our
outfit), and more - read the call in main.js.

> Reference: the deleted `mp.js` / `net.js` / `itemsync.js` did all of this over websim. They
> are in the project's revision history (any version before "remove the whole multiplayer
> system"). They are the best documentation of how to puppet a remote body - read them, port the
> snapshot/puppet code, replace the transport.

---

## 1. What exists and where

| File | What it is |
|---|---|
| `multiplayer/session.js` | The seam. Every method documented. Replace / subclass it. |
| `multiplayer/voice.js` | Voice-chat seam (`VoiceChat`), already built and ticked by main.js. |
| `mparena.js` | The **Multiplayer Arena** mode, local side: hand health bar, 4 s respawn. `healthOf(actor)` gives 0..1 health for any actor. |
| `sandbox-maps.js` `buildArena(scene, renderer, { mp: true })` | The arena map without the spawn room. Level flag: `level.mpArena = { half }`. Spawns are random spots in the pit (`spawnSpot()` in main.js - it already keeps a gap from `mp.players`). |
| `main.js` | `applyMode(L)` (no reset / no weapon wheel / no hotbar in the mp arena), `giveKnife()` (random melee per life in the mp arena), VR `onEnter` (a headset always starts in the menu room). |
| `sandbox-maps.js` `buildMainMenu` (level `start`) | Where everyone starts (a headset always does). Its board: **Multiplayer Arena** (`mparena`) or **Sandbox** (level `menu`, the single-player room with the maps board). The character customizer (dressing booth) is here. |
| `strike.js` `parry()` | Melee physically stopped by held items. Remote players' held items must be in `HELD_ITEMS` with `state = 'held'` and `owner` set for blocks to work against them. |

Level ids: `start` (main menu), `menu` (sandbox room), `baseplate`, `room`, `racetrack`, `arena` (single-player waves), `mparena`.

---

## 2. Pick a transport

The game is static files + an optional Cloudflare-Workers `server.js` (only HTTP `/api/*` -
no websockets in it now). So the realtime server lives somewhere else. Reasonable choices:

1. **A tiny WebSocket relay** (Node `ws`, Bun, Deno, PartyKit, Cloudflare Durable Objects on
   your own account, Colyseus). Clients connect with `new WebSocket(URL)`. Easiest to get right.
2. **WebRTC data channels** (e.g. PeerJS with its public broker, or your relay doing signalling).
   Lower latency, peer-to-peer; you still need signalling and TURN for some networks.

Voice needs WebRTC media either way (section 6), so a WebSocket relay that also does WebRTC
signalling covers everything.

Keep the URL in one constant at the top of your new session file. Allow the page's origin in the
server's CORS / origin check.

---

## 3. Authority model (keep the old one)

- **Every client simulates its own player** (`hero`): movement, its own ragdoll, its own death.
  Others see a **puppet**: an `Actor` with `actor.remote = true`, driven from snapshots.
- **One host per room** simulates the shared world (NPCs, cars, props). `mp.isHost` gates that
  in main.js already (`if (mp.isHost) streamer.update(dt)`, police, NPC resets...). In the mp
  arena there are no NPCs, so the host only matters for room state (scores, round timer if you
  add one). Host = whoever's been in the room longest; re-pick when they leave.
- **Hits are decided by the attacker, applied by the owner.** When your swing lands on a puppet,
  the game calls `actor.onRemoteHit(kind, vel, power, by, ...)` on it (melee.js, shots.js). For
  NPCs main.js wires that to `mp.forwardHit(actor, ...args)`. **For each remote player puppet,
  set `puppet.onRemoteHit = (...a) => this.forwardHit(puppet, ...a)`** and send it to its owner,
  who applies it to their real body (the same call the local game would have made - read how the
  old mp.js replayed `'guard'`, wounds and impulses). The owner then dies / ragdolls locally and
  their snapshots show it to everyone.

---

## 4. Messages (suggested shapes)

All JSON (or pack later). `k` is the kind. `id` = sender's player id.

| k | When | Body |
|---|---|---|
| `hello` | on connect | `{ name, level, look }` - `look` from `g.look()`; `name` = `look.name` (typed at the booth, else `PlayerNNNN`) |
| `welcome` | server -> new client | `{ you, host, players:[{id,name,look}] }` |
| `join` / `leave` | server -> all | `{ id, name, look }` / `{ id }` |
| `s` (snapshot) | ~20 Hz, from `post(dt)` | position, yaw, mode (`'anim'`/`'ragdoll'`), bone or ragdoll-part transforms, held item code (`g.heldOf(hero)`), `hp` (`healthOf(hero)`), `dead` |
| `hit` | from `forwardHit` | `{ to, kind, vel:[x,y,z], power, part, point }` - only the target applies it |
| `fire` | from `fired(...)` | what `onRemoteFire` needs to draw it |
| `body` | from `body(actor, m)` | `{ id: ref(actor), m }` - bullet holes, dents, gashes, cuts in the part's frame; receiver: `g.onBody(actorOf(id), m)`. Blood isn't sent: each client bleeds from the wounds itself |
| `emote`, `look`, `med`, `tie`, `turn`, `cash` | from the matching method | see the method's doc in session.js; the receivers are `g.onTie`, `g.onTurn`, `g.onMed`, `g.onCash`, `g.onRemoteEmote` |
| `say` | from `said(actor,text,opts)` | speech bubbles for players |
| `rtc` | voice / WebRTC signalling | `{ to, sdp | ice }` |

Puppets: build with `new Actor(scene, world, look)` (same as main.js `spawnFighter`), set
`actor.remote = true`, `g.addActor(actor, true)`, keep it in `this.players.set(id, { id, name, actor, tag })`.
On `leave`: `g.removeActor(actor)`, hide it, drop it from `players`. Interpolate snapshots
(render ~100 ms behind) - never snap a ragdoll every packet.

Held items on puppets: make the item with `g.makeItem(type)`, set `state = 'held'`,
`owner = puppet` and pose it in their hand from the snapshot, so `strike.js parry()` sees it.

---

## 5. The Multiplayer Arena specifically

Already done locally (no network needed):
- Spawn straight into the pit (`level.mpArena`), random spot (`spawnSpot` - avoids `mp.players`).
- A random melee weapon each life (`giveKnife()` picks one that isn't the last), the old one is disposed.
- Death = the normal organ/blood death and ragdoll. Respawn after 4 s (`MpArena.update`).
- Health bar on the left hand (`HandBar` in mparena.js), from `healthOf(hero)`.
- No reset button, no VR weapon wheel, no desktop hotbar (`applyMode`).

To do over the network:
1. Send `hp` and `dead` in snapshots; give each puppet its own `HandBar` on
   `puppet.hero.arms[0].hand` and `bar.set(hp)` from the snapshot.
2. Kills: when a `hit` kills you, include `by` - send `{ k:'kill', by, victim }`; keep a scoreboard (host-owned).
3. The weapon type is in the snapshot's held-item code, so puppets show the right one.
4. Room per level: put `level` (`'mparena'`) in `hello`; players on other maps aren't in your room. `loadLevel` in main.js already calls `mp.dropAll()` on a map switch - also tell the server.
5. Optional: cap the room (e.g. 8), add a round timer on the host.

---

## 6. Voice chat (`multiplayer/voice.js`)

Wired already: `const voice = new VoiceChat({ camera, mp, hero })` in main.js, `voice.update(dt)`
each frame, `voice.clear()` on map switch. **Open mic by default**; Settings -> Voice -> *Push to talk* (`settings.pushToTalk`) switches to hold-Y (`voice.talk(true/false)`). `voice.talking` says whether the mic should be live; `voice.sync()` applies it to the mic track.
Fill in the TODOs:

1. `setEnabled(true)` from a user click (a settings toggle / the menu): `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`; create the `AudioContext` here (needs the gesture).
2. One `RTCPeerConnection` per remote player (mesh is fine up to ~8). Signal offers/answers/ICE through your relay as `{ k:'rtc', to, sdp|ice }`. Use a STUN server, and a TURN server for real-world NATs.
3. `pc.addTrack(micTrack)`; keep the mic in `voice.mic` - `sync()` already sets `micTrack.enabled = voice.talking` whenever the key or the setting changes.
4. `pc.ontrack` -> `voice.addPeer(id, stream)`: `MediaStreamSource -> PannerNode (HRTF) -> destination`; also attach the stream to a muted `<audio>` (Chrome quirk).
5. `update(dt)`: set `ctx.listener` from the camera, and each panner's position to `mp.players.get(id).actor.hero.head.getWorldPosition(...)` - voices come from bodies.
6. VR: pick a controller button for push to talk (only matters with the setting on) in `vr.js` and call `voice.talk`. A small "talking" icon over the speaker's head is a nice touch (`bubbles` already places things over heads).
7. Clean up on `leave` (`removePeer`) and on tab close.

---

## 7. Checklist

- [ ] Networked `Session` with the same methods as `multiplayer/session.js`; `live = true` when connected.
- [ ] Puppets for other players (`remote = true`, `addActor`, `onRemoteHit` -> `forwardHit`).
- [ ] Snapshots both ways, interpolated; ragdoll state included.
- [ ] Hits forwarded to the owner and applied there; deaths show via snapshots.
- [ ] Held items on puppets registered for `parry()`.
- [ ] Hand health bars on puppets.
- [ ] Host election + kill feed / scores for the arena.
- [ ] Voice (section 6).
- [ ] A Multiplayer button / status somewhere (the old ones were removed from index.html's menu).
