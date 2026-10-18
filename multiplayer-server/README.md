# Bloodline multiplayer server

The realtime relay the game talks to. The game itself is static (GitHub Pages); this is the
one piece that has to live somewhere that can hold a socket open. It is a Cloudflare Worker
with **one Durable Object per room**, and a room is a **level** - so everyone on the same map
is together, which is what the simulation wants.

Nothing here is game logic. It does four small jobs:

1. give a newcomer a connection id and tell them who else is here (and who the host is),
2. tell the room when someone joins, leaves, renames, or changes outfit,
3. decide who is driving which car (first to sit at the wheel keeps it),
4. pass snapshots, events and voice signalling between the players.

The host (the player who has been here longest) simulates that map's pedestrians and parked
cars; everyone else watches them as puppets. See `../multiplayer/GUIDE.md` for the game-side
picture and `../multiplayer/net.js` for the client end.

## Cost

The Workers **free** plan. Rooms use the Durable Object *hibernation* API, so a room that is
quiet costs nothing to hold open, and rooms are SQLite-backed (which is the only kind the free
plan allows anyway). Limits on the free plan (100k requests/day) are far above what a game
with friends will use.

## One-time setup

You need a Cloudflare account (the free one is fine: https://dash.cloudflare.com/sign-up).

Then **double-click `SETUP-CLOUDFLARE.cmd`**. It installs `wrangler` (Cloudflare's tool),
opens a browser for you to sign in, and deploys. At the end it prints a line like:

    https://bloodline-mp.SOMETHING.workers.dev

That address is the server. It gets written into `../multiplayer/net.js` (the `MP_URL`
constant at the top) - after that the room is live and needs no further attention. You only
ever do this once; changes to the game itself are website-only and need no redeploy.

If you would rather not run the script, the same thing by hand is:

    npm install wrangler
    npx wrangler login
    npx wrangler deploy

(The first `deploy` may ask you to pick a `workers.dev` subdomain - any name will do.)

## Changing it

    npx wrangler deploy        # after editing worker.js
    npx wrangler tail          # watch live traffic (useful if something looks wrong)

Local testing (no account needed): `npx wrangler dev` serves the same relay on
`http://127.0.0.1:8787`, and `multiplayer/net.js` already points a localhost page there.

## Voice chat

Voice is peer-to-peer WebRTC; this worker only forwards the handshake (`{ t:'rtc', to, ... }`).
Each player connects straight to each other player, so voice costs this server nothing.

The catch is NAT: two home routers usually cannot find each other without a TURN relay, not
just STUN. `multiplayer/voice.js` uses the free public Open Relay TURN server, which is free
but shared and rate-limited - if voice connects for some people and not others, that is why.
A paid TURN (Cloudflare Calls TURN has a free tier with an account, or Twilio, or your own
coturn) is the fix; put its credentials in the `ICE` constant in `multiplayer/voice.js`.

## Housekeeping

- **Cars**: if two players sit in the same car at once, the second is told `deny` and stays a
  passenger - the game already handles that reply.
- **Rooms are public**: anyone who opens the page and picks that map is in the room. That is
  the intended design (play with friends by both picking Multiplayer Arena).
- **Origin check**: the worker only accepts sockets whose `Origin` is the game's own site or
  localhost. Add another origin to `ORIGINS` in `worker.js` if you host the game elsewhere.
