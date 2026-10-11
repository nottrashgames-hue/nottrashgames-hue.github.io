import * as THREE from 'three';
import { settings } from './settings.js';

/*
  Voices: what people say out loud, through the browser's own speech synthesis (no AI).
  Everyone gets a voice of their own from their body: women higher, men lower, and the bigger
  someone is (taller, heavier) the deeper. Heard from where they stand: quieter with distance,
  not at all past RANGE. The browser speaks one line at a time, so the nearest, freshest lines
  win: chat from players first, the street's chatter when there's room.
*/
const RANGE = 26;
const STALE = 2.5;     // s a queued line waits before it's no longer worth saying
const MAX_Q = 3;
const _p = new THREE.Vector3();

const FEMALE = /female|woman|zira|samantha|victoria|karen|susan|aria|jenny|hazel|moira|tessa|fiona|serena|allison|ava|libby|sonia|natasha|catherine|emma|michelle/i;
const MALE = /\bmale\b|\bman\b|david|mark|daniel|alex|fred|guy|george|james|ryan|thomas|oliver|arthur|aaron|gordon|rishi|christopher|eric|roger|steffan|brian/i;

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Voices {
  constructor(camera) {
    this.camera = camera;
    this.synth = window.speechSynthesis || null;
    this.queue = [];
    this.cur = null;     // { actor, pri, u }
    this.f = []; this.m = [];
    this.ids = new WeakMap();
    this.n = 0;
    if (!this.synth) return;
    const load = () => this.pickVoices();
    load();
    this.synth.addEventListener?.('voiceschanged', load);
  }

  pickVoices() {
    const all = this.synth.getVoices();
    const en = all.filter((v) => /^en/i.test(v.lang));
    const pool = en.length ? en : all;
    // Prefer clearer natural/neural voices when available, while keeping local voices as a fallback.
    const score = (v) => (/natural|neural|enhanced|google|microsoft|aria|jenny|guy|davis|samantha/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
    const order = (a, b) => score(b) - score(a);
    this.f = pool.filter((v) => FEMALE.test(v.name)).sort(order);
    this.m = pool.filter((v) => MALE.test(v.name) && !FEMALE.test(v.name)).sort(order);
    this.any = pool.find((v) => v.default) || pool[0] || null;
  }

  /** The voice someone was born with: fixed per person. */
  voiceOf(actor) {
    const look = actor.hero?.look || {};
    // (a new body from the wardrobe: a new voice to match)
    const key = `${look.sex}|${look.height}|${look.build}`;
    let v = actor._voice;
    if (v && v.key === key) return v;
    const id = this.ids.get(actor) ?? (this.ids.set(actor, ++this.n), this.n);
    const r = hash(String(actor.id ?? actor.name ?? id));
    const fem = look.sex === 'f';
    // body size -> depth: height dominates, weight adds some
    const size = (look.height ?? 1) * Math.pow(look.build ?? 1, 0.35);
    const pitch = (fem ? 1.08 : 0.97) * Math.pow(size, -0.65) * (0.98 + r * 0.04);
    const rate = (fem ? 1.02 : 0.98) * (0.96 + ((r * 7.3) % 1) * 0.08) * Math.pow(size, -0.18);
    const list = fem ? this.f : this.m;
    v = {
      pitch: clamp(pitch, 0.78, 1.28), rate: clamp(rate, 0.85, 1.15),
      voice: list.length ? list[Math.floor(r * list.length) % list.length] : this.any, fem, key,
    };
    // (kept only once the voices have loaded: until then, asked again each line)
    if (list.length) actor._voice = v;
    return v;
  }

  /** actor said `text` (tone: say | angry | scared | sad | pain). player: a real person's chat. */
  say(actor, text, { tone = 'say', player = false } = {}) {
    if (!this.synth || !actor?.hero || actor.brain?.dead) return;
    const words = String(text).replace(/\*[^*]*\*/g, ' ').replace(/[_~`#<>|]/g, ' ').trim();
    if (!/[a-z0-9]/i.test(words)) return;
    const d = this.dist(actor);
    if (d > RANGE) return;
    const pri = (player ? 100 : 0) - d;
    const item = { actor, text: words, tone, pri, t: performance.now() / 1000 };
    // one line per person waiting: the new one replaces theirs
    this.queue = this.queue.filter((q) => q.actor !== actor);
    // a nearby player's line cuts off a far-off stranger's
    if (this.cur && (this.cur.actor === actor || (pri > this.cur.pri + 60))) { this.stop(); }
    this.queue.push(item);
    this.queue.sort((a, b) => b.pri - a.pri);
    this.queue.length = Math.min(this.queue.length, MAX_Q);
    this.next();
  }

  dist(actor) {
    actor.hero.head.getWorldPosition(_p);
    return _p.distanceTo(this.camera.position);
  }

  stop() {
    const c = this.cur;
    this.cur = null;
    if (c) c.u.onend = c.u.onerror = null;
    this.synth.cancel();
  }

  next() {
    if (this.cur || !this.queue.length) return;
    const now = performance.now() / 1000;
    let item;
    while ((item = this.queue.shift())) {
      if (now - item.t > STALE || item.actor.brain?.dead) continue;
      const d = this.dist(item.actor);
      if (d > RANGE) continue;
      break;
    }
    if (!item) return;
    const V = this.voiceOf(item.actor);
    const u = new SpeechSynthesisUtterance(item.text.slice(0, 200));
    if (V.voice) u.voice = V.voice;
    u.lang = V.voice?.lang || 'en-US';
    let pitch = V.pitch, rate = V.rate;
    if (item.tone === 'angry') { rate *= 1.05; pitch *= 0.98; }
    else if (item.tone === 'scared') { rate *= 1.08; pitch *= 1.04; }
    else if (item.tone === 'pain') { rate *= 0.96; pitch *= 0.94; }
    else if (item.tone === 'sad') { rate *= 0.94; pitch *= 0.97; }
    u.pitch = clamp(pitch, 0.72, 1.35);
    u.rate = clamp(rate, 0.75, 1.3);
    // falloff: full up close, fading to nothing at RANGE
    const k = clamp(1 - (this.dist(item.actor) - 2) / (RANGE - 2), 0, 1);
    const vol = (settings.volume ?? 1) * (settings.volSpeech ?? 1);
    if (vol < 0.01) { this.cur = null; this.next?.(); return; }
    u.volume = clamp(k * k * vol, 0.02, 1);
    const cur = this.cur = { actor: item.actor, pri: item.pri, u };
    u.onend = u.onerror = () => { if (this.cur === cur) { this.cur = null; this.next(); } };
    this.synth.speak(u);
  }

  /** Once a frame: a speaker who died or walked off stops talking. */
  update() {
    const c = this.cur;
    if (!c) return;
    if (c.actor.brain?.dead || this.dist(c.actor) > RANGE * 1.2) { this.stop(); this.next(); }
  }

  clear() { this.queue.length = 0; if (this.synth) this.stop(); }
}
