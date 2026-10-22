import { AscentPlayer } from "./ascent.js";
import { SOUNDS } from "./towerSounds.js";

/**
 * The Tower's audio (spec §8.5): its own AudioContext for the life of one game, so closing the game closes it and
 * nothing keeps running ("off means off"). Two buses into one master:
 *
 *   sounds ─┐
 *           ├─ master (the app's sound volume; 0 while deafened) ─ speakers
 *   music ──┘  (its own volume, saved per device; a filter that muffles it when you're out; ducked under big sounds)
 *
 * The app's sound volume (Settings → Sounds) is the master, so the game is never louder than the user chose for
 * Dissent. Deafened = silent: a deafened user asked for no sound.
 */

const PREFS_KEY = "dissent-tower-audio";
export const DEFAULT_PREFS = { music: 0.3, sounds: true };

export function readPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    return {
      music: typeof v?.music === "number" && v.music >= 0 && v.music <= 1 ? v.music : DEFAULT_PREFS.music,
      sounds: typeof v?.sounds === "boolean" ? v.sounds : DEFAULT_PREFS.sounds,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the setting lasts this game only */
  }
}

/** The music bus gain for a music preference: the measured level that sits under the join sound. */
export const MUSIC_SCALE = 0.5;

export class TowerAudio {
  c;
  master = null;
  sfx = null;
  musicGain = null;
  muffleFilter = null;
  music = null;
  prefs;

  constructor(volume, deafened, prefs = readPrefs()) {
    this.prefs = prefs;
    const Ctor = typeof window !== "undefined"
      ? window.AudioContext ?? (window).webkitAudioContext
      : undefined;
    this.c = Ctor ? new Ctor() : null;
    if (!this.c) return;
    this.master = this.c.createGain();
    this.master.connect(this.c.destination);
    this.sfx = this.c.createGain();
    this.sfx.connect(this.master);
    this.muffleFilter = this.c.createBiquadFilter();
    this.muffleFilter.type = "lowpass";
    this.muffleFilter.frequency.value = 18000;
    this.muffleFilter.connect(this.master);
    this.musicGain = this.c.createGain();
    this.musicGain.connect(this.muffleFilter);
    this.music = new AscentPlayer(this.c, this.musicGain);
    this.setVolume(volume, deafened);
    this.setPrefs(prefs);
  }

  /** The app's sound volume and whether the user is deafened. */
  setVolume(volume, deafened) {
    if (this.master && this.c) this.master.gain.setValueAtTime(deafened ? 0 : Math.max(0, Math.min(1, volume)), this.c.currentTime);
  }

  setPrefs(p) {
    this.prefs = p;
    if (!this.c || !this.sfx || !this.musicGain) return;
    this.sfx.gain.setValueAtTime(p.sounds ? 1 : 0, this.c.currentTime);
    this.musicGain.gain.setValueAtTime(p.music * MUSIC_SCALE, this.c.currentTime);
  }

  /** Browsers start a context suspended until a gesture; the click that opened the game counts. */
  resume() {
    if (this.c?.state === "suspended") void this.c.resume().catch(() => {});
  }

  play(name, n = 0) {
    const c = this.c, out = this.sfx;
    if (!c || !out) return;
    const d = SOUNDS[name];
    const k = d.vary ? 0.95 + Math.random() * 0.1 : 1;
    const trim = c.createGain();
    trim.gain.value = d.trim ?? 1;
    trim.connect(out);
    d.play(c, trim, c.currentTime + 0.01, k, n);
    if (d.duck) this.duck();
  }

  duck() {
    const c = this.c, g = this.musicGain;
    if (!c || !g) return;
    const v = this.prefs.music * MUSIC_SCALE, t = c.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(v * 0.35, t + 0.04);
    g.gain.linearRampToValueAtTime(v, t + 0.9);
  }

  /** You're out: the music sounds as if heard from inside the mist. */
  muffle(on) {
    const c = this.c, f = this.muffleFilter;
    if (!c || !f) return;
    const t = c.currentTime;
    f.frequency.cancelScheduledValues(t);
    f.frequency.setValueAtTime(f.frequency.value, t);
    f.frequency.exponentialRampToValueAtTime(on ? 500 : 18000, t + (on ? 1.2 : 0.3));
  }

  /** Closes everything: the music stops and the context is gone. */
  close() {
    this.music?.stop();
    void this.c?.close().catch(() => {});
  }
}
