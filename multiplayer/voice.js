/*
  Voice chat: one WebRTC peer connection per other player, in a mesh (fine up to ~8 people).
  The audio is spatialised, so you hear people from where they stand, and the mic is open by
  default or hold-to-talk with the Push to talk setting (desktop: hold Y; headset: press the left
  thumbstick in - see the button wiring in vr.js).

  Signalling goes through the same relay as the game (multiplayer/net.js) as `{ t:'rtc', to,
  sdp|ice }` - the room passes it to that one player. Media itself is peer to peer.

  Who offers: the player with the lower id, so both sides can't offer at once (glare).
  A real home router usually needs TURN, not just STUN: STUN is free and reliable (Cloudflare,
  Google), TURN here is the free public Open Relay. If voice connects for some people and not
  others, that's the TURN server being rate-limited - a paid TURN is the fix (see README).
*/

import * as THREE from 'three';
import { settings, onSetting } from '../settings.js';
import { mpPanel } from './ui.js';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export class VoiceChat {
  /** o = { camera, mp (multiplayer/session.js), hero } */
  constructor(o) {
    this.o = o;
    this.enabled = false;   // the player said yes to voice (and the mic was allowed)
    this.held = false;      // push-to-talk key down
    this.mic = null;        // MediaStream from getUserMedia, once asked for
    this.track = null;      // the mic's audio track (added to every peer)
    this.peers = new Map(); // player id -> { pc, stream, src, panner, audio } - one per remote player
    this.pcs = new Map();   // player id -> RTCPeerConnection (kept even before audio arrives)
    this.ctx = null;        // AudioContext (made on first use: needs a user gesture)
    this.error = null;      // why voice is off, for the panel
    this._v = new THREE.Vector3();
    this._listeners = [];   // the panel's refresh, told when the mic state moves
    // (a handle for the console and the push-to-talk button in vr.js)
    try { window.__voice = this; } catch (e) { /* no window */ }

    onSetting('pushToTalk', () => this.sync());

    // the settings panel's "Multiplayer" section (status, name, mic)
    mpPanel({ mp: o.mp, voice: this });
    // (an AudioContext made away from a click starts suspended: the first input wakes it)
    const wake = () => { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);

    // ---- asking for the microphone ----
    // The headset app drops straight into VR, and a permission prompt is far easier to answer on
    // the flat page than through a VR session - so as the *installed* app we ask at once, on load.
    // (In a plain browser nobody wants a mic prompt just for opening a game: there we wait for the
    // first tap or key.) Whichever comes first wins; the browser only ever shows the one prompt.
    const firstAsk = () => {
      removeEventListener('pointerdown', firstAsk, true);
      removeEventListener('keydown', firstAsk, true);
      removeEventListener('touchstart', firstAsk, true);
      this.ask();
    };
    addEventListener('pointerdown', firstAsk, true);
    addEventListener('keydown', firstAsk, true);
    addEventListener('touchstart', firstAsk, true);
    if (installedApp()) this.ask();

    // signalling in, and players leaving
    const net = o.mp?.net;
    net?.on?.('rtc', (m) => this.onSignal(m));
    net?.on?.('left', (m) => this.removePeer(String(m.id)));
    net?.on?.('reset', () => this.clear());
  }

  /** Is our mic going out right now? Open mic unless push to talk is on (then: key held). */
  get talking() { return this.enabled && (!settings.pushToTalk || this.held); }
  /** The push-to-talk key (ignored with open mic). */
  talk(down) { this.held = !!down; this.sync(); }
  /** Our outgoing track follows talking. */
  sync() {
    const t = this.mic?.getAudioTracks?.()[0];
    if (t) t.enabled = this.talking;
  }

  /**
   * Ask the browser for the microphone - once. The stream is kept and reused, so the permission
   * prompt appears a single time however many callers ask (startup, the first tap, walking into
   * the Arena, the panel's button). Never throws: false just means "no mic", and `error` says why.
   */
  ask() {
    if (this.mic && this.mic.getAudioTracks?.().some?.((t) => t.readyState === 'live')) return Promise.resolve(true);
    if (this._asking) return this._asking;
    this._asking = navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        this.mic = stream;
        this.track = stream.getAudioTracks()[0] || null;
        this.error = null;
        // (a peer connection made before the mic was allowed gets the track now)
        for (const pc of this.pcs.values()) {
          if (this.track && this.mic) { try { pc.addTrack(this.track, this.mic); } catch (e) { /* already has it */ } }
        }
        this.emitChange();
        return true;
      })
      .catch((e) => {
        this.error = e?.name === 'NotAllowedError' ? 'mic blocked' : 'no mic';
        this.mic = null;
        this.track = null;
        this.emitChange();
        return false;
      })
      .finally(() => { this._asking = null; });
    return this._asking;
  }

  /** Let whoever is drawing the panel know the mic state moved. */
  emitChange() { for (const fn of this._listeners) { try { fn(); } catch (e) { /* ignore */ } } }
  onChange(fn) { this._listeners.push(fn); }

  /**
   * Turn voice on/off. On: ask for the mic (needs the click), make the AudioContext (also needs
   * the gesture), and start connecting to whoever is already here. Off: hang up on everyone.
   */
  async setEnabled(on) {
    if (!on) {
      this.enabled = false;
      this.sync();
      this.clear();
      return false;
    }
    if (this.enabled) return true;
    if (!(await this.ask())) {
      this.enabled = false;
      this.sync();
      return false;
    }
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (e) { /* voice still works once the first input wakes it */ }
    this.enabled = true;
    this.sync();
    for (const id of this.o.mp?.players?.keys?.() || []) this.want(String(id));
    return true;
  }

  // ---- wiring up to the other players ----
  /** Connect to `id` if we're the side that offers (the lower id). */
  want(id) {
    if (!this.enabled || !id || id === String(this.o.mp?.me)) return;
    if (String(this.o.mp?.me) < id) this.offer(id);
  }

  pcFor(id) {
    let pc = this.pcs.get(id);
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE);
    this.pcs.set(id, pc);
    if (this.track && this.mic) pc.addTrack(this.track, this.mic);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(id, { ice: e.candidate }); };
    pc.ontrack = (e) => { try { this.addPeer(id, e.streams[0]); } catch (err) { /* ignore */ } };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.();
    };
    return pc;
  }

  async offer(id) {
    const pc = this.pcFor(id);
    if (pc.signalingState !== 'stable' || pc.localDescription) return;
    try {
      const o = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(o);
      this.signal(id, { sdp: pc.localDescription });
    } catch (e) { /* the other side will offer */ }
  }

  async onSignal(m) {
    const me = String(this.o.mp?.me);
    if (m.to && String(m.to) !== me) return;
    const id = String(m.from);
    if (!this.enabled || !id || id === me) return;
    const pc = this.pcFor(id);
    try {
      if (m.sdp) {
        if (m.sdp.type === 'offer') {
          if (pc.signalingState !== 'stable') await pc.setLocalDescription(await pc.createAnswer()).catch(() => {});
          await pc.setRemoteDescription(m.sdp);
          const a = await pc.createAnswer();
          await pc.setLocalDescription(a);
          this.signal(id, { sdp: pc.localDescription });
        } else if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(m.sdp);
        }
      } else if (m.ice) {
        try { await pc.addIceCandidate(m.ice); } catch (e) { /* arrives before the offer now and then */ }
      }
    } catch (e) { /* a broken handshake re-offers on the next join */ }
  }

  signal(to, body) { this.o.mp?.net?.send?.({ t: 'rtc', to, ...body }); }

  // ---- the audio graph ----
  /** A remote player's audio arrived: play it from their head. */
  addPeer(id, stream) {
    if (!stream || this.peers.has(id)) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.maxDistance = 30;
    panner.rolloffFactor = 1;
    src.connect(panner).connect(ctx.destination);
    // (Chrome plays nothing from a WebAudio-only stream unless it's also on a media element)
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.muted = true;
    audio.autoplay = true;
    audio.id = `voice-${id}`;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    this.peers.set(id, { stream, src, panner, audio });
  }

  removePeer(id) {
    id = String(id);
    const P = this.peers.get(id);
    if (P) {
      try { P.src.disconnect(); P.panner.disconnect(); } catch (e) { /* already gone */ }
      try { P.audio.srcObject = null; P.audio.remove(); } catch (e) { /* already gone */ }
      this.peers.delete(id);
    }
    const pc = this.pcs.get(id);
    if (pc) { try { pc.close(); } catch (e) { /* already gone */ } this.pcs.delete(id); }
  }

  /** Every frame: the listener follows the camera, each voice sits on its owner's head. */
  update(dt) {
    // once we're in the room, voice opens with it (open mic by default, the game's own design);
    // turning it off in the panel sticks, it doesn't come back on its own
    if (!this._auto && this.o.mp?.live) { this._auto = true; this.setEnabled(true); }
    const ctx = this.ctx;
    if (!ctx || (!this.peers.size && !this.enabled)) return;
    const cam = this.o.camera;
    if (!cam) return;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    setPos(ctx.listener, e[12], e[13], e[14]);
    // (facing is -Z in the camera's own space; up is +Y)
    setOrient(ctx.listener, -e[8], -e[9], -e[10], e[4], e[5], e[6]);

    for (const [id, P] of this.peers) {
      const actor = this.o.mp?.players?.get(id)?.actor;
      const head = actor?.hero?.head;
      if (!head) continue;
      head.getWorldPosition(this._v);
      setPos(P.panner, this._v.x, this._v.y, this._v.z);
    }
  }

  /** Leaving / switching maps: hang up on everyone (the mic stays, if it's on). */
  clear() {
    for (const id of [...this.pcs.keys()]) this.removePeer(id);
  }
}

/**
 * Are we the *installed* app (the headset's) rather than a plain browser tab? Same trick the VR
 * grant patch uses: only the installed app has Digital Goods. It decides whether the microphone
 * is asked for at load - the headset goes straight into VR, so the prompt has to come early.
 */
function installedApp() {
  try { return typeof window.getDigitalGoodsService !== 'undefined'; } catch (e) { return false; }
}

// (AudioParam first - setPosition/setOrientation are deprecated, but old engines only have those)
function setPos(node, x, y, z) {
  if (node.positionX) {
    node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z;
  } else if (node.setPosition) node.setPosition(x, y, z);
}
function setOrient(node, fx, fy, fz, ux, uy, uz) {
  if (node.forwardX) {
    node.forwardX.value = fx; node.forwardY.value = fy; node.forwardZ.value = fz;
    node.upX.value = ux; node.upY.value = uy; node.upZ.value = uz;
  } else if (node.setOrientation) node.setOrientation(fx, fy, fz, ux, uy, uz);
}
