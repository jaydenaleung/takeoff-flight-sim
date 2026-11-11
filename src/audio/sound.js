// All audio is synthesised with Web Audio: engines, airflow, ground roll, gear/flap motors,
// touchdown, warning horns and radio static. No audio files are shipped.
import { settings } from '../core/settings.js';
import { clamp } from '../core/units.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.ready = false;
    const start = () => this.init();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = settings.masterVol; this.master.connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = (type, f, q = 0.7) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(this.master); src.start();
      return { flt, g };
    };
    const tone = (type, f) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.master); o.start();
      return { o, g };
    };
    this.rumble = noise('lowpass', 180);          // engine core
    this.roar = noise('bandpass', 700, 0.5);      // jet exhaust
    this.whine = tone('sawtooth', 200);           // fan / compressor
    this.whineFlt = ctx.createBiquadFilter(); this.whineFlt.type = 'lowpass'; this.whineFlt.frequency.value = 2400;
    this.whine.g.disconnect(); this.whine.g.connect(this.whineFlt); this.whineFlt.connect(this.master);
    this.wind = noise('highpass', 900);
    this.roll = noise('lowpass', 90);
    this.motor = tone('square', 110);
    this.static_ = noise('bandpass', 2600, 1.2);
    this.horn = tone('square', 520);
    this.ready = true;
  }
  set(node, v, t = 0.08) { node.gain.setTargetAtTime(v, this.ctx.currentTime, t); }

  /**
   * s: { n1 (0..100), ab, ias (kt), gs, onGround, paved, cockpit (bool), gearMoving, flapMoving,
   *      stall, overspeed, master, paused, fighter, engines }
   */
  update(s) {
    if (!this.ready) return;
    this.master.gain.value = s.paused ? 0 : settings.masterVol;
    const n = clamp(s.n1 / 100, 0, 1.05), inside = s.cockpit ? 0.45 : 1;
    const scale = s.fighter ? 1.25 : 1;
    this.set(this.rumble.g, (0.05 + 0.4 * n * n) * inside * scale);
    this.rumble.flt.frequency.setTargetAtTime(120 + 420 * n, this.ctx.currentTime, 0.1);
    this.set(this.roar.g, (0.42 * n * n * n + 0.9 * (s.ab || 0)) * inside * scale);
    this.roar.flt.frequency.setTargetAtTime(500 + 900 * n, this.ctx.currentTime, 0.1);
    this.whine.o.frequency.setTargetAtTime((s.fighter ? 260 : 150) + (s.fighter ? 900 : 650) * n, this.ctx.currentTime, 0.1);
    this.set(this.whine.g, (0.012 + 0.045 * n) * inside * (s.n1 > 3 ? 1 : 0));
    const q = clamp(s.ias / 320, 0, 1.6);
    this.set(this.wind.g, 0.5 * q * q * (s.cockpit ? 1 : 0.5));
    this.set(this.roll.g, s.onGround ? clamp(s.gs / 70, 0, 1) * (s.paved ? 0.5 : 1.1) : 0);
    this.set(this.motor.g, s.gearMoving ? 0.03 : s.flapMoving ? 0.012 : 0);
    this.motor.o.frequency.value = s.gearMoving ? 96 : 160;
    // warning horn patterns
    const t = this.ctx.currentTime;
    let horn = 0;
    if (s.stall) { horn = (t * 9) % 1 < 0.5 ? 0.09 : 0; this.horn.o.frequency.value = 380; }
    else if (s.overspeed) { horn = (t * 6) % 1 < 0.35 ? 0.07 : 0; this.horn.o.frequency.value = 900; }
    else if (s.master) { horn = (t * 2.5) % 1 < 0.3 ? 0.05 : 0; this.horn.o.frequency.value = 620; }
    this.set(this.horn.g, horn, 0.01);
  }
  /** Radio carrier noise while someone is transmitting. */
  radio(on) {
    if (!this.ready) return;
    this.set(this.static_.g, on ? 0.035 * settings.voiceVol : 0, 0.02);
    this.blip(on ? 1400 : 900, 0.04, 0.03);
  }
  blip(freq, dur, vol = 0.05, type = 'sine') {
    if (!this.ready) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + dur, 0.02);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur + 0.15);
  }
  click() { this.blip(1800, 0.015, 0.03, 'square'); }
  chime() { this.blip(880, 0.25, 0.05); setTimeout(() => this.blip(660, 0.35, 0.05), 260); }
  apDisconnect() { for (let i = 0; i < 4; i++) setTimeout(() => this.blip(i % 2 ? 620 : 880, 0.12, 0.07, 'square'), i * 150); }
  touchdown(strength) {
    if (!this.ready) return;
    const ctx = this.ctx, src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    const len = Math.floor(ctx.sampleRate * 0.5), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
    src.buffer = buf; flt.type = 'bandpass'; flt.frequency.value = 1500; flt.Q.value = 2;
    g.gain.value = clamp(0.15 + strength * 0.25, 0.1, 0.9);
    src.connect(flt); flt.connect(g); g.connect(this.master); src.start();
    this.blip(70, 0.2, clamp(strength * 0.3, 0.05, 0.5));
  }
  stop() { if (this.ready) this.master.gain.value = 0; }
}
