import type { Grade } from './pulseTracking_v0.2.0';

/**
 * PULSE v0.2.0 sound: a click track that is scheduled ahead on the audio clock (so it stays
 * tight even when the page is busy tracking the camera) plus short hit / miss sounds.
 * Everything is synthesised here; no audio files are loaded.
 */
export class PulseAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private timer: number | null = null;
  private nextBeat = 0;
  private beatSec = 0.5;
  private audioStart = 0;
  private countIn = 4;
  enabled = true;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.7;
    this.out.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Call from a tap or click so phones allow sound. */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  /**
   * Starts the click track.
   * @returns the performance.now() time at which beat 0 will be HEARD, so the game clock can line up with it.
   */
  start(bpm: number, countInBeats = 4): number {
    this.stop();
    const ctx = this.ensure();
    const leadMs = 220;
    if (!ctx) return performance.now() + leadMs;
    if (ctx.state === 'suspended') void ctx.resume();
    this.beatSec = 60 / bpm;
    this.countIn = countInBeats;
    this.nextBeat = 0;
    this.audioStart = ctx.currentTime + leadMs / 1000;
    // Bluetooth speakers and some phones play late; shift the game clock by the same amount.
    const latency = Math.min(0.4, (ctx.outputLatency || 0) + (ctx.baseLatency || 0));
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 40);
    return performance.now() + leadMs + latency * 1000;
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    // If the page was asleep (background tab), skip the beats we missed rather than firing them all at once.
    const behind = Math.floor((ctx.currentTime - this.audioStart) / this.beatSec) - this.nextBeat;
    if (behind > 1) this.nextBeat += behind;
    while (this.audioStart + this.nextBeat * this.beatSec < ctx.currentTime + 0.25) {
      const when = this.audioStart + this.nextBeat * this.beatSec;
      const beat = this.nextBeat;
      this.nextBeat += 1;
      if (!this.enabled || when < ctx.currentTime - 0.02) continue;
      if (beat < this.countIn) this.tick(when, 1568, 0.5, 0.05);
      else if ((beat - this.countIn) % 4 === 0) this.tick(when, 1174.7, 0.55, 0.06);
      else this.tick(when, 880, 0.3, 0.045);
    }
  }

  private tick(when: number, frequency: number, level: number, length: number, type: OscillatorType = 'triangle') {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    const start = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  /** Short feedback sound when a move is judged. */
  hit(grade: Grade) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.005;
    if (grade === 'perfect') {
      this.tick(now, 1318.5, 0.32, 0.16, 'sine');
      this.tick(now + 0.07, 1975.5, 0.26, 0.22, 'sine');
    } else if (grade === 'nice') {
      this.tick(now, 1318.5, 0.26, 0.16, 'sine');
    } else if (grade === 'close') {
      this.tick(now, 659.3, 0.2, 0.12, 'sine');
    } else {
      this.tick(now, 150, 0.3, 0.14, 'sine');
    }
  }

  dispose() {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.out = null;
  }
}
