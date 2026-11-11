// Speech for the radio: Web Speech synthesis with a distinct voice per controller, and optional
// speech recognition for push-to-talk.
import { settings } from '../core/settings.js';

export class Voice {
  constructor(sound) {
    this.sound = sound;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = [];
    this.queue = [];
    this.speaking = false;
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang)); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.recognition = null;
    if (SR) {
      this.recognition = new SR();
      this.recognition.lang = 'en-US';
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;
    }
    this.listening = false;
  }
  get available() { return !!this.synth; }
  get canListen() { return !!this.recognition; }
  pick(seed) {
    if (!this.voices.length) return null;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return this.voices[h % this.voices.length];
  }
  /** who: a stable identity string (facility or 'pilot'); kind: 'atc' | 'pilot' | 'atis'. */
  say(text, who, kind = 'atc') {
    if (!this.synth) return;
    if (kind === 'pilot' ? !settings.pilotVoice : !settings.atcVoice) return;
    this.queue.push({ text, who, kind });
    if (this.queue.length > 5) this.queue.splice(0, this.queue.length - 5);
    this.pump();
  }
  pump() {
    if (this.speaking || !this.queue.length || !this.synth) return;
    const q = this.queue.shift();
    const u = new SpeechSynthesisUtterance(q.text);
    const v = this.pick(q.who);
    if (v) u.voice = v;
    let h = 0;
    for (let i = 0; i < q.who.length; i++) h = (h * 17 + q.who.charCodeAt(i)) >>> 0;
    u.rate = q.kind === 'atis' ? 1.05 : 1.18 + (h % 10) / 80;
    u.pitch = q.kind === 'pilot' ? 0.92 : 0.85 + (h % 7) / 20;
    u.volume = settings.voiceVol * settings.masterVol * (q.kind === 'atis' ? 0.75 : 1);
    this.speaking = true;
    const done = () => { if (!this.speaking) return; this.speaking = false; this.sound?.radio(false); setTimeout(() => this.pump(), 180); };
    u.onend = done; u.onerror = done;
    this.sound?.radio(true);
    try { this.synth.speak(u); } catch { done(); }
    // some browsers never fire onend for long queues
    setTimeout(done, 3000 + q.text.length * 95);
  }
  stop() {
    this.queue.length = 0;
    try { this.synth?.cancel(); } catch { /* ignore */ }
    this.speaking = false;
  }
  /** Start listening; resolves with the transcript (or '' if nothing was heard). */
  listen() {
    return new Promise((resolve) => {
      if (!this.recognition || this.listening) { resolve(''); return; }
      let text = '';
      this.listening = true;
      this.recognition.onresult = (e) => { text = e.results[0][0].transcript; };
      this.recognition.onerror = () => {};
      this.recognition.onend = () => { this.listening = false; resolve(text); };
      try { this.recognition.start(); } catch { this.listening = false; resolve(''); }
    });
  }
  stopListening() { try { this.recognition?.stop(); } catch { /* ignore */ } }
}
