import type { AudioAPI, SoundName } from '../core/types';

type PlayOpts = { volume?: number; pitch?: number };

const MIN_GAP = 0.035;
const MAX_VOICES = 6;
const MASTER_VOL = 0.8;

export class AudioSystem implements AudioAPI {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  /** Player volume buses (settings menu): one-shots + engine/plow loops, and music/wind. */
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private vol = { master: 1, music: 1, sfx: 1 };
  private noiseBuf: AudioBuffer | null = null;
  private _muted = false;

  private lastPlay = new Map<SoundName, number>();
  private voices = new Map<SoundName, number[]>();

  // engine
  private engGain: GainNode | null = null;
  private engO1: OscillatorNode | null = null;
  private engO2: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  // plowing
  private plowGain: GainNode | null = null;
  private plowFilter: BiquadFilterNode | null = null;
  // music
  private musicGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private musicOn = false;
  private musicWanted = false;
  private musicTimer: number | null = null;
  private nextBeat = 0;
  private beat = 0;

  get muted(): boolean {
    return this._muted;
  }
  set muted(v: boolean) {
    this._muted = v;
    if (this.ac && this.master) {
      this.master.gain.setTargetAtTime(v ? 0 : MASTER_VOL * this.vol.master, this.ac.currentTime, 0.05);
    }
  }

  /** Player volume sliders, each 0..1. Safe to call before unlock(). */
  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    const ac = this.ac;
    if (!ac || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = ac.currentTime;
    this.master.gain.setTargetAtTime(this._muted ? 0 : MASTER_VOL * master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
  }

  unlock(): void {
    try {
      if (!this.ac) {
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ac = new Ctor();
        this.build();
      }
      if (this.ac.state === 'suspended') void this.ac.resume();
    } catch {
      /* ignore */
    }
  }

  private build(): void {
    const ac = this.ac!;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ac.destination);
    this.master = ac.createGain();
    this.master.gain.value = this._muted ? 0 : MASTER_VOL * this.vol.master;
    this.master.connect(comp);
    this.sfxBus = ac.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);
    this.musicBus = ac.createGain();
    this.musicBus.gain.value = this.vol.music;
    this.musicBus.connect(this.master);
    this.sfx = ac.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.sfxBus);

    // white noise buffer 2s
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // engine
    this.engFilter = ac.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.engFilter.Q.value = 3;
    this.engGain = ac.createGain();
    this.engGain.gain.value = 0;
    this.engO1 = ac.createOscillator();
    this.engO1.type = 'sawtooth';
    this.engO1.frequency.value = 45;
    this.engO2 = ac.createOscillator();
    this.engO2.type = 'square';
    this.engO2.frequency.value = 45;
    this.engO2.detune.value = 14;
    const o2g = ac.createGain();
    o2g.gain.value = 0.5;
    this.engO1.connect(this.engFilter);
    this.engO2.connect(o2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfxBus);
    this.engO1.start();
    this.engO2.start();

    // plowing crunch
    const pn = ac.createBufferSource();
    pn.buffer = buf;
    pn.loop = true;
    this.plowFilter = ac.createBiquadFilter();
    this.plowFilter.type = 'bandpass';
    this.plowFilter.frequency.value = 1400;
    this.plowFilter.Q.value = 0.7;
    this.plowGain = ac.createGain();
    this.plowGain.gain.value = 0;
    // tremolo-ish crunch modulation
    const lfo = ac.createOscillator();
    lfo.frequency.value = 13;
    const lfoG = ac.createGain();
    lfoG.gain.value = 500;
    lfo.connect(lfoG).connect(this.plowFilter.frequency);
    lfo.start();
    pn.connect(this.plowFilter).connect(this.plowGain).connect(this.sfxBus);
    pn.start();

    // music bus
    this.musicGain = ac.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.musicBus);
    const wind = ac.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    wind.playbackRate.value = 0.5;
    const wf = ac.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 500;
    wf.Q.value = 1.4;
    const wlfo = ac.createOscillator();
    wlfo.frequency.value = 0.09;
    const wlfoG = ac.createGain();
    wlfoG.gain.value = 260;
    wlfo.connect(wlfoG).connect(wf.frequency);
    wlfo.start();
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0.035;
    wind.connect(wf).connect(this.windGain).connect(this.musicGain);
    wind.start();

    if (this.musicWanted) this.setMusic(true);
  }

  /* ---------------------------------------------------------------- continuous */

  setEngine(throttle: number, speedFrac: number): void {
    const ac = this.ac;
    if (!ac || !this.engO1 || !this.engO2 || !this.engGain || !this.engFilter) return;
    const t = ac.currentTime;
    const th = Math.abs(throttle);
    const f = 42 + speedFrac * 55 + th * 12;
    this.engO1.frequency.setTargetAtTime(f, t, 0.12);
    this.engO2.frequency.setTargetAtTime(f * 1.005, t, 0.12);
    this.engFilter.frequency.setTargetAtTime(260 + speedFrac * 700 + th * 400, t, 0.1);
    const g = th < 0.01 && speedFrac < 0.01 ? 0.025 : 0.05 + th * 0.06 + speedFrac * 0.04;
    this.engGain.gain.setTargetAtTime(g, t, 0.15);
  }

  setPlowing(intensity: number): void {
    const ac = this.ac;
    if (!ac || !this.plowGain || !this.plowFilter) return;
    const i = Math.max(0, Math.min(1, intensity));
    this.plowGain.gain.setTargetAtTime(i * 0.28, ac.currentTime, 0.06);
  }

  setMusic(on: boolean): void {
    this.musicWanted = on;
    const ac = this.ac;
    if (!ac || !this.musicGain) return;
    if (on === this.musicOn) return;
    this.musicOn = on;
    const t = ac.currentTime;
    if (on) {
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setTargetAtTime(0.42, t, 0.8);
      this.nextBeat = t + 0.1;
      if (this.musicTimer === null) this.musicTimer = window.setInterval(() => this.schedule(), 100);
    } else {
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setTargetAtTime(0, t, 0.6);
      if (this.musicTimer !== null) {
        window.clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    }
  }

  /** Am - F - C - G, one chord per bar (root notes as MIDI, plus chord tones for the arpeggio). */
  private static CHORDS = [
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [48, 52, 55, 60],
    [55, 59, 62, 67],
  ];
  /** 16-step arpeggio pattern (indices into the chord, +4 = octave up). */
  private static ARP = [0, 1, 2, 4, 2, 1, 3, 2, 0, 2, 4, 5, 3, 2, 1, 2];
  /** Bass pattern on 16ths: 1 = root, 2 = octave, 0 = rest. */
  private static BASS = [1, 0, 1, 2, 1, 0, 1, 1, 1, 0, 1, 2, 1, 1, 0, 2];

  private schedule(): void {
    const ac = this.ac;
    if (!ac || !this.musicGain || !this.musicOn) return;
    const step = 60 / 128 / 4; // 128 bpm sixteenths -> driving arena pulse
    while (this.nextBeat < ac.currentTime + 0.3) {
      const b = this.beat;
      const t = this.nextBeat;
      const s16 = b % 16;
      const bar = Math.floor(b / 16);
      const chord = AudioSystem.CHORDS[bar % 4];
      const root = chord[0] - 24;
      // soft pad under each bar
      if (s16 === 0) for (let i = 1; i < 4; i++) this.pad(midi(chord[i] - 12), t, step * 16);
      // kick on the quarters, hat on the off-8ths
      if (s16 % 4 === 0) this.kick(t, s16 === 0 ? 1 : 0.8);
      if (s16 % 4 === 2) this.hat(t, 0.6);
      else if (bar % 2 === 1 && s16 % 2 === 1 && Math.random() < 0.35) this.hat(t, 0.3);
      // driving bass
      const bs = AudioSystem.BASS[s16];
      if (bs) this.bass(midi(root + (bs === 2 ? 12 : 0)), t, step * 0.9);
      // arpeggio (sits out every 4th bar's second half for a little breathing room)
      if (!(bar % 4 === 3 && s16 >= 8)) {
        const ai = AudioSystem.ARP[s16];
        const n = ai >= 4 ? chord[ai - 4] + 12 : chord[ai];
        this.arp(midi(n + 12), t, step, s16 % 4 === 0 ? 1 : 0.7);
      }
      this.nextBeat += step;
      this.beat++;
    }
  }

  private pad(freq: number, t: number, dur: number): void {
    const ac = this.ac!;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.016, t + 0.6);
    g.gain.setValueAtTime(0.016, t + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.connect(g).connect(this.musicGain!);
    for (const det of [-8, 8]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }

  private bass(freq: number, t: number, dur: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private arp(freq: number, t: number, dur: number, accent: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022 * accent, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.6);
    o.connect(f).connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + dur * 1.6 + 0.02);
  }

  private kick(t: number, vol: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14 * vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + 0.24);
  }

  private hat(t: number, vol: number): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03 * vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.musicGain!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.06);
  }

  /* ---------------------------------------------------------------- one-shots */

  play(name: SoundName, opts?: PlayOpts): void {
    const ac = this.ac;
    if (!ac || !this.sfx || this._muted) return;
    const now = ac.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < MIN_GAP) return;
    let v = this.voices.get(name);
    if (!v) {
      v = [];
      this.voices.set(name, v);
    }
    // drop finished voices
    for (let i = v.length - 1; i >= 0; i--) if (v[i] < now) v.splice(i, 1);
    if (v.length >= MAX_VOICES) return;
    this.lastPlay.set(name, now);
    const vol = opts?.volume ?? 1;
    const p = opts?.pitch ?? 1;
    let dur = 0.3;
    try {
      dur = this.synth(name, now, vol, p);
    } catch {
      /* ignore */
    }
    v.push(now + dur);
  }

  private out(vol: number): GainNode {
    const g = this.ac!.createGain();
    g.gain.value = vol;
    g.connect(this.sfx!);
    return g;
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number,
    dest: AudioNode, attack = 0.005, curve: 'exp' | 'lin' = 'exp',
  ): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(
    t: number, dur: number, vol: number, dest: AudioNode, type: BiquadFilterType, f0: number, f1: number,
    q = 1, attack = 0.003, rate = 1,
  ): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private bell(freq: number, t: number, dur: number, vol: number, dest: AudioNode): void {
    this.tone('sine', freq, freq, t, dur, vol, dest, 0.003);
    this.tone('sine', freq * 2.76, freq * 2.76, t, dur * 0.5, vol * 0.3, dest, 0.002);
    this.tone('triangle', freq * 2, freq * 2, t, dur * 0.35, vol * 0.25, dest, 0.002);
  }

  /** Spinning swoosh / LFO-swept noise helper. */
  private sweep(t: number, dur: number, vol: number, dest: AudioNode, f0: number, f1: number, lfoHz: number, lfoDepth: number, q = 2): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const lfo = ac.createOscillator();
    lfo.frequency.setValueAtTime(lfoHz, t);
    lfo.frequency.linearRampToValueAtTime(lfoHz * 0.6, t + dur);
    const lg = ac.createGain();
    lg.gain.value = lfoDepth;
    lfo.connect(lg).connect(f.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // amplitude wobble for the "spinning" feel
    const am = ac.createGain();
    am.gain.value = 0.6;
    const amLfo = ac.createGain();
    amLfo.gain.value = 0.4;
    lfo.connect(amLfo).connect(am.gain);
    src.connect(f).connect(am).connect(g).connect(dest);
    src.start(t, Math.random() * 1.2);
    lfo.start(t);
    src.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  /** Returns duration in seconds. */
  private synth(name: SoundName, t: number, vol: number, p: number): number {
    const o = this.out(vol);
    switch (name) {
      case 'slam': {
        // big whumpf + crunchy snow burst
        this.tone('sine', 150 * p, 38 * p, t, 0.45, 0.9, o, 0.004);
        this.tone('triangle', 95 * p, 45 * p, t, 0.3, 0.3, o, 0.004);
        this.noise(t, 0.5, 0.75, o, 'lowpass', 2200 * p, 140, 0.8, 0.004, 0.7);
        for (let i = 0; i < 8; i++) {
          const dt = 0.02 + Math.random() * 0.28;
          this.noise(t + dt, 0.05 + Math.random() * 0.05, 0.22, o, 'bandpass', (1600 + Math.random() * 2800) * p, 900, 3, 0.002);
        }
        return 0.6;
      }
      case 'hit':
        this.noise(t, 0.12, 0.5, o, 'lowpass', 2400 * p, 500, 0.8);
        this.tone('sine', 220 * p, 110 * p, t, 0.1, 0.35, o);
        return 0.12;
      case 'kill':
        this.noise(t, 0.3, 0.55, o, 'bandpass', 1800 * p, 300, 0.9);
        this.tone('square', 520 * p, 200 * p, t, 0.14, 0.12, o);
        this.tone('sine', 780 * p, 1560 * p, t + 0.05, 0.12, 0.15, o);
        this.tone('triangle', 1400 * p, 1300 * p, t + 0.02, 0.2, 0.08, o, 0.001);
        return 0.3;
      case 'strike': {
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((n, i) => this.bell(n * p, t + i * 0.06, 0.5, 0.22, o));
        this.noise(t, 0.4, 0.3, o, 'highpass', 3000, 6000, 0.7);
        return 0.8;
      }
      case 'coin':
        this.tone('square', 988 * p, 988 * p, t, 0.07, 0.12, o, 0.002);
        this.bell(1319 * p, t + 0.06, 0.35, 0.22, o);
        return 0.4;
      case 'plowHit':
        this.tone('square', 340 * p, 300 * p, t, 0.25, 0.14, o, 0.002);
        this.tone('square', 512 * p, 470 * p, t, 0.22, 0.1, o, 0.002);
        this.tone('triangle', 1210 * p, 1180 * p, t, 0.3, 0.12, o, 0.001);
        this.noise(t, 0.08, 0.4, o, 'highpass', 2500, 2500, 1);
        this.tone('sine', 120 * p, 60 * p, t, 0.15, 0.35, o);
        return 0.3;
      case 'block':
        // icy thock
        this.tone('sine', 950 * p, 480 * p, t, 0.09, 0.45, o, 0.001);
        this.tone('triangle', 2600 * p, 2500 * p, t, 0.06, 0.12, o, 0.001);
        this.tone('sine', 3900 * p, 3800 * p, t + 0.005, 0.18, 0.05, o, 0.001);
        this.noise(t, 0.05, 0.35, o, 'highpass', 4000, 3000, 1, 0.001);
        this.tone('sine', 180 * p, 90 * p, t, 0.1, 0.3, o, 0.002);
        return 0.2;
      case 'ram': {
        // metal crunch thud
        this.tone('sine', 110 * p, 38 * p, t, 0.32, 0.85, o, 0.003);
        this.tone('square', 170 * p, 70 * p, t, 0.16, 0.16, o, 0.002);
        this.noise(t, 0.22, 0.55, o, 'bandpass', 900 * p, 400, 1.6, 0.002);
        this.tone('triangle', 430 * p, 410 * p, t + 0.01, 0.22, 0.1, o, 0.001);
        this.tone('triangle', 637 * p, 600 * p, t + 0.01, 0.18, 0.08, o, 0.001);
        for (let i = 0; i < 4; i++) {
          this.noise(t + 0.03 + Math.random() * 0.12, 0.04, 0.2, o, 'bandpass', 2000 + Math.random() * 2500, 1500, 5, 0.001);
        }
        return 0.35;
      }
      case 'dash':
        // whoosh / jet
        this.noise(t, 0.5, 0.55, o, 'bandpass', 380 * p, 3600 * p, 1.4, 0.04);
        this.noise(t, 0.35, 0.2, o, 'highpass', 2500, 7000, 0.7, 0.02);
        this.tone('sawtooth', 140 * p, 520 * p, t, 0.3, 0.08, o, 0.02);
        this.tone('sine', 90 * p, 60 * p, t, 0.2, 0.25, o, 0.005);
        return 0.5;
      case 'whirl':
        // spinning swoosh
        this.sweep(t, 0.75, 0.6, o, 700 * p, 1900 * p, 9, 600, 2.2);
        this.tone('sawtooth', 220 * p, 330 * p, t, 0.6, 0.05, o, 0.08);
        return 0.78;
      case 'clash': {
        // giant icy crash + ring
        this.noise(t, 0.9, 0.85, o, 'lowpass', 4000 * p, 200, 0.7, 0.003, 0.8);
        this.noise(t, 1.2, 0.35, o, 'highpass', 5000, 9000, 0.6, 0.003);
        this.tone('sine', 120 * p, 40 * p, t, 0.5, 0.7, o, 0.003);
        for (const f of [1180, 1745, 2630, 3410]) this.tone('sine', f * p, f * p * 0.995, t, 1.5, 0.08, o, 0.002);
        this.bell(880 * p, t + 0.02, 1.4, 0.16, o);
        return 1.5;
      }
      case 'burst':
        this.noise(t, 0.45, 0.7, o, 'lowpass', 3000 * p, 300, 0.7, 0.004);
        this.noise(t, 0.2, 0.3, o, 'bandpass', 900, 600, 2, 0.002, 0.7);
        this.tone('sine', 140 * p, 60, t, 0.2, 0.4, o);
        return 0.45;
      case 'explosion':
        this.noise(t, 0.9, 0.9, o, 'lowpass', 2200, 90, 0.8, 0.005, 0.6);
        this.tone('sine', 120, 30, t, 0.7, 0.9, o, 0.004);
        this.tone('sawtooth', 80, 35, t, 0.35, 0.15, o);
        return 0.9;
      case 'roundStart':
        // horn stabs + bell: FIGHT!
        this.tone('sine', 65, 45, t, 0.3, 0.6, o, 0.003);
        for (const n of [220, 277, 330]) this.tone('sawtooth', n, n, t, 0.14, 0.07, o, 0.01);
        for (const n of [220, 277, 330]) this.tone('sawtooth', n, n, t + 0.16, 0.14, 0.07, o, 0.01);
        this.tone('sine', 65, 45, t + 0.32, 0.4, 0.6, o, 0.003);
        for (const n of [330, 415, 494, 660]) this.tone('sawtooth', n, n * 1.01, t + 0.32, 0.6, 0.07, o, 0.01);
        this.noise(t + 0.32, 0.5, 0.25, o, 'highpass', 5000, 8000, 0.7, 0.003);
        this.bell(1320, t + 0.32, 0.6, 0.15, o);
        return 1.0;
      case 'roundClear': {
        const notes = [523, 659, 784, 1047, 784, 1047, 1319];
        notes.forEach((n, i) => this.bell(n, t + i * 0.08, 0.55, 0.22, o));
        [523, 784, 1047].forEach((n) => this.tone('triangle', n, n, t + 0.5, 0.8, 0.08, o, 0.03));
        return 1.3;
      }
      case 'buy':
        this.tone('square', 660, 660, t, 0.08, 0.1, o, 0.002);
        this.bell(990, t + 0.07, 0.3, 0.22, o);
        this.bell(1320, t + 0.14, 0.4, 0.2, o);
        return 0.55;
      case 'click':
        this.tone('square', 1400 * p, 900 * p, t, 0.04, 0.08, o, 0.001);
        return 0.05;
      case 'error':
        this.tone('square', 180, 160, t, 0.12, 0.13, o, 0.003);
        this.tone('square', 140, 120, t + 0.13, 0.18, 0.13, o, 0.003);
        return 0.32;
      case 'boss':
        for (let i = 0; i < 3; i++) {
          this.tone('sawtooth', 440, 660, t + i * 0.35, 0.17, 0.14, o, 0.01, 'lin');
          this.tone('sawtooth', 660, 440, t + i * 0.35 + 0.17, 0.17, 0.14, o, 0.01, 'lin');
        }
        this.tone('sine', 55, 45, t, 1.1, 0.4, o, 0.05);
        return 1.1;
      case 'roar': {
        const ac = this.ac!;
        const lfo = ac.createOscillator();
        lfo.frequency.value = 28;
        const lg = ac.createGain();
        lg.gain.value = 30;
        const osc = ac.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110 * p, t);
        osc.frequency.linearRampToValueAtTime(150 * p, t + 0.25);
        osc.frequency.exponentialRampToValueAtTime(60 * p, t + 0.9);
        lfo.connect(lg).connect(osc.frequency);
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 800;
        f.Q.value = 4;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.35, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
        osc.connect(f).connect(g).connect(o);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 1);
        lfo.stop(t + 1);
        this.noise(t, 0.9, 0.25, o, 'bandpass', 500, 250, 2);
        return 1;
      }
      case 'charge': {
        // engine rev rising
        const ac = this.ac!;
        const o1 = ac.createOscillator();
        const o2 = ac.createOscillator();
        o1.type = 'sawtooth';
        o2.type = 'square';
        o1.frequency.setValueAtTime(55 * p, t);
        o1.frequency.exponentialRampToValueAtTime(240 * p, t + 0.85);
        o2.frequency.setValueAtTime(56 * p, t);
        o2.frequency.exponentialRampToValueAtTime(243 * p, t + 0.85);
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 6;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(2400, t + 0.85);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.1);
        g.gain.setValueAtTime(0.16, t + 0.75);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
        const g2 = ac.createGain();
        g2.gain.value = 0.5;
        o1.connect(f);
        o2.connect(g2).connect(f);
        f.connect(g).connect(o);
        o1.start(t);
        o2.start(t);
        o1.stop(t + 1);
        o2.stop(t + 1);
        this.noise(t, 0.9, 0.12, o, 'bandpass', 300, 1800, 2, 0.3);
        return 0.95;
      }
      case 'stun': {
        // dizzy cartoon wobble + little bells
        const ac = this.ac!;
        const osc = ac.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(820 * p, t);
        osc.frequency.exponentialRampToValueAtTime(420 * p, t + 0.8);
        const lfo = ac.createOscillator();
        lfo.frequency.value = 9;
        const lg = ac.createGain();
        lg.gain.value = 60 * p;
        lfo.connect(lg).connect(osc.frequency);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        osc.connect(g).connect(o);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.9);
        lfo.stop(t + 0.9);
        this.bell(1568 * p, t + 0.05, 0.35, 0.14, o);
        this.bell(1976 * p, t + 0.22, 0.35, 0.12, o);
        this.bell(1568 * p, t + 0.39, 0.35, 0.1, o);
        this.bell(1976 * p, t + 0.56, 0.35, 0.08, o);
        return 0.9;
      }
      case 'shockwave':
        // deep boom + rumble
        this.tone('sine', 90 * p, 26 * p, t, 1.2, 0.95, o, 0.004);
        this.tone('sawtooth', 60 * p, 28 * p, t, 0.6, 0.14, o, 0.004);
        this.noise(t, 1.3, 0.7, o, 'lowpass', 700 * p, 50, 0.9, 0.006, 0.45);
        this.noise(t, 0.25, 0.3, o, 'bandpass', 1400, 400, 1, 0.002);
        return 1.3;
      case 'wallHit':
        // heavy thud
        this.tone('sine', 105 * p, 42 * p, t, 0.28, 0.8, o, 0.003);
        this.noise(t, 0.18, 0.45, o, 'lowpass', 600 * p, 120, 1, 0.002);
        this.tone('triangle', 230 * p, 200 * p, t, 0.12, 0.1, o, 0.002);
        this.noise(t + 0.02, 0.25, 0.15, o, 'bandpass', 2400, 1200, 1.5, 0.01);
        return 0.3;
      case 'steal':
        // vacuum slurp
        this.noise(t, 0.5, 0.5, o, 'bandpass', 3200 * p, 380 * p, 6, 0.03);
        this.tone('sine', 900 * p, 220 * p, t, 0.42, 0.18, o, 0.02);
        this.tone('sine', 1300 * p, 300 * p, t + 0.08, 0.32, 0.08, o, 0.02);
        return 0.52;
      case 'bossDefeated': {
        // big triumphant crash + rising arpeggio
        this.noise(t, 1.2, 0.9, o, 'lowpass', 2600, 80, 0.8, 0.005, 0.55);
        this.tone('sine', 110, 28, t, 1.0, 0.9, o, 0.004);
        this.noise(t, 1.6, 0.3, o, 'highpass', 4500, 7000, 0.6, 0.004);
        const notes = [392, 523, 659, 784, 1047, 1319, 1568, 2093];
        notes.forEach((n, i) => this.bell(n, t + 0.35 + i * 0.075, 0.7, 0.2, o));
        [523, 659, 784, 1047].forEach((n) => this.tone('sawtooth', n, n, t + 1.0, 1.3, 0.035, o, 0.04));
        [262, 392].forEach((n) => this.tone('triangle', n, n, t + 1.0, 1.4, 0.12, o, 0.04));
        return 2.4;
      }
      case 'gameOver': {
        const notes = [392, 349, 311, 262];
        notes.forEach((n, i) => this.tone('triangle', n, n * 0.97, t + i * 0.28, 0.5, 0.25, o, 0.01));
        this.tone('sawtooth', 130, 65, t + 1.1, 1.2, 0.12, o, 0.05);
        return 2.3;
      }
      case 'victory': {
        const notes = [523, 659, 784, 1047, 1319, 1568];
        notes.forEach((n, i) => this.bell(n, t + i * 0.12, 0.7, 0.25, o));
        [523, 659, 784].forEach((n) => this.tone('triangle', n, n, t + 0.8, 1.4, 0.12, o, 0.05));
        return 2.3;
      }
      case 'freeze':
        for (let i = 0; i < 6; i++) {
          const f = (2000 + Math.random() * 2500) * p;
          this.tone('sine', f, f * 1.02, t + i * 0.04, 0.4, 0.07, o, 0.002);
        }
        this.noise(t, 0.6, 0.18, o, 'highpass', 5000, 9000, 1, 0.05);
        return 0.65;
      case 'zap':
        // electric crackle: buzzy saw burst + fizzing highpass noise
        this.tone('sawtooth', 1400 * p, 260 * p, t, 0.09, 0.16, o, 0.001);
        this.tone('square', 2200 * p, 900 * p, t + 0.02, 0.06, 0.07, o, 0.001);
        this.noise(t, 0.12, 0.3, o, 'highpass', 3500 * p, 6000, 0.8, 0.001, 1.6);
        return 0.13;
      case 'thunder':
        // sharp crack, then a rolling low boom
        this.noise(t, 0.12, 0.9, o, 'highpass', 2000 * p, 5000, 0.7, 0.001, 1.4);
        this.tone('sawtooth', 900 * p, 120 * p, t, 0.15, 0.25, o, 0.001);
        this.tone('sine', 70 * p, 30 * p, t + 0.04, 1.4, 0.9, o, 0.01);
        this.noise(t + 0.05, 1.6, 0.6, o, 'lowpass', 500 * p, 60, 0.9, 0.04, 0.5);
        return 1.6;
      case 'thud':
        // BRUTUS Ground Pound: crunchy impact, a sub-bass drop and a snowy rumble rolling outward
        this.noise(t, 0.08, 0.8, o, 'bandpass', 900 * p, 300, 1.2, 0.001);
        this.tone('sine', 120 * p, 32 * p, t, 0.7, 1, o, 0.002);
        this.tone('triangle', 60 * p, 38 * p, t, 0.5, 0.35, o, 0.003);
        this.noise(t + 0.02, 0.9, 0.55, o, 'lowpass', 900 * p, 80, 0.8, 0.005, 0.5);
        this.noise(t + 0.06, 0.4, 0.18, o, 'highpass', 2500, 1200, 0.7, 0.01);
        return 0.95;
      case 'countdown':
        this.tone('square', 880 * p, 880 * p, t, 0.14, 0.12, o, 0.002);
        this.tone('sine', 880 * p, 880 * p, t, 0.2, 0.2, o, 0.002);
        return 0.2;
      // ---------------------------------------------------------------- Brawl mode
      case 'streak': {
        // announcer-style power chord stab + rising whoosh
        this.noise(t, 0.45, 0.4, o, 'bandpass', 300 * p, 4200 * p, 1.2, 0.18);
        this.tone('sine', 70 * p, 45 * p, t + 0.28, 0.4, 0.7, o, 0.003);
        const root = 196 * p; // G3 power chord (root, fifth, octave)
        for (const [mul, det] of [[1, 0], [1.5, 0], [2, 0], [1, 1.008], [1.5, 0.993]] as [number, number][]) {
          const f = root * mul * (det || 1);
          this.tone('sawtooth', f, f, t + 0.28, 0.55, 0.075, o, 0.004);
          this.tone('square', f * 0.5, f * 0.5, t + 0.28, 0.35, 0.035, o, 0.004);
        }
        // second, higher stab
        for (const mul of [1, 1.5, 2]) this.tone('sawtooth', root * 1.335 * mul, root * 1.335 * mul, t + 0.5, 0.6, 0.07, o, 0.004);
        this.noise(t + 0.28, 0.5, 0.3, o, 'highpass', 5000, 9000, 0.7, 0.003);
        this.bell(1568 * p, t + 0.5, 0.6, 0.14, o);
        return 1.1;
      }
      case 'shutdown': {
        // heavy impact + descending sweep
        this.tone('sine', 120 * p, 30 * p, t, 0.8, 0.95, o, 0.003);
        this.noise(t, 0.6, 0.8, o, 'lowpass', 3000 * p, 120, 0.8, 0.003, 0.6);
        this.tone('sawtooth', 1200 * p, 90 * p, t + 0.05, 1.0, 0.12, o, 0.01);
        this.tone('square', 900 * p, 70 * p, t + 0.08, 1.0, 0.06, o, 0.01);
        this.noise(t + 0.05, 1.0, 0.35, o, 'bandpass', 4000 * p, 200, 3, 0.02);
        this.bell(523 * p, t + 0.02, 0.9, 0.12, o);
        return 1.2;
      }
      case 'respawn':
        // shimmer up
        for (let i = 0; i < 7; i++) {
          const f = (600 + i * 220) * p;
          this.tone('sine', f, f * 1.5, t + i * 0.05, 0.35, 0.07, o, 0.01);
        }
        this.noise(t, 0.6, 0.2, o, 'highpass', 2500, 9000, 0.8, 0.2);
        this.tone('triangle', 330 * p, 660 * p, t, 0.5, 0.1, o, 0.05);
        return 0.7;
      case 'heal':
        // warm two-note chime
        this.bell(659 * p, t, 0.6, 0.2, o);
        this.bell(988 * p, t + 0.12, 0.8, 0.2, o);
        this.tone('triangle', 330 * p, 330 * p, t, 0.6, 0.07, o, 0.04);
        return 0.9;
      case 'dashStrike': {
        // massive crunchy impact + low boom (bigger than 'ram')
        this.tone('sine', 140 * p, 28 * p, t, 0.9, 1.0, o, 0.002);
        this.tone('sine', 60 * p, 24 * p, t + 0.02, 1.1, 0.7, o, 0.01);
        this.tone('square', 220 * p, 55 * p, t, 0.25, 0.22, o, 0.002);
        this.noise(t, 0.5, 0.9, o, 'lowpass', 5000 * p, 160, 0.7, 0.002, 0.8);
        this.noise(t, 0.3, 0.6, o, 'bandpass', 1100 * p, 380, 1.6, 0.001);
        this.tone('triangle', 410 * p, 380 * p, t + 0.01, 0.3, 0.12, o, 0.001);
        this.tone('triangle', 677 * p, 620 * p, t + 0.01, 0.25, 0.1, o, 0.001);
        for (let i = 0; i < 7; i++) {
          this.noise(t + 0.02 + Math.random() * 0.22, 0.05, 0.25, o, 'bandpass', 1800 + Math.random() * 3500, 1200, 5, 0.001);
        }
        return 1.0;
      }
      case 'whirlTick': {
        // short airy swish, pitch varies
        const v = p * (0.85 + Math.random() * 0.3);
        this.noise(t, 0.16, 0.4, o, 'bandpass', 900 * v, 2600 * v, 2.2, 0.03);
        this.noise(t, 0.1, 0.12, o, 'highpass', 4000 * v, 7000 * v, 0.7, 0.02);
        return 0.17;
      }
      default: {
        const never: never = name;
        void never;
        return 0.1;
      }
    }
  }
}

function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}
